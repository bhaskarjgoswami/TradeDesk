from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from ..auth import get_current_user, get_pro_user
from ..database import get_conn
from ..models import TradeIn, ImageUploadIn
import time, base64, secrets, os

router = APIRouter(prefix="/api/trades", tags=["trades"])

TRADE_FIELDS = [
    "date", "symbol", "direction", "setup", "tf_bias", "logic",
    "entry", "stop", "exit", "qty", "risk", "pnl", "r_multiple",
    "outcome", "rating", "tags", "notes", "images", "checklist", "fee",
]

FREE_TRADE_LIMIT = 50


def _month_trade_count(conn, user_id: str) -> int:
    month = time.strftime("%Y-%m")
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) as n FROM trades WHERE user_id=%s AND date LIKE %s",
            (user_id, month + "%"),
        )
        return cur.fetchone()["n"]


@router.get("")
def list_trades(
    symbol: Optional[str] = None,
    setup: Optional[str] = None,
    outcome: Optional[str] = None,
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    search: Optional[str] = None,
    user=Depends(get_current_user),
):
    q = "SELECT * FROM trades WHERE user_id=%s"
    args = [user["user_id"]]
    if symbol:
        q += " AND symbol=%s"; args.append(symbol)
    if setup:
        q += " AND setup=%s"; args.append(setup)
    if outcome:
        q += " AND outcome=%s"; args.append(outcome)
    if from_date:
        q += " AND date>=%s"; args.append(from_date)
    if to_date:
        q += " AND date<=%s"; args.append(to_date)
    if search:
        s = "%" + search + "%"
        q += " AND (logic ILIKE %s OR notes ILIKE %s OR tags ILIKE %s OR symbol ILIKE %s OR setup ILIKE %s)"
        args += [s, s, s, s, s]
    q += " ORDER BY date DESC, id DESC"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(q, args)
            return cur.fetchall()


@router.post("", status_code=201)
def create_trade(body: TradeIn, user=Depends(get_current_user)):
    with get_conn() as conn:
        # free tier gate
        with conn.cursor() as cur:
            cur.execute("SELECT subscription_tier FROM user_profiles WHERE id=%s", (user["user_id"],))
            row = cur.fetchone()
        tier = (row["subscription_tier"] if row else "free") or "free"
        if tier != "pro" and _month_trade_count(conn, user["user_id"]) >= FREE_TRADE_LIMIT:
            raise HTTPException(402, "Free plan limit: 50 trades/month. Upgrade to Pro.")

        cols = TRADE_FIELDS + ["user_id", "created_at"]
        vals = [getattr(body, f) for f in TRADE_FIELDS] + [user["user_id"], time.strftime("%Y-%m-%d %H:%M:%S")]
        ph = ",".join(["%s"] * len(cols))
        with conn.cursor() as cur:
            cur.execute(f"INSERT INTO trades ({','.join(cols)}) VALUES ({ph}) RETURNING *", vals)
            return cur.fetchone()


@router.put("/{trade_id}")
def update_trade(trade_id: int, body: TradeIn, user=Depends(get_current_user)):
    sets = ",".join(f"{f}=%s" for f in TRADE_FIELDS)
    vals = [getattr(body, f) for f in TRADE_FIELDS] + [user["user_id"], trade_id]
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE trades SET {sets} WHERE user_id=%s AND id=%s RETURNING *", vals
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Trade not found")
    return row


@router.delete("/{trade_id}")
def delete_trade(trade_id: int, user=Depends(get_current_user)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM trades WHERE user_id=%s AND id=%s", (user["user_id"], trade_id))
    return {"ok": True}


@router.post("/upload")
def upload_image(body: ImageUploadIn, user=Depends(get_pro_user)):
    """Pro only — store screenshot in Supabase Storage via REST upload."""
    import httpx
    from ..config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

    header, b64 = body.data.split(",", 1)
    ext = "png"
    if "image/" in header:
        ext = header.split("image/")[1].split(";")[0]
        if ext == "jpeg":
            ext = "jpg"
    if ext not in ("png", "jpg", "gif", "webp"):
        ext = "png"
    raw = base64.b64decode(b64)
    filename = f"{user['user_id']}/{int(time.time())}_{secrets.token_hex(4)}.{ext}"
    url = f"{SUPABASE_URL}/storage/v1/object/trade-images/{filename}"
    resp = httpx.put(
        url,
        content=raw,
        headers={
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": f"image/{ext}",
        },
    )
    if resp.status_code not in (200, 201):
        raise HTTPException(502, "Storage upload failed")
    return {"path": filename}
