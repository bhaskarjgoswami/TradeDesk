from fastapi import APIRouter, Depends
from ..auth import get_current_user
from ..database import get_conn

router = APIRouter(prefix="/api", tags=["stats"])


@router.get("/stats")
def stats(user=Depends(get_current_user)):
    uid = user["user_id"]
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT pnl, r_multiple, outcome FROM trades WHERE user_id=%s", (uid,))
            rows = cur.fetchall()
    pnls = [r["pnl"] for r in rows if r["pnl"] is not None]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    gw, gl = sum(wins), abs(sum(losses))
    rs = [r["r_multiple"] for r in rows if r["r_multiple"] is not None]
    decided = [r["outcome"] for r in rows if r["outcome"] in ("Win", "Loss")]
    win_ct = sum(1 for o in decided if o == "Win")
    return {
        "total": len(rows),
        "net_pnl": round(sum(pnls), 2) if pnls else 0,
        "win_rate": round(100 * win_ct / len(decided), 1) if decided else 0,
        "wins": win_ct,
        "losses": len(decided) - win_ct,
        "profit_factor": round(gw / gl, 2) if gl else (gw and 999),
        "avg_r": round(sum(rs) / len(rs), 2) if rs else 0,
        "avg_win": round(sum(wins) / len(wins), 2) if wins else 0,
        "avg_loss": round(sum(losses) / len(losses), 2) if losses else 0,
        "best": round(max(pnls), 2) if pnls else 0,
        "worst": round(min(pnls), 2) if pnls else 0,
    }


def _day_stats(conn, uid: str, date: str) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT pnl, outcome, qty, fee FROM trades WHERE user_id=%s AND date=%s",
            (uid, date),
        )
        rows = cur.fetchall()
    pnls = [r["pnl"] for r in rows if r["pnl"] is not None]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    gw, gl = sum(wins), abs(sum(losses))
    w, l = len(wins), len(losses)
    decided = w + l
    gross = sum(pnls) if pnls else 0
    fees = sum((r["fee"] or 0) for r in rows)
    return {
        "gross_pnl": round(gross, 2),
        "platform_fee": round(fees, 2),
        "net_pnl": round(gross - fees, 2),
        "volume": round(sum((r["qty"] or 0) for r in rows), 2),
        "profit_factor": round(gw / gl, 2) if gl else (999 if gw else 0),
        "total_trades": len(rows),
        "winners": w,
        "losers": l,
        "winrate": round(100 * w / decided, 1) if decided else 0,
    }
