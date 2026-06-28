"""
Billing helpers — expiry-aware tier resolution.

Pro is a one-time period purchase (monthly / annual) via Razorpay, with no
auto-renew. `subscription_expires_at` is the source of truth: a user is Pro
only while that timestamp is in the future.
"""
from datetime import datetime, timezone, timedelta

# Days granted per plan.
PLAN_DAYS = {"monthly": 30, "annual": 365}


def _aware(dt):
    """Treat naive timestamps as UTC so comparisons never crash."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def active_tier(conn, uid: str) -> str:
    """Return 'pro' only if the subscription hasn't lapsed, else 'free'."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT subscription_tier, subscription_expires_at FROM user_profiles WHERE id=%s",
            (uid,),
        )
        row = cur.fetchone()
    if not row:
        return "free"
    tier = (row["subscription_tier"] or "free")
    if tier != "pro":
        return "free"
    exp = _aware(row["subscription_expires_at"])
    if exp is None:
        return "pro"  # legacy row without an expiry — treat as active
    return "pro" if exp > datetime.now(timezone.utc) else "free"


def extend(conn, uid: str, plan: str, payment_id: str):
    """
    Grant/extend Pro for `plan`. Idempotent on `payment_id` so the checkout
    verify call and the webhook can both fire without double-counting.
    Returns the resulting expiry datetime.
    """
    days = PLAN_DAYS.get(plan)
    if not days:
        raise ValueError(f"unknown plan: {plan}")
    with conn.cursor() as cur:
        cur.execute(
            "SELECT subscription_expires_at, razorpay_payment_id FROM user_profiles WHERE id=%s",
            (uid,),
        )
        row = cur.fetchone()
        if row and row["razorpay_payment_id"] == payment_id:
            return _aware(row["subscription_expires_at"])  # already applied

        now = datetime.now(timezone.utc)
        base = now
        cur_exp = _aware(row["subscription_expires_at"]) if row else None
        if cur_exp and cur_exp > now:
            base = cur_exp  # stack on remaining time if renewing early
        new_exp = base + timedelta(days=days)

        cur.execute(
            "UPDATE user_profiles SET subscription_tier='pro', subscription_plan=%s, "
            "subscription_expires_at=%s, razorpay_payment_id=%s, updated_at=now() WHERE id=%s",
            (plan, new_exp, payment_id, uid),
        )
    return new_exp
