"""
Delta Exchange routes — price ticker (public) and authenticated fills pull (Pro).
Keys are stored per-user in the user_profiles table (encrypted at rest by Postgres).
"""
from fastapi import APIRouter, Depends, HTTPException
from ..auth import get_current_user, get_pro_user
from ..database import get_conn
from ..models import ExchangeIn
import urllib.request, urllib.parse, urllib.error
import json, time, hmac, hashlib, socket

router = APIRouter(prefix="/api", tags=["exchange"])

DELTA_BASE = "https://api.india.delta.exchange"

# Force IPv4 (home Jio IPv6 rotates and breaks Delta IP whitelist)
_orig = socket.getaddrinfo
def _v4(host, *a, **k):
    res = _orig(host, *a, **k)
    v4 = [r for r in res if r[0] == socket.AF_INET]
    return v4 or res
socket.getaddrinfo = _v4


# ── Exchange key CRUD ────────────────────────────────────

@router.get("/exchange")
def get_exchange(user=Depends(get_current_user)):
    uid = user["user_id"]
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT delta_key, delta_secret FROM user_profiles WHERE id=%s", (uid,))
            row = cur.fetchone()
    key = (row["delta_key"] or "") if row else ""
    return {
        "exchange": "delta",
        "has_creds": bool(key),
        "key_masked": ("••••" + key[-4:]) if len(key) >= 4 else "",
    }


