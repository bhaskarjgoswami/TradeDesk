from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from ..auth import get_current_user
from ..database import get_conn
from ..storage_budget import lock_account_write
from ..billing import active_tier, tier_and_day_count
from ..ratelimit import limit
from .playbooks import assert_owns_playbook
from ..models import TradeIn, ImageUploadIn, ImageUrlsIn, ImportIn, MISTAKES, EMOTIONS
from ..config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import time, base64, secrets, hashlib, json, math, re
from collections import Counter
from datetime import datetime
import httpx
import psycopg2.extras

router = APIRouter(prefix="/api/trades", tags=["trades"])

TRADE_FIELDS = [
    "date", "symbol", "direction", "setup", "tf_bias", "logic",
    "entry", "stop", "exit", "qty", "risk", "pnl", "r_multiple",
    "outcome", "rating", "tags", "notes", "images", "checklist", "fee", "ext_id", "review", "playbook_id",
]


def _vals(body: TradeIn) -> list:
    """Column values in TRADE_FIELDS order; review is stored as JSONB."""
    out = []
    for f in TRADE_FIELDS:
        v = getattr(body, f)
        if f == "review":
            v = psycopg2.extras.Json(v.model_dump()) if v is not None else None
        out.append(v)
    return out

# Free tier: max 2 trades per day. Everything else is unlocked.
FREE_DAILY_LIMIT = 2


def _day_trade_count(conn, user_id: str, date: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) as n FROM trades WHERE user_id=%s AND date=%s",
            (user_id, date),
        )
        return cur.fetchone()["n"]


@router.get("/review-options")
def review_options(user=Depends(get_current_user)):
    return {"mistakes": MISTAKES, "emotions": EMOTIONS}


def _filters(uid, symbol, setup, outcome, from_date, to_date, search):
    """WHERE clause + args shared by the list endpoints."""
    q, args = "user_id=%s", [uid]
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
        s = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        q += " AND (logic ILIKE %s OR notes ILIKE %s OR tags ILIKE %s OR symbol ILIKE %s OR setup ILIKE %s)"
        args += [s, s, s, s, s]
    return q, args


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
    """All matching trades (full rows). Used for exports and date-bounded views."""
    where, args = _filters(user["user_id"], symbol, setup, outcome, from_date, to_date, search)
    with get_conn(readonly=True) as conn:
        with conn.cursor() as cur:
            cur.execute(f"SELECT * FROM trades WHERE {where} ORDER BY date DESC, id DESC", args)
            return cur.fetchall()


@router.get("/page")
def page_trades(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    search: Optional[str] = None,
    user=Depends(get_current_user),
):
    """One page of trades for the list view, newest first, with the total count."""
    where, args = _filters(user["user_id"], None, None, None, None, None, search)
    with get_conn(readonly=True) as conn:
        with conn.cursor() as cur:
            # one round trip: the window count rides along with the page rows
            cur.execute(
                f"SELECT *, COUNT(*) OVER() AS _total FROM trades WHERE {where} "
                "ORDER BY date DESC, id DESC LIMIT %s OFFSET %s",
                args + [limit, offset],
            )
            rows = cur.fetchall()
            if rows:
                total = rows[0]["_total"]
            else:  # past the end (or no matches): count separately
                cur.execute(f"SELECT COUNT(*) AS n FROM trades WHERE {where}", args)
                total = cur.fetchone()["n"]
            for r in rows:
                del r["_total"]
            return {"rows": rows, "total": total}


@router.get("/analytics")
def analytics_rows(user=Depends(get_current_user)):
    """Slim rows for Performance: only the fields the breakdowns use (no notes/images)."""
    with get_conn(readonly=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, date, symbol, direction, setup, pnl, fee, r_multiple, review, playbook_id "
                "FROM trades WHERE user_id=%s ORDER BY date, id",
                (user["user_id"],),
            )
            return cur.fetchall()


