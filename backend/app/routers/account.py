"""
Account data rights: full export and permanent deletion (DPDP Act / GDPR).
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
import httpx
from ..auth import get_current_user
from ..ratelimit import limit
from ..database import get_conn
from ..config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
from .trades import BUCKET

router = APIRouter(prefix="/api/account", tags=["account"])

_ADMIN = {"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"}
# Profile columns safe to hand back (never exchange secrets).
_PROFILE_COLS = "email, subscription_tier, subscription_plan, subscription_expires_at, created_at"


@router.get("/export")
def export_account(user=Depends(limit("export", 5))):
    uid = user["user_id"]
    with get_conn(readonly=True) as conn:
        with conn.cursor() as cur:
            cur.execute(f"SELECT {_PROFILE_COLS} FROM user_profiles WHERE id=%s", (uid,))
            profile = cur.fetchone()
            cur.execute("SELECT * FROM trades WHERE user_id=%s ORDER BY date, id", (uid,))
            trades = cur.fetchall()
            cur.execute("SELECT * FROM day_logs WHERE user_id=%s ORDER BY date", (uid,))
            day_logs = cur.fetchall()
    body = {"profile": profile, "trades": trades, "day_logs": day_logs}
    return JSONResponse(
        content=_jsonable(body),
        headers={"Content-Disposition": 'attachment; filename="tradedesk-export.json"'},
    )


@router.delete("")
def delete_account(user=Depends(limit("delete", 3))):
    """Delete screenshots, then the auth user (trades/day_logs/profile cascade)."""
    uid = user["user_id"]
    with httpx.Client(headers=_ADMIN, timeout=30) as c:
        while True:
            r = c.post(f"{SUPABASE_URL}/storage/v1/object/list/{BUCKET}",
                       json={"prefix": uid, "limit": 1000})
            if r.status_code != 200:
                raise HTTPException(502, "Could not list screenshots")
            names = [f"{uid}/{o['name']}" for o in r.json() if o.get("id")]
            if not names:
                break
            d = c.request("DELETE", f"{SUPABASE_URL}/storage/v1/object/{BUCKET}", json={"prefixes": names})
            if d.status_code != 200:
                raise HTTPException(502, "Could not delete screenshots")
        # the journal (local-app UI) keeps each user's data in a private schema
        from ..journal.pgcompat import schema_for
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(f'DROP SCHEMA IF EXISTS "{schema_for(uid)}" CASCADE')
        r = c.delete(f"{SUPABASE_URL}/auth/v1/admin/users/{uid}")
        if r.status_code not in (200, 204):
            raise HTTPException(502, "Could not delete account")
    return {"ok": True}


def _jsonable(o):
    from datetime import date, datetime
    from decimal import Decimal
    if isinstance(o, dict):
        return {k: _jsonable(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_jsonable(v) for v in o]
    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, (date, datetime)):
        return o.isoformat()
    return o