@router.post("/exchange")
def save_exchange(body: ExchangeIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE user_profiles SET delta_key=%s, delta_secret=%s WHERE id=%s""",
                (body.key.strip(), body.secret.strip(), uid),
            )
    return {"ok": True}


# ── Public price ticker ──────────────────────────────────

@router.get("/price")
def price(symbol: str = "BTCUSD", user=Depends(get_current_user)):
    url = f"{DELTA_BASE}/v2/tickers/{urllib.parse.quote(symbol)}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "tradedesk"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode())
        r = data.get("result", {}) or {}
        return {
            "symbol": r.get("symbol"),
            "mark_price": r.get("mark_price"),
            "spot_price": r.get("spot_price"),
            "close": r.get("close"),
            "change": r.get("mark_change_24h"),
            "ts": int(time.time()),
        }
    except Exception as e:
        raise HTTPException(502, str(e))


# ── Authenticated: pull today's fills (Pro) ──────────────

def _signed_get(key: str, secret: str, path: str, query: str = ""):
    ts = str(int(time.time()))
    sig = hmac.new(secret.encode(), ("GET" + ts + path + query).encode(), hashlib.sha256).hexdigest()
    headers = {
        "api-key": key, "signature": sig, "timestamp": ts,
        "User-Agent": "tradedesk", "Accept": "application/json",
    }
    req = urllib.request.Request(DELTA_BASE + path + query, headers=headers)
    with urllib.request.urlopen(req, timeout=12) as resp:
        return json.loads(resp.read().decode())


def _fill_day(ts):
    s = str(ts)
    if s.isdigit():
        n = int(s)
        if n > 1e14: n //= 1_000_000
        elif n > 1e11: n //= 1000
        return time.strftime("%Y-%m-%d", time.localtime(n))
    return s[:10]


_CV: dict = {}
def _cv(sym):
    if sym in _CV: return _CV[sym]
    v = 1.0
    try:
        with urllib.request.urlopen(f"{DELTA_BASE}/v2/products/{urllib.parse.quote(sym)}", timeout=8) as r:
            v = float((json.loads(r.read().decode()).get("result") or {}).get("contract_value") or 1)
    except Exception:
        pass
    _CV[sym] = v; return v


@router.get("/delta/today")
def delta_today(user=Depends(get_pro_user)):
    uid = user["user_id"]
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT delta_key, delta_secret FROM user_profiles WHERE id=%s", (uid,))
            row = cur.fetchone()
    if not row or not row["delta_key"]:
        raise HTTPException(400, "no-credentials")
    key, secret = row["delta_key"], row["delta_secret"]
    try:
        today = time.strftime("%Y-%m-%d")
        fills = (_signed_get(key, secret, "/v2/fills", "?page_size=500").get("result") or [])
        todays = [f for f in fills if _fill_day(f.get("created_at", "")) == today]
        stop_orders = []
        try:
            for o in (_signed_get(key, secret, "/v2/orders/history", "?page_size=200").get("result") or []):
                if o.get("stop_order_type") == "stop_loss_order" and _fill_day(o.get("created_at", "")) == today:
                    if o.get("product_symbol") and o.get("stop_price"):
                        stop_orders.append((str(o["created_at"]), o["product_symbol"], float(o["stop_price"])))
        except Exception:
            pass

        def match_stop(sym, t_open, t_close, direction, entry):
            cands = [(ts, sp) for ts, s, sp in stop_orders if s == sym and t_open <= ts <= t_close
                     and ((direction == "Long" and sp < entry) or (direction == "Short" and sp > entry))]
            return sorted(cands)[0][1] if cands else None

        by_sym: dict = {}
        for f in todays:
            by_sym.setdefault(f.get("product_symbol") or "?", []).append(f)

        trades = []
        for sym, fs in by_sym.items():
            fs.sort(key=lambda f: str(f.get("created_at", "")))
            cv = _cv(sym)
            pos = op_side = None
            op_sz = op_not = cl_sz = cl_not = realized = fee = 0.0
            t_open = None

            def flush(t_close):
                nonlocal pos, op_side, op_sz, op_not, cl_sz, cl_not, realized, fee, t_open
                entry = round(op_not / op_sz, 4) if op_sz else None
                exit_ = round(cl_not / cl_sz, 4) if cl_sz else None
                direction = "Long" if op_side == "buy" else "Short"
                pnl = round(realized, 4) if cl_sz else None
                stop = match_stop(sym, t_open or "", t_close, direction, entry) if entry else None
                risk = round(abs(entry - stop) * op_sz * cv, 2) if (entry and stop) else None
                trades.append({
                    "date": today, "symbol": sym, "direction": direction,
                    "entry": entry, "exit": exit_, "stop": stop, "risk": risk,
                    "qty": op_sz, "pnl": pnl, "fee": round(fee, 4),
                    "outcome": ("Win" if pnl > 0 else "Loss" if pnl < 0 else "BE") if pnl is not None else "",
                    "open": cl_sz == 0, "time": (t_open or "")[11:16],
                })
                pos, op_side, op_sz, op_not, cl_sz, cl_not, realized, fee, t_open = None, None, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, None

            for f in fs:
                side = (f.get("side") or "").lower()
                sz = abs(float(f.get("size") or 0))
                px = float(f.get("price") or 0)
                signed = sz if side == "buy" else -sz
                rp = ((f.get("meta_data") or {}).get("new_position") or {}).get("realized_pnl")
                comm = abs(float(f.get("commission") or 0))
                if pos is None or pos == 0:
                    op_side, op_sz, op_not, cl_sz, cl_not, realized, fee = side, sz, sz * px, 0.0, 0.0, 0.0, comm
                    pos, t_open = signed, str(f.get("created_at", ""))
                elif (pos > 0 and side == "buy") or (pos < 0 and side == "sell"):
                    op_sz += sz; op_not += sz * px; fee += comm; pos += signed
                else:
                    cl_sz += sz; cl_not += sz * px; fee += comm
                    if rp is not None: realized += float(rp)
                    pos += signed
                    if abs(pos) < 1e-9:
                        flush(str(f.get("created_at", "")))

            if op_sz and pos:
                trades.append({
                    "date": today, "symbol": sym,
                    "direction": "Long" if pos > 0 else "Short",
                    "entry": round(op_not / op_sz, 4), "exit": None, "stop": None, "risk": None,
                    "qty": op_sz, "pnl": None, "fee": round(fee, 4), "outcome": "",
                    "open": True, "time": (t_open or "")[11:16],
                })

        trades.sort(key=lambda t: (t["open"], t.get("time", "")))
        return {"trades": trades}
    except urllib.error.HTTPError as e:
        msg = f"Delta API {e.code}"
        try:
            body = json.loads(e.read().decode())
            code = (body.get("error") or {}).get("code", "")
            ip = ((body.get("error") or {}).get("context") or {}).get("client_ip", "")
            if code == "ip_not_whitelisted_for_api_key":
                msg = f"IP not whitelisted on Delta key. Add {ip} to your key's allowed IPs."
            elif code:
                msg = f"Delta: {code}"
        except Exception:
            pass
        raise HTTPException(502, msg)
    except Exception as e:
        raise HTTPException(502, str(e))
