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
        return _tier(cur.fetchone())


def tier_and_day_count(conn, uid: str, day: str) -> tuple[str, int]:
    """Active tier and the number of trades on `day`, in one round trip."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT p.subscription_tier, p.subscription_expires_at, "
            "(SELECT COUNT(*) FROM trades WHERE user_id=%s AND date=%s) AS n "
            "FROM (SELECT 1) one LEFT JOIN user_profiles p ON p.id=%s",
            (uid, day, uid),
        )
        row = cur.fetchone()
    return _tier(row if row and row["subscription_tier"] is not None else None), row["n"]


def _tier(row) -> str:
    if not row:
        return "free"
    tier = (row["subscription_tier"] or "free")
    if tier != "pro":
        return "free"
    exp = _aware(row["subscription_expires_at"])
    if exp is None:
        return "pro"  # legacy row without an expiry — treat as active
    return "pro" if exp > datetime.now(timezone.utc) else "free"


def extend(conn, uid: str, plan: str, payment_id: str, order_id: str):
    """Grant a server-recorded paid order exactly once in the caller's transaction."""
    days = PLAN_DAYS.get(plan)
    if not days:
        raise ValueError(f"unknown plan: {plan}")
    with conn.cursor() as cur:
        cur.execute(
            "SELECT subscription_expires_at FROM public.user_profiles WHERE id=%s FOR UPDATE", (uid,),
        )
        row = cur.fetchone()
        if not row:
            raise ValueError("Account no longer exists")
        cur.execute("SELECT user_id, plan FROM public.billing_orders WHERE id=%s", (order_id,))
        order = cur.fetchone()
        if not order or str(order["user_id"]) != uid or order["plan"] != plan:
            raise ValueError("Unknown or mismatched order")
        cur.execute(
            "SELECT user_id, order_id, granted_until FROM public.billing_payments "
            "WHERE payment_id=%s OR order_id=%s", (payment_id, order_id),
        )
        applied = cur.fetchone()
        if applied:
            if str(applied["user_id"]) != uid or applied["order_id"] != order_id:
                raise ValueError("Payment already belongs to another order")
            return _aware(row["subscription_expires_at"])
        now = datetime.now(timezone.utc)
        current = _aware(row["subscription_expires_at"])
        new_exp = max(now, current) + timedelta(days=days) if current else now + timedelta(days=days)
        cur.execute(
            "INSERT INTO public.billing_payments(payment_id,order_id,user_id,granted_until) VALUES (%s,%s,%s,%s)",
            (payment_id, order_id, uid, new_exp),
        )
        cur.execute(
            "UPDATE public.user_profiles SET subscription_tier='pro', subscription_plan=%s, "
            "subscription_expires_at=%s, razorpay_payment_id=%s, updated_at=now() WHERE id=%s",
            (plan, new_exp, payment_id, uid),
        )
    return new_exp
