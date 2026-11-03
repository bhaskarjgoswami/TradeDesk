from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from ..auth import get_current_user
from ..database import get_conn
from ..billing import active_tier
from ..models import TradeIn, ImageUploadIn, ImageUrlsIn
from ..config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import time, base64, secrets
import httpx

router = APIRouter(prefix="/api/trades", tags=["trades"])

TRADE_FIELDS = [
    "date", "symbol", "direction", "setup", "tf_bias", "logic",
    "entry", "stop", "exit", "qty", "risk", "pnl", "r_multiple",
    "outcome", "rating", "tags", "notes", "images", "checklist", "fee", "ext_id",
]

# Free tier: max 2 trades per day. Everything else is unlocked.
FREE_DAILY_LIMIT = 2


def _day_trade_count(conn, user_id: str, date: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) as n FROM trades WHERE user_id=%s AND date=%s",
            (user_id, date),
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
        # exchange imports: skip round-trips we already have
        if body.ext_id:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT * FROM trades WHERE user_id=%s AND ext_id=%s",
                    (user["user_id"], body.ext_id),
                )
                existing = cur.fetchone()
            if existing:
                return {**existing, "duplicate": True}

        # free tier gate (expiry-aware: lapsed Pro counts as free)
        tier = active_tier(conn, user["user_id"])
        day = body.date or time.strftime("%Y-%m-%d")
        if tier != "pro" and _day_trade_count(conn, user["user_id"], day) >= FREE_DAILY_LIMIT:
            raise HTTPException(402, "free-daily-limit")

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
            cur.execute("SELECT date FROM trades WHERE user_id=%s AND id=%s", (user["user_id"], trade_id))
            old = cur.fetchone()
            if not old:
                raise HTTPException(404, "Trade not found")
        # moving a trade onto another day must respect the free daily cap too
        if body.date and body.date != old["date"] and active_tier(conn, user["user_id"]) != "pro" \
                and _day_trade_count(conn, user["user_id"], body.date) >= FREE_DAILY_LIMIT:
            raise HTTPException(402, "free-daily-limit")
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


MAX_IMAGE_BYTES = 5 * 1024 * 1024
IMAGE_TYPES = {"png": "png", "jpeg": "jpg", "jpg": "jpg", "gif": "gif", "webp": "webp"}
BUCKET = "trade-images"


@router.post("/upload")
def upload_image(body: ImageUploadIn, user=Depends(get_current_user)):
    """Store screenshot in Supabase Storage via REST upload."""
    header, sep, b64 = body.data.partition(",")
    if not sep or not header.startswith("data:image/"):
        raise HTTPException(400, "Expected a base64 image data URL")
    ext = IMAGE_TYPES.get(header[len("data:image/"):].split(";")[0].lower())
    if not ext:
        raise HTTPException(400, "Unsupported image type")
    if len(b64) > MAX_IMAGE_BYTES * 4 // 3 + 4:
        raise HTTPException(413, "Image too large (max 5 MB)")
    try:
        raw = base64.b64decode(b64, validate=True)
    except ValueError:
        raise HTTPException(400, "Invalid base64 image")
    filename = f"{user['user_id']}/{int(time.time())}_{secrets.token_hex(4)}.{ext}"
    resp = httpx.put(
        f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{filename}",
        content=raw,
        headers={
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "image/" + ("jpeg" if ext == "jpg" else ext),
        },
        timeout=30,
    )
    if resp.status_code not in (200, 201):
        raise HTTPException(502, "Storage upload failed")
    return {"path": filename}


@router.post("/image-urls")
def image_urls(body: ImageUrlsIn, user=Depends(get_current_user)):
    """Short-lived signed URLs for the caller's own screenshots (bucket is private)."""
    prefix = user["user_id"] + "/"
    paths = [p for p in body.paths[:50] if p.startswith(prefix) and ".." not in p]
    if not paths:
        return {}
    resp = httpx.post(
        f"{SUPABASE_URL}/storage/v1/object/sign/{BUCKET}",
        json={"expiresIn": 3600, "paths": paths},
        headers={"Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"},
        timeout=20,
    )
    if resp.status_code != 200:
        raise HTTPException(502, "Could not sign image URLs")
    return {
        r["path"]: SUPABASE_URL + "/storage/v1" + r["signedURL"]
        for r in resp.json() if r.get("signedURL")
    }
