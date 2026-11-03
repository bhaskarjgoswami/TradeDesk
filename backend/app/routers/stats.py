from fastapi import APIRouter, Depends
from ..auth import get_current_user
from ..database import get_conn

router = APIRouter(prefix="/api", tags=["stats"])


def _summary(rows) -> dict:
    """Closed-trade stats on net P&L (gross pnl minus fee).

    Win rate = wins / (wins + losses); BE and open trades excluded.
    Profit factor = gross wins / gross losses; 999 means no losing trades.
    """
    nets = [float(r["pnl"]) - float(r["fee"] or 0) for r in rows if r["pnl"] is not None]
    wins = [p for p in nets if p > 0]
    losses = [p for p in nets if p < 0]
    gw, gl = sum(wins), abs(sum(losses))
    decided = len(wins) + len(losses)
    return {
        "nets": nets, "wins": wins, "losses": losses,
        "net_pnl": round(sum(nets), 2),
        "profit_factor": round(gw / gl, 2) if gl else (999 if gw else 0),
        "win_rate": round(100 * len(wins) / decided, 1) if decided else 0,
    }


@router.get("/stats")
def stats(user=Depends(get_current_user)):
    uid = user["user_id"]
    with get_conn(readonly=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT pnl, fee, r_multiple FROM trades WHERE user_id=%s ORDER BY date, id", (uid,)
            )
            rows = cur.fetchall()
    s = _summary(rows)
    wins, losses, nets = s["wins"], s["losses"], s["nets"]
    rs = [float(r["r_multiple"]) for r in rows if r["r_multiple"] is not None]
    gross = sum(float(r["pnl"]) for r in rows if r["pnl"] is not None)
    return {
        "closed": len(nets),
        "gross_pnl": round(gross, 2),
        "fees": round(gross - s["net_pnl"], 2),
        "expectancy": round(sum(nets) / len(nets), 2) if nets else 0,
        "max_drawdown": _max_drawdown(nets),
        "total": len(rows),
        "net_pnl": s["net_pnl"],
        "win_rate": s["win_rate"],
        "wins": len(wins),
        "losses": len(losses),
        "profit_factor": s["profit_factor"],
        "avg_r": round(sum(rs) / len(rs), 2) if rs else 0,
        "avg_win": round(sum(wins) / len(wins), 2) if wins else 0,
        "avg_loss": round(sum(losses) / len(losses), 2) if losses else 0,
        "best": round(max(nets), 2) if nets else 0,
        "worst": round(min(nets), 2) if nets else 0,
    }


def _max_drawdown(nets) -> float:
    """Largest fall from a running equity peak (equity starts at 0), as a negative number."""
    peak = equity = dd = 0.0
    for n in nets:
        equity += n
        peak = max(peak, equity)
        dd = min(dd, equity - peak)
    return round(dd, 2)


def _day_stats(conn, uid: str, date: str) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT pnl, qty, fee FROM trades WHERE user_id=%s AND date=%s",
            (uid, date),
        )
        rows = cur.fetchall()
    s = _summary(rows)
    gross = sum(float(r["pnl"]) for r in rows if r["pnl"] is not None)
    fees = sum(float(r["fee"] or 0) for r in rows if r["pnl"] is not None)  # closed trades, so gross - fee = net
    return {
        "gross_pnl": round(gross, 2),
        "platform_fee": round(fees, 2),
        "net_pnl": s["net_pnl"],
        "volume": round(sum(float(r["qty"] or 0) for r in rows), 2),
        "profit_factor": s["profit_factor"],
        "total_trades": len(rows),
        "winners": len(s["wins"]),
        "losers": len(s["losses"]),
        "winrate": s["win_rate"],
    }
