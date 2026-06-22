from fastapi import APIRouter, Depends, HTTPException
from ..auth import get_current_user
from ..database import get_conn
from ..models import DayLogIn
from .stats import _day_stats
import time

router = APIRouter(prefix="/api", tags=["daylogs"])

DAY_FIELDS = ["market", "watchlist", "mistakes", "did_great", "reinforcement", "overall", "tags", "checklist"]


@router.get("/daylogs")
def list_daylogs(user=Depends(get_current_user)):
    uid = user["user_id"]
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT date FROM trades WHERE user_id=%s AND date IS NOT NULL AND date<>''",
                (uid,),
            )
            trade_dates = {r["date"] for r in cur.fetchall()}
            cur.execute("SELECT date FROM day_logs WHERE user_id=%s", (uid,))
            logged = {r["date"] for r in cur.fetchall()}
        dates = sorted(trade_dates | logged, reverse=True)
        out = []
        for d in dates:
            s = _day_stats(conn, uid, d)
            out.append({
                "date": d,
                "net_pnl": s["net_pnl"],
                "total_trades": s["total_trades"],
                "has_log": d in logged,
            })
    return out


@router.get("/daylog")
def get_daylog(date: str, user=Depends(get_current_user)):
    uid = user["user_id"]
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM day_logs WHERE user_id=%s AND date=%s", (uid, date))
            row = cur.fetchone()
            cur.execute(
                "SELECT * FROM trades WHERE user_id=%s AND date=%s ORDER BY id",
                (uid, date),
            )
            trades = cur.fetchall()
        log = dict(row) if row else {f: "" for f in DAY_FIELDS}
        return {
            "date": date,
            "log": log,
            "stats": _day_stats(conn, uid, date),
            "trades": trades,
        }


@router.put("/daylog")
def upsert_daylog(body: DayLogIn, user=Depends(get_current_user)):
    if not body.date:
        raise HTTPException(400, "date required")
    uid = user["user_id"]
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    vals = [getattr(body, f, "") for f in DAY_FIELDS]
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT date FROM day_logs WHERE user_id=%s AND date=%s", (uid, body.date))
            exists = cur.fetchone()
            if exists:
                sets = ",".join(f"{f}=%s" for f in DAY_FIELDS)
                cur.execute(
                    f"UPDATE day_logs SET {sets}, updated_at=%s WHERE user_id=%s AND date=%s RETURNING *",
                    vals + [now, uid, body.date],
                )
            else:
                cols = DAY_FIELDS + ["user_id", "date", "created_at", "updated_at"]
                ph = ",".join(["%s"] * len(cols))
                cur.execute(
                    f"INSERT INTO day_logs ({','.join(cols)}) VALUES ({ph}) RETURNING *",
                    vals + [uid, body.date, now, now],
                )
            return cur.fetchone()