@router.post("", status_code=201)
def create_trade(body: TradeIn, user=Depends(get_current_user)):
    with get_conn() as conn:
        lock_account_write(conn,user['user_id'])
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

        assert_owns_playbook(conn, user["user_id"], body.playbook_id)
        # free tier gate (expiry-aware: lapsed Pro counts as free)
        day = body.date or time.strftime("%Y-%m-%d")
        tier, day_count = tier_and_day_count(conn, user["user_id"], day)
        if tier != "pro" and day_count >= FREE_DAILY_LIMIT:
            raise HTTPException(402, "free-daily-limit")

        cols = TRADE_FIELDS + ["user_id", "created_at"]
        vals = _vals(body) + [user["user_id"], time.strftime("%Y-%m-%d %H:%M:%S")]
        ph = ",".join(["%s"] * len(cols))
        with conn.cursor() as cur:
            cur.execute(f"INSERT INTO trades ({','.join(cols)}) VALUES ({ph}) RETURNING *", vals)
            return cur.fetchone()


# ── CSV import ───────────────────────────────────────────
# Same column format as the local journal's importer, so it can migrate here.
IMPORT_TEXT = ["date", "symbol", "direction", "setup", "notes", "tags"]
IMPORT_NUM = ["entry", "stop", "exit", "qty", "pnl", "fee", "risk", "r_multiple", "contract_value"]
NON_NEGATIVE = {"entry", "stop", "exit", "qty", "fee", "risk"}
MAX_IMPORT_ROWS = 1000


def _import_row(raw: dict, n: int) -> dict:
    """Validate one CSV row; raise ValueError naming the row on bad input."""
    if not isinstance(raw, dict):
        raise ValueError(f"Row {n}: invalid row")
    row = {}
    for f in IMPORT_TEXT:
        v = str(raw.get(f) or "").strip()
        if len(v) > (10000 if f == "notes" else 2000):
            raise ValueError(f"Row {n}: {f} is too long")
        row[f] = v
    for f in IMPORT_NUM:
        v = raw.get(f)
        if v in ("", None):
            row[f] = None
            continue
        try:
            x = float(str(v).replace(",", ""))
        except ValueError:
            raise ValueError(f"Row {n}: {f} must be a number")
        if not math.isfinite(x) or abs(x) > 1e12 or (f in NON_NEGATIVE and x < 0) or (f == "contract_value" and x <= 0):
            raise ValueError(f"Row {n}: invalid {f}")
        row[f] = x
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", row["date"]):
            raise ValueError
        datetime.strptime(row["date"], "%Y-%m-%d")
    except ValueError:
        raise ValueError(f"Row {n}: date must be YYYY-MM-DD")
    row["direction"] = row["direction"].capitalize()
    if not row["symbol"] or row["direction"] not in ("Long", "Short"):
        raise ValueError(f"Row {n}: needs a symbol and Long/Short direction")
    row["symbol"] = row["symbol"].upper()

    sign = -1 if row["direction"] == "Short" else 1
    cv = row.pop("contract_value")
    e, s_, x_, q = row["entry"], row["stop"], row["exit"], row["qty"]
    if row["pnl"] is None and None not in (e, x_, q):
        if cv is None:raise ValueError(f"Row {n}: provide a contract multiplier or broker P&L")
        row["pnl"] = round((x_ - e) * q * cv * sign, 8)
    if row["risk"] is None and None not in (e, s_, q, cv):
        row["risk"] = round(abs(e - s_) * q * cv, 8)
    if row["r_multiple"] is None and None not in (e, s_, x_) and e != s_:
        row["r_multiple"] = round((x_ - e) / abs(e - s_) * sign, 4)
    net = None if row["pnl"] is None else row["pnl"] - (row["fee"] or 0)
    row["outcome"] = None if net is None else "Win" if net > 0 else "Loss" if net < 0 else "BE"
    # identical CSV records are skipped on re-import
    row["ext_id"] = "csv:" + hashlib.sha256(json.dumps(row, sort_keys=True).encode()).hexdigest()[:40]
    return row


