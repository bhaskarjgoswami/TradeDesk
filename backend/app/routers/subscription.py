"""
Razorpay subscription — one-time period payments (no auto-renew).

Flow:
  1. POST /checkout {plan}  → create a Razorpay Order, return order details
  2. Frontend opens Razorpay Checkout, user pays
  3. POST /verify {order_id, payment_id, signature} → verify + grant Pro
  4. POST /webhook (order.paid) → backup grant in case the browser closed

Plans:
  monthly — 30 days Pro
  annual  — 365 days Pro
Works for India + international (enable International Payments in the dashboard).
"""
from fastapi import APIRouter, Depends, HTTPException, Request
import httpx, hmac, hashlib
from ..auth import get_current_user
from ..database import get_conn
from ..billing import active_tier, extend, PLAN_DAYS
from ..config import (
    RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET,
    RAZORPAY_PRICE_INR_MONTHLY,
    RAZORPAY_PRICE_INR_ANNUAL,
    RAZORPAY_PRICE_USD_MONTHLY,
    RAZORPAY_PRICE_USD_ANNUAL,
)

router = APIRouter(prefix="/api/subscription", tags=["subscription"])

RAZORPAY_API = "https://api.razorpay.com/v1"
# Amount (smallest unit) by currency × plan. India pays INR, everyone else USD.
AMOUNTS = {
    "INR": {"monthly": RAZORPAY_PRICE_INR_MONTHLY, "annual": RAZORPAY_PRICE_INR_ANNUAL},
    "USD": {"monthly": RAZORPAY_PRICE_USD_MONTHLY, "annual": RAZORPAY_PRICE_USD_ANNUAL},
}


def _auth():
    return (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)


def _verify_payment_sig(order_id: str, payment_id: str, signature: str) -> bool:
    body = f"{order_id}|{payment_id}".encode()
    expected = hmac.new(RAZORPAY_KEY_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


def _verify_webhook_sig(payload: bytes, signature: str) -> bool:
    expected = hmac.new(RAZORPAY_WEBHOOK_SECRET.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


@router.get("/status")
def status(user=Depends(get_current_user)):
    uid = user["user_id"]
    with get_conn() as conn:
        tier = active_tier(conn, uid)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT subscription_plan, subscription_expires_at FROM user_profiles WHERE id=%s",
                (uid,),
            )
            row = cur.fetchone()
    exp = row["subscription_expires_at"] if row else None
    return {
        "tier": tier,
        "is_pro": tier == "pro",
        "plan": (row["subscription_plan"] if row else None),
        "expires_at": exp.isoformat() if exp else None,
    }


@router.post("/checkout")
def create_checkout(body: dict, user=Depends(get_current_user)):
    if not RAZORPAY_KEY_ID:
        raise HTTPException(503, "Payments not configured")
    plan = (body or {}).get("plan", "monthly")
    currency = ((body or {}).get("currency") or "INR").upper()
    if plan not in PLAN_DAYS:
        raise HTTPException(400, "Invalid plan")
    if currency not in AMOUNTS:
        raise HTTPException(400, "Invalid currency")
    amount = AMOUNTS[currency][plan]
    resp = httpx.post(
        f"{RAZORPAY_API}/orders",
        auth=_auth(),
        json={
            "amount": amount,
            "currency": currency,
            "notes": {"user_id": user["user_id"], "plan": plan},
        },
        timeout=20,
    )
    if resp.status_code not in (200, 201):
        raise HTTPException(502, "Could not create order")
    order = resp.json()
    return {
        "order_id": order["id"],
        "amount": amount,
        "currency": currency,
        "key_id": RAZORPAY_KEY_ID,
        "plan": plan,
        "email": user["email"],
    }


@router.post("/verify")
def verify_payment(body: dict, user=Depends(get_current_user)):
    order_id = (body or {}).get("razorpay_order_id")
    payment_id = (body or {}).get("razorpay_payment_id")
    signature = (body or {}).get("razorpay_signature")
    if not (order_id and payment_id and signature):
        raise HTTPException(400, "Missing payment fields")
    if not _verify_payment_sig(order_id, payment_id, signature):
        raise HTTPException(400, "Invalid payment signature")

    # Derive the plan from the order's notes (don't trust the client) and
    # confirm the order belongs to this user.
    resp = httpx.get(f"{RAZORPAY_API}/orders/{order_id}", auth=_auth(), timeout=20)
    if resp.status_code != 200:
        raise HTTPException(502, "Could not load order")
    notes = resp.json().get("notes", {}) or {}
    if notes.get("user_id") != user["user_id"]:
        raise HTTPException(403, "Order does not belong to this user")
    plan = notes.get("plan")
    if plan not in PLAN_DAYS:
        raise HTTPException(400, "Unknown plan on order")

    with get_conn() as conn:
        new_exp = extend(conn, user["user_id"], plan, payment_id)
    return {"tier": "pro", "plan": plan, "expires_at": new_exp.isoformat()}


@router.post("/webhook")
async def razorpay_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("x-razorpay-signature", "")
    if not _verify_webhook_sig(payload, sig):
        raise HTTPException(400, "Invalid signature")

    event = await request.json()
    if event.get("event") == "order.paid":
        order = event["payload"]["order"]["entity"]
        payment = event["payload"]["payment"]["entity"]
        notes = order.get("notes", {}) or {}
        uid = notes.get("user_id")
        plan = notes.get("plan")
        if uid and plan in PLAN_DAYS:
            with get_conn() as conn:
                extend(conn, uid, plan, payment["id"])

    return {"ok": True}
