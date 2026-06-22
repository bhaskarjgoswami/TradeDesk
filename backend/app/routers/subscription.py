"""
Stripe subscription — Checkout, webhook, billing portal.

Tiers:
  free  — 50 trades/month, no Delta pull, no mobile
  pro   — $9/mo, unlimited trades, Delta sync, mobile, screenshots
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from ..auth import get_current_user
from ..database import get_conn
from ..config import STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRO_PRICE_ID, FRONTEND_URL
import stripe

stripe.api_key = STRIPE_SECRET_KEY
router = APIRouter(prefix="/api/subscription", tags=["subscription"])


def _get_or_create_customer(uid: str, email: str) -> str:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT stripe_customer_id FROM user_profiles WHERE id=%s", (uid,))
            row = cur.fetchone()
    cid = row["stripe_customer_id"] if row else None
    if not cid:
        customer = stripe.Customer.create(email=email, metadata={"user_id": uid})
        cid = customer.id
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE user_profiles SET stripe_customer_id=%s WHERE id=%s",
                    (cid, uid),
                )
    return cid


@router.get("/status")
def status(user=Depends(get_current_user)):
    uid = user["user_id"]
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT subscription_tier, stripe_customer_id FROM user_profiles WHERE id=%s",
                (uid,),
            )
            row = cur.fetchone()
    tier = (row["subscription_tier"] if row else "free") or "free"
    return {"tier": tier, "is_pro": tier == "pro"}


@router.post("/checkout")
def create_checkout(user=Depends(get_current_user)):
    cid = _get_or_create_customer(user["user_id"], user["email"])
    session = stripe.checkout.Session.create(
        customer=cid,
        mode="subscription",
        line_items=[{"price": STRIPE_PRO_PRICE_ID, "quantity": 1}],
        success_url=f"{FRONTEND_URL}/settings?upgraded=1",
        cancel_url=f"{FRONTEND_URL}/settings",
        metadata={"user_id": user["user_id"]},
    )
    return {"url": session.url}


@router.post("/portal")
def billing_portal(user=Depends(get_current_user)):
    uid = user["user_id"]
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT stripe_customer_id FROM user_profiles WHERE id=%s", (uid,))
            row = cur.fetchone()
    cid = row["stripe_customer_id"] if row else None
    if not cid:
        raise HTTPException(400, "No billing account found")
    session = stripe.billing_portal.Session.create(
        customer=cid,
        return_url=f"{FRONTEND_URL}/settings",
    )
    return {"url": session.url}


@router.post("/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except stripe.error.SignatureVerificationError:
        raise HTTPException(400, "Invalid signature")

    def _set_tier(customer_id: str, tier: str):
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE user_profiles SET subscription_tier=%s WHERE stripe_customer_id=%s",
                    (tier, customer_id),
                )

    etype = event["type"]
    obj = event["data"]["object"]

    if etype in ("customer.subscription.created", "customer.subscription.updated"):
        active = obj["status"] in ("active", "trialing")
        _set_tier(obj["customer"], "pro" if active else "free")
    elif etype == "customer.subscription.deleted":
        _set_tier(obj["customer"], "free")

    return {"ok": True}