@router.post("/import")
def import_trades(body: ImportIn, user=Depends(limit("import", 10))):
    if not 1 <= len(body.rows) <= MAX_IMPORT_ROWS:
        raise HTTPException(400, f"Import between 1 and {MAX_IMPORT_ROWS:,} trades at a time")
    errors, rows = [], []
    for n, raw in enumerate(body.rows, start=2):  # row 1 is the CSV header
        try:
            rows.append(_import_row(raw, n))
        except ValueError as e:
            errors.append(str(e))
    if errors:  # all-or-nothing: fix the file, then import
        return {"ok": False, "errors": errors[:50], "error_count": len(errors), "valid": len(rows)}

    uid = user["user_id"]
    with get_conn() as conn:
        lock_account_write(conn,user['user_id'])
        with conn.cursor() as cur:
            cur.execute(
                "SELECT ext_id FROM trades WHERE user_id=%s AND ext_id = ANY(%s)",
                (uid, [r["ext_id"] for r in rows]),
            )
            have = {r["ext_id"] for r in cur.fetchall()}
            seen, fresh = set(), []
            for r in rows:
                if r["ext_id"] not in have and r["ext_id"] not in seen:
                    seen.add(r["ext_id"]); fresh.append(r)
            duplicates = len(rows) - len(fresh)

            over_limit = 0
            if active_tier(conn, uid) != "pro":
                days = sorted({r["date"] for r in fresh})
                cur.execute(
                    "SELECT date, COUNT(*) AS n FROM trades WHERE user_id=%s AND date = ANY(%s) GROUP BY date",
                    (uid, days),
                )
                used = Counter({r["date"]: r["n"] for r in cur.fetchall()})
                kept = []
                for r in fresh:
                    if used[r["date"]] < FREE_DAILY_LIMIT:
                        used[r["date"]] += 1; kept.append(r)
                over_limit = len(fresh) - len(kept)
                fresh = kept

            summary = {"ok": True, "to_import": len(fresh), "duplicates": duplicates, "over_free_limit": over_limit}
            if body.dry_run or not fresh:
                return {**summary, "imported": 0}
            cols = list(fresh[0]) + ["user_id", "created_at"]
            now = time.strftime("%Y-%m-%d %H:%M:%S")
            psycopg2.extras.execute_values(
                cur,
                f"INSERT INTO trades ({','.join(cols)}) VALUES %s "
                "ON CONFLICT (user_id, ext_id) WHERE ext_id IS NOT NULL DO NOTHING",
                [[r[c] for c in cols[:-2]] + [uid, now] for r in fresh],
            )
            return {**summary, "imported": cur.rowcount}


@router.put("/{trade_id}")
def update_trade(trade_id: int, body: TradeIn, user=Depends(get_current_user)):
    sets = ",".join(f"{f}=%s" for f in TRADE_FIELDS)
    vals = _vals(body) + [user["user_id"], trade_id]
    with get_conn() as conn:
        lock_account_write(conn,user['user_id'])
        with conn.cursor() as cur:
            cur.execute("SELECT date FROM trades WHERE user_id=%s AND id=%s", (user["user_id"], trade_id))
            old = cur.fetchone()
            if not old:
                raise HTTPException(404, "Trade not found")
        assert_owns_playbook(conn, user["user_id"], body.playbook_id)
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
        lock_account_write(conn,user['user_id'])
        with conn.cursor() as cur:
            cur.execute("DELETE FROM trades WHERE user_id=%s AND id=%s", (user["user_id"], trade_id))
    return {"ok": True}


MAX_IMAGE_BYTES = 5 * 1024 * 1024
IMAGE_TYPES = {"png": "png", "jpeg": "jpg", "jpg": "jpg", "gif": "gif", "webp": "webp"}
BUCKET = "trade-images"


@router.post("/upload")
def upload_image(body: ImageUploadIn, user=Depends(limit("upload", 20))):
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
    from ..storage_budget import storage_budget
    with storage_budget(user['user_id'],len(raw)):
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
def image_urls(body: ImageUrlsIn, user=Depends(limit("image-urls", 60))):
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
