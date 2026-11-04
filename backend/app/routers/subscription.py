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
from ..ratelimit import limit
from ..database import get_conn
from ..billing import extend, PLAN_DAYS, _tier
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
    if not RAZORPAY_KEY_SECRET:
        return False
    body = f"{order_id}|{payment_id}".encode()
    expected = hmac.new(RAZORPAY_KEY_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


def _verify_webhook_sig(payload: bytes, signature: str) -> bool:
    if not RAZORPAY_WEBHOOK_SECRET:
        return False
    expected = hmac.new(RAZORPAY_WEBHOOK_SECRET.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


@router.get("/status")
def status(user=Depends(get_current_user)):
    uid = user["user_id"]
    with get_conn(readonly=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT subscription_tier, subscription_plan, subscription_expires_at FROM user_profiles WHERE id=%s",
                (uid,),
            )
            row = cur.fetchone()
    tier = _tier(row)
    exp = row["subscription_expires_at"] if row else None
    return {
        "tier": tier,
        "is_pro": tier == "pro",
        "plan": (row["subscription_plan"] if row else None),
        "expires_at": exp.isoformat() if exp else None,
    }


@router.post("/checkout")
def create_checkout(body: dict, user=Depends(limit("checkout", 10))):
    if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
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
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO public.billing_orders(id,user_id,plan,currency,amount) VALUES (%s,%s,%s,%s,%s)",
                (order["id"], user["user_id"], plan, currency, amount),
            )
    return {
        "order_id": order["id"],
        "amount": amount,
        "currency": currency,
        "key_id": RAZORPAY_KEY_ID,
        "plan": plan,
        "email": user["email"],
    }


@router.post("/verify")
def verify_payment(body: dict, user=Depends(limit("verify", 10))):
    if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
        raise HTTPException(503, "Payments not configured")
    order_id = (body or {}).get("razorpay_order_id")
    payment_id = (body or {}).get("razorpay_payment_id")
    signature = (body or {}).get("razorpay_signature")
    if not (order_id and payment_id and signature):
        raise HTTPException(400, "Missing payment fields")
    if not _verify_payment_sig(order_id, payment_id, signature):
        raise HTTPException(400, "Invalid payment signature")

    plan, new_exp = _apply_paid_order(order_id, payment_id, user["user_id"])
    return {"tier": "pro", "plan": plan, "expires_at": new_exp.isoformat()}


def _apply_paid_order(order_id: str, payment_id: str, uid: str | None = None):
    # Re-fetch both entities: a signed browser response does not prove capture.
    entities = []
    for resource, ident in (("orders", order_id), ("payments", payment_id)):
        response = httpx.get(f"{RAZORPAY_API}/{resource}/{ident}", auth=_auth(), timeout=20)
        if response.status_code != 200:
            raise HTTPException(502, "Could not confirm payment with Razorpay")
        entities.append(response.json())
    order, payment = entities
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT user_id,plan,currency,amount FROM public.billing_orders WHERE id=%s", (order_id,))
            expected = cur.fetchone()
        if not expected:
            raise HTTPException(400, "Unknown payment order")
        owner = str(expected["user_id"])
        if uid is not None and owner != uid:
            raise HTTPException(403, "Order does not belong to this user")
        amount, currency = expected["amount"], expected["currency"]
        if not (
            order.get("id") == order_id and order.get("status") == "paid"
            and order.get("amount") == amount and order.get("amount_paid") == amount
            and order.get("currency") == currency
            and payment.get("id") == payment_id and payment.get("order_id") == order_id
            and payment.get("status") == "captured" and payment.get("captured") is True
            and payment.get("amount") == amount and payment.get("currency") == currency
        ):
            raise HTTPException(409, "Payment is not fully captured or does not match the order")
        expiry = extend(conn, owner, expected["plan"], payment_id, order_id)
    return expected["plan"], expiry


@router.post("/webhook")
async def razorpay_webhook(request: Request):
    if not RAZORPAY_WEBHOOK_SECRET:
        raise HTTPException(503, "Payment webhook not configured")
    payload = await request.body()
    sig = request.headers.get("x-razorpay-signature", "")
    if not _verify_webhook_sig(payload, sig):
        raise HTTPException(400, "Invalid signature")

    event = await request.json()
    if event.get("event") == "order.paid":
        order = event["payload"]["order"]["entity"]
        payment = event["payload"]["payment"]["entity"]
        if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
            raise HTTPException(503, "Payments not configured")
        _apply_paid_order(order["id"], payment["id"])

    return {"ok": True}
