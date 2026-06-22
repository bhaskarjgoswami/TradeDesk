#!/usr/bin/env python3
"""
Trade Journal — a fully local, zero-dependency trade journaling app.

- Pure Python stdlib (http.server + sqlite3 + urllib). No pip install needed.
- Data lives in trades.db right next to this file on /Volumes/My_drive/Trade.
- Live prices proxied from Delta Exchange India public API.

Run:  python3 app.py     (then open http://localhost:8787)
"""

from __future__ import annotations

import json
import os
import sqlite3
import urllib.request
import urllib.parse
import urllib.error
import time
import hmac
import hashlib
import socket
import base64
import secrets
import mimetypes
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

# Force outbound connections over IPv4 so Delta sees a stable IP (home IPv6
# privacy addresses rotate constantly and break the API-key IP whitelist).
_orig_getaddrinfo = socket.getaddrinfo
def _ipv4_only(host, *a, **k):
    res = _orig_getaddrinfo(host, *a, **k)
    v4 = [r for r in res if r[0] == socket.AF_INET]
    return v4 or res
socket.getaddrinfo = _ipv4_only

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "trades.db")
INDEX_PATH = os.path.join(HERE, "index.html")
ENV_PATH = os.path.join(HERE, ".env")
IMAGES_DIR = os.path.join(HERE, "images")
EXCHANGE_PATH = os.path.join(HERE, "exchange.json")


def load_exchange():
    try:
        with open(EXCHANGE_PATH) as f:
            return json.load(f)
    except Exception:
        return {"exchange": "delta", "key": "", "secret": ""}


def save_exchange(data):
    out = {
        "exchange": (data.get("exchange") or "delta"),
        "key": (data.get("key") or "").strip(),
        "secret": (data.get("secret") or "").strip(),
    }
    with open(EXCHANGE_PATH, "w") as f:
        json.dump(out, f)
    return out
PORT = int(os.environ.get("TRADE_PORT", "8787"))

DELTA_BASE = "https://api.india.delta.exchange"


def load_env():
    """Load KEY=VALUE pairs from Trade/.env into os.environ (no overwrite)."""
    if not os.path.exists(ENV_PATH):
        return
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

# Columns that the client may write. id/created_at are managed by the server.
FIELDS = [
    "date", "symbol", "direction", "setup", "tf_bias", "logic",
    "entry", "stop", "exit", "qty", "risk", "pnl", "r_multiple",
    "outcome", "rating", "tags", "notes", "images", "checklist", "fee",
]

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS trades (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                date        TEXT,
                symbol      TEXT,
                direction   TEXT,
                setup       TEXT,
                tf_bias     TEXT,
                logic       TEXT,
                entry       REAL,
                stop        REAL,
                exit        REAL,
                qty         REAL,
                risk        REAL,
                pnl         REAL,
                r_multiple  REAL,
                outcome     TEXT,
                rating      INTEGER,
                tags        TEXT,
                notes       TEXT,
                images      TEXT,
                checklist   TEXT,
                fee         REAL,
                created_at  TEXT
            )
            """
        )
        # migrate older DBs that predate newer columns
        cols = [r[1] for r in conn.execute("PRAGMA table_info(trades)").fetchall()]
        if "images" not in cols:
            conn.execute("ALTER TABLE trades ADD COLUMN images TEXT")
        if "checklist" not in cols:
            conn.execute("ALTER TABLE trades ADD COLUMN checklist TEXT")
        if "fee" not in cols:
            conn.execute("ALTER TABLE trades ADD COLUMN fee REAL")
        conn.commit()
    os.makedirs(IMAGES_DIR, exist_ok=True)


DAY_FIELDS = ["market", "watchlist", "mistakes", "did_great", "reinforcement", "overall", "tags", "checklist"]


def init_day_logs():
    with db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS day_logs (
                date          TEXT PRIMARY KEY,
                market        TEXT,
                watchlist     TEXT,
                mistakes      TEXT,
                did_great     TEXT,
                reinforcement TEXT,
                overall       TEXT,
                tags          TEXT,
                checklist     TEXT,
                created_at    TEXT,
                updated_at    TEXT
            )
            """
        )
        cols = [r[1] for r in conn.execute("PRAGMA table_info(day_logs)").fetchall()]
        if "checklist" not in cols:
            conn.execute("ALTER TABLE day_logs ADD COLUMN checklist TEXT")
        conn.commit()


def row_to_dict(row):
    return {k: row[k] for k in row.keys()}


def list_trades(params):
    q = "SELECT * FROM trades WHERE 1=1"
    args = []
    if params.get("symbol"):
        q += " AND symbol = ?"
        args.append(params["symbol"][0])
    if params.get("setup"):
        q += " AND setup = ?"
        args.append(params["setup"][0])
    if params.get("outcome"):
        q += " AND outcome = ?"
        args.append(params["outcome"][0])
    if params.get("from"):
        q += " AND date >= ?"
        args.append(params["from"][0])
    if params.get("to"):
        q += " AND date <= ?"
        args.append(params["to"][0])
    if params.get("search"):
        s = "%" + params["search"][0] + "%"
        q += " AND (logic LIKE ? OR notes LIKE ? OR tags LIKE ? OR symbol LIKE ? OR setup LIKE ?)"
        args += [s, s, s, s, s]
    q += " ORDER BY date DESC, id DESC"
    with db() as conn:
        rows = conn.execute(q, args).fetchall()
    return [row_to_dict(r) for r in rows]


def create_trade(data):
    cols = [f for f in FIELDS]
    vals = [data.get(f) for f in cols]
    cols.append("created_at")
    vals.append(time.strftime("%Y-%m-%d %H:%M:%S"))
    placeholders = ",".join("?" for _ in cols)
    with db() as conn:
        cur = conn.execute(
            f"INSERT INTO trades ({','.join(cols)}) VALUES ({placeholders})", vals
        )
        conn.commit()
        new_id = cur.lastrowid
        row = conn.execute("SELECT * FROM trades WHERE id=?", (new_id,)).fetchone()
    return row_to_dict(row)


def update_trade(trade_id, data):
    sets = ",".join(f"{f}=?" for f in FIELDS)
    vals = [data.get(f) for f in FIELDS]
    vals.append(trade_id)
    with db() as conn:
        conn.execute(f"UPDATE trades SET {sets} WHERE id=?", vals)
        conn.commit()
        row = conn.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone()
    return row_to_dict(row) if row else None


def delete_trade(trade_id):
    with db() as conn:
        conn.execute("DELETE FROM trades WHERE id=?", (trade_id,))
        conn.commit()


def stats():
    with db() as conn:
        rows = conn.execute("SELECT pnl, r_multiple, outcome FROM trades").fetchall()
    n = len(rows)
    pnls = [r["pnl"] for r in rows if r["pnl"] is not None]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    gross_win = sum(wins)
    gross_loss = abs(sum(losses))
    rs = [r["r_multiple"] for r in rows if r["r_multiple"] is not None]
    decided = [r["outcome"] for r in rows if r["outcome"] in ("Win", "Loss")]
    win_ct = sum(1 for o in decided if o == "Win")
    return {
        "total": n,
        "net_pnl": round(sum(pnls), 2) if pnls else 0,
        "win_rate": round(100 * win_ct / len(decided), 1) if decided else 0,
        "wins": win_ct,
        "losses": len(decided) - win_ct,
        "profit_factor": round(gross_win / gross_loss, 2) if gross_loss else (gross_win and 999),
        "avg_r": round(sum(rs) / len(rs), 2) if rs else 0,
        "avg_win": round(sum(wins) / len(wins), 2) if wins else 0,
        "avg_loss": round(sum(losses) / len(losses), 2) if losses else 0,
        "best": round(max(pnls), 2) if pnls else 0,
        "worst": round(min(pnls), 2) if pnls else 0,
    }


def save_image(data_url):
    """Decode a 'data:image/...;base64,XXX' URL to a file in images/, return rel path."""
    header, b64 = data_url.split(",", 1)
    ext = "png"
    if "image/" in header:
        ext = header.split("image/")[1].split(";")[0]
        if ext == "jpeg":
            ext = "jpg"
    if ext not in ("png", "jpg", "gif", "webp"):
        ext = "png"
    raw = base64.b64decode(b64)
    name = f"{int(time.time())}_{secrets.token_hex(4)}.{ext}"
    os.makedirs(IMAGES_DIR, exist_ok=True)
    with open(os.path.join(IMAGES_DIR, name), "wb") as f:
        f.write(raw)
    return "images/" + name


def day_stats(date):
    with db() as conn:
        rows = conn.execute("SELECT pnl, outcome, qty, fee FROM trades WHERE date=?", (date,)).fetchall()
    pnls = [r["pnl"] for r in rows if r["pnl"] is not None]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    gw, gl = sum(wins), abs(sum(losses))
    n = len(rows)
    w, l = len(wins), len(losses)
    decided = w + l
    gross = sum(pnls) if pnls else 0
    fees = sum((r["fee"] or 0) for r in rows)
    return {
        "gross_pnl": round(gross, 2),
        "commissions": 0,
        "platform_fee": round(fees, 2),
        "net_pnl": round(gross - fees, 2),
        "volume": round(sum((r["qty"] or 0) for r in rows), 2),
        "profit_factor": round(gw / gl, 2) if gl else (999 if gw else 0),
        "total_trades": n,
        "winners": w,
        "losers": l,
        "winrate": round(100 * w / decided, 1) if decided else 0,
    }


def list_daylogs():
    with db() as conn:
        td = [r[0] for r in conn.execute(
            "SELECT DISTINCT date FROM trades WHERE date IS NOT NULL AND date<>''").fetchall()]
        logged = {r[0] for r in conn.execute("SELECT date FROM day_logs").fetchall()}
    dates = sorted(set(td) | logged, reverse=True)
    out = []
    for d in dates:
        s = day_stats(d)
        out.append({
            "date": d,
            "net_pnl": s["net_pnl"],
            "total_trades": s["total_trades"],
            "has_log": d in logged,
        })
    return out


def get_daylog(date):
    with db() as conn:
        row = conn.execute("SELECT * FROM day_logs WHERE date=?", (date,)).fetchone()
        trows = conn.execute("SELECT * FROM trades WHERE date=? ORDER BY id", (date,)).fetchall()
    log = row_to_dict(row) if row else {f: "" for f in DAY_FIELDS}
    return {
        "date": date,
        "log": log,
        "stats": day_stats(date),
        "trades": [row_to_dict(r) for r in trows],
    }


def upsert_daylog(date, data):
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    vals = [data.get(f, "") for f in DAY_FIELDS]
    with db() as conn:
        existing = conn.execute("SELECT date FROM day_logs WHERE date=?", (date,)).fetchone()
        if existing:
            sets = ",".join(f"{f}=?" for f in DAY_FIELDS)
            conn.execute(f"UPDATE day_logs SET {sets}, updated_at=? WHERE date=?", vals + [now, date])
        else:
            cols = DAY_FIELDS + ["date", "created_at", "updated_at"]
            ph = ",".join("?" for _ in cols)
            conn.execute(f"INSERT INTO day_logs ({','.join(cols)}) VALUES ({ph})", vals + [date, now, now])
        conn.commit()
        row = conn.execute("SELECT * FROM day_logs WHERE date=?", (date,)).fetchone()
    return row_to_dict(row)


def delta_price(symbol):
    url = f"{DELTA_BASE}/v2/tickers/{urllib.parse.quote(symbol)}"
    req = urllib.request.Request(url, headers={"User-Agent": "trade-journal"})
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


# ---------------------------------------------------------------------------
# Delta authenticated — pull the user's own executed fills
# ---------------------------------------------------------------------------

def delta_creds():
    ex = load_exchange()
    if ex.get("key") and ex.get("secret"):
        return ex["key"].strip(), ex["secret"].strip()
    key = os.environ.get("DELTA_API_KEY", "").strip()
    secret = os.environ.get("DELTA_API_SECRET", "").strip()
    return key, secret


def delta_signed_get(path, query=""):
    """Signed GET against Delta India. query includes leading '?' if present."""
    key, secret = delta_creds()
    if not key or not secret:
        raise RuntimeError("no-credentials")
    ts = str(int(time.time()))
    sig_data = "GET" + ts + path + query
    sig = hmac.new(secret.encode(), sig_data.encode(), hashlib.sha256).hexdigest()
    headers = {
        "api-key": key,
        "signature": sig,
        "timestamp": ts,
        "User-Agent": "trade-journal",
        "Accept": "application/json",
    }
    url = DELTA_BASE + path + query
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=12) as resp:
        return json.loads(resp.read().decode())


def _fill_day(created_at):
    """Return YYYY-MM-DD for a Delta created_at (ISO string or epoch us/s)."""
    s = str(created_at)
    if s.isdigit():
        n = int(s)
        if n > 1e14:      # microseconds
            n //= 1_000_000
        elif n > 1e11:    # milliseconds
            n //= 1000
        return time.strftime("%Y-%m-%d", time.localtime(n))
    return s[:10]


_CV_CACHE = {}


def _contract_value(symbol):
    """Contract value (e.g. BTCUSD = 0.001 BTC) for correct P&L/notional math."""
    if symbol in _CV_CACHE:
        return _CV_CACHE[symbol]
    cv = 1.0
    try:
        url = f"{DELTA_BASE}/v2/products/{urllib.parse.quote(symbol)}"
        with urllib.request.urlopen(url, timeout=8) as r:
            d = json.loads(r.read().decode())
        cv = float((d.get("result") or {}).get("contract_value") or 1)
    except Exception:
        pass
    _CV_CACHE[symbol] = cv
    return cv


def delta_today_trades():
    """Reconstruct today's trades from fills, split into round-trips.

    Walks each symbol's fills chronologically; a trade runs from flat back to
    flat. Entry = VWAP of opening fills, exit = VWAP of closing fills, and P&L
    is Delta's own realized_pnl (summed across closing fills) — exact, not an
    estimate. Stop is matched from today's stop-loss orders by time + side.
    """
    data = delta_signed_get("/v2/fills", "?page_size=500")
    fills = data.get("result", []) or []
    today = time.strftime("%Y-%m-%d")
    todays = [f for f in fills if _fill_day(f.get("created_at", "")) == today]

    # today's stop-loss orders: (created_at, symbol, stop_price)
    stop_orders = []
    try:
        od = delta_signed_get("/v2/orders/history", "?page_size=200")
        for o in (od.get("result", []) or []):
            if o.get("stop_order_type") == "stop_loss_order" and _fill_day(o.get("created_at", "")) == today:
                if o.get("product_symbol") and o.get("stop_price"):
                    stop_orders.append((str(o["created_at"]), o["product_symbol"], float(o["stop_price"])))
    except Exception:
        pass

    def match_stop(sym, t_open, t_close, direction, entry):
        cands = []
        for (ts, s, sp) in stop_orders:
            if s != sym or not (t_open <= ts <= t_close):
                continue
            # a long's stop sits below entry; a short's above
            if direction == "Long" and sp < entry:
                cands.append((ts, sp))
            elif direction == "Short" and sp > entry:
                cands.append((ts, sp))
        cands.sort()
        return cands[0][1] if cands else None

    by_sym = {}
    for f in todays:
        sym = f.get("product_symbol") or f.get("symbol") or "?"
        by_sym.setdefault(sym, []).append(f)

    trades = []
    for sym, fs in by_sym.items():
        fs.sort(key=lambda f: str(f.get("created_at", "")))
        cv = _contract_value(sym)
        pos = 0.0
        op_side = None
        op_sz = op_not = cl_sz = cl_not = 0.0
        realized = 0.0
        fee = 0.0
        t_open = None

        def flush(t_close, last_fill):
            nonlocal pos, op_side, op_sz, op_not, cl_sz, cl_not, realized, fee, t_open
            entry = round(op_not / op_sz, 4) if op_sz else None
            exit_ = round(cl_not / cl_sz, 4) if cl_sz else None
            direction = "Long" if op_side == "buy" else "Short"
            qty = op_sz
            pnl = round(realized, 4) if cl_sz else None
            outcome = ("Win" if pnl > 0 else "Loss" if pnl < 0 else "BE") if pnl is not None else ""
            stop = match_stop(sym, t_open or "", t_close, direction, entry) if entry else None
            risk = round(abs(entry - stop) * qty * cv, 2) if (entry and stop and qty) else None
            trades.append({
                "date": today, "symbol": sym, "direction": direction,
                "entry": entry, "exit": exit_, "stop": stop, "risk": risk,
                "qty": qty, "pnl": pnl, "fee": round(fee, 4), "outcome": outcome,
                "open": cl_sz == 0, "fills": int(round(op_sz / max(qty, 1))) if qty else 1,
                "cv": cv, "time": (t_open or "")[11:16],
            })
            pos = op_sz = op_not = cl_sz = cl_not = realized = fee = 0.0
            op_side = None
            t_open = None

        for f in fs:
            side = (f.get("side") or "").lower()
            sz = abs(float(f.get("size") or 0))
            px = float(f.get("price") or 0)
            signed = sz if side == "buy" else -sz
            rp = ((f.get("meta_data") or {}).get("new_position") or {}).get("realized_pnl")
            comm = abs(float(f.get("commission") or 0))
            if pos == 0:
                op_side, op_sz, op_not = side, sz, sz * px
                cl_sz = cl_not = realized = 0.0
                fee = comm
                pos = signed
                t_open = str(f.get("created_at", ""))
            elif (pos > 0 and side == "buy") or (pos < 0 and side == "sell"):
                op_sz += sz
                op_not += sz * px
                fee += comm
                pos += signed
            else:
                cl_sz += sz
                cl_not += sz * px
                fee += comm
                if rp is not None:
                    realized += float(rp)
                pos += signed
                if abs(pos) < 1e-9:
                    flush(str(f.get("created_at", "")), f)
        # leftover still-open position
        if op_sz and pos != 0:
            entry = round(op_not / op_sz, 4)
            direction = "Long" if pos > 0 else "Short"
            trades.append({
                "date": today, "symbol": sym, "direction": direction,
                "entry": entry, "exit": None, "stop": None, "risk": None,
                "qty": op_sz, "pnl": None, "fee": round(fee, 4), "outcome": "",
                "open": True, "fills": 1, "cv": cv, "time": (t_open or "")[11:16],
            })

    trades.sort(key=lambda t: (t["open"], t.get("time", "")))
    return trades


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

SESSIONS = set()
SESSIONS_PATH = os.path.join(HERE, "sessions.json")


def load_sessions():
    try:
        with open(SESSIONS_PATH) as f:
            SESSIONS.update(json.load(f))
    except Exception:
        pass


def save_sessions():
    try:
        with open(SESSIONS_PATH, "w") as f:
            json.dump(list(SESSIONS), f)
    except Exception:
        pass


def check_login(email, password):
    want_pw = os.environ.get("APP_PASSWORD", "tradejournal")
    want_em = os.environ.get("APP_EMAIL", "").strip().lower()
    if want_em and email.strip().lower() != want_em:
        return False
    return bool(password) and password == want_pw


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # quiet

    def _send_json(self, obj, code=200, extra_headers=None):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra_headers or []):
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _session_token(self):
        for part in self.headers.get("Cookie", "").split(";"):
            if "=" in part:
                k, v = part.strip().split("=", 1)
                if k == "tj_session":
                    return v
        return None

    def _authed(self):
        t = self._session_token()
        return bool(t and t in SESSIONS)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode())
        except Exception:
            return {}

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = urllib.parse.parse_qs(parsed.query)

        if path in ("/", "/index.html"):
            try:
                with open(INDEX_PATH, "rb") as f:
                    body = f.read()
            except FileNotFoundError:
                self._send_json({"error": "index.html missing"}, 500)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path.startswith("/images/"):
            if not self._authed():
                self._send_json({"error": "unauthorized"}, 401)
                return
            fname = os.path.basename(urllib.parse.unquote(path))
            fp = os.path.join(IMAGES_DIR, fname)
            if os.path.isfile(fp):
                ctype = mimetypes.guess_type(fp)[0] or "application/octet-stream"
                with open(fp, "rb") as f:
                    body = f.read()
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self._send_json({"error": "not found"}, 404)
            return

        if path == "/api/session":
            self._send_json({"authed": self._authed(), "email": os.environ.get("APP_EMAIL", "")})
            return

        if path.startswith("/api/") and not self._authed():
            self._send_json({"error": "unauthorized"}, 401)
            return

        if path == "/api/exchange":
            ex = load_exchange()
            key, secret = delta_creds()  # exchange.json first, then .env
            self._send_json({
                "exchange": ex.get("exchange", "delta"),
                "has_creds": bool(key and secret),
                "key_masked": ("••••" + key[-4:]) if len(key) >= 4 else "",
            })
            return

        if path == "/api/trades":
            self._send_json(list_trades(params))
            return

        if path == "/api/stats":
            self._send_json(stats())
            return

        if path == "/api/daylogs":
            self._send_json(list_daylogs())
            return

        if path == "/api/daylog":
            date = params.get("date", [""])[0]
            self._send_json(get_daylog(date))
            return

        if path == "/api/price":
            sym = params.get("symbol", ["BTCUSD"])[0]
            try:
                self._send_json(delta_price(sym))
            except Exception as e:
                self._send_json({"error": str(e)}, 502)
            return

        if path == "/api/delta/today":
            try:
                self._send_json({"trades": delta_today_trades()})
            except RuntimeError as e:
                if str(e) == "no-credentials":
                    self._send_json({"error": "no-credentials"}, 400)
                else:
                    self._send_json({"error": str(e)}, 502)
            except urllib.error.HTTPError as e:
                msg = f"Delta API {e.code}"
                try:
                    body = json.loads(e.read().decode())
                    err = (body.get("error") or {})
                    code = err.get("code", "")
                    ip = (err.get("context") or {}).get("client_ip", "")
                    if code == "ip_not_whitelisted_for_api_key":
                        msg = f"This IP is not whitelisted on your Delta API key. Add {ip} to the key's allowed IPs on Delta, then try again."
                    elif code:
                        msg = f"Delta: {code}"
                except Exception:
                    pass
                self._send_json({"error": msg}, 502)
            except Exception as e:
                self._send_json({"error": str(e)}, 502)
            return

        self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path == "/api/login":
            data = self._read_body()
            if check_login(data.get("email", ""), data.get("password", "")):
                tok = secrets.token_hex(16)
                SESSIONS.add(tok)
                save_sessions()
                cookie = f"tj_session={tok}; Path=/; SameSite=Lax; Max-Age=2592000"
                self._send_json({"ok": True}, 200, [("Set-Cookie", cookie)])
            else:
                self._send_json({"error": "Invalid email or password"}, 401)
            return
        if self.path == "/api/logout":
            t = self._session_token()
            if t:
                SESSIONS.discard(t)
                save_sessions()
            self._send_json({"ok": True}, 200, [("Set-Cookie", "tj_session=; Path=/; Max-Age=0")])
            return

        if not self._authed():
            self._send_json({"error": "unauthorized"}, 401)
            return
        if self.path == "/api/trades":
            data = self._read_body()
            self._send_json(create_trade(data), 201)
            return
        if self.path == "/api/upload":
            data = self._read_body()
            try:
                self._send_json({"path": save_image(data.get("data", ""))})
            except Exception as e:
                self._send_json({"error": str(e)}, 400)
            return
        if self.path == "/api/exchange":
            save_exchange(self._read_body())
            self._send_json({"ok": True})
            return
        self._send_json({"error": "not found"}, 404)

    def do_PUT(self):
        if not self._authed():
            self._send_json({"error": "unauthorized"}, 401)
            return
        if self.path == "/api/daylog":
            data = self._read_body()
            date = data.get("date")
            if not date:
                self._send_json({"error": "date required"}, 400)
                return
            self._send_json(upsert_daylog(date, data))
            return
        parts = self.path.strip("/").split("/")
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "trades":
            data = self._read_body()
            res = update_trade(int(parts[2]), data)
            self._send_json(res or {"error": "not found"}, 200 if res else 404)
            return
        self._send_json({"error": "not found"}, 404)

    def do_DELETE(self):
        if not self._authed():
            self._send_json({"error": "unauthorized"}, 401)
            return
        parts = self.path.strip("/").split("/")
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "trades":
            delete_trade(int(parts[2]))
            self._send_json({"ok": True})
            return
        self._send_json({"error": "not found"}, 404)


def main():
    load_env()
    init_db()
    init_day_logs()
    load_sessions()
    creds = "✓ connected" if all(delta_creds()) else "✗ no API keys (price-only)"
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    # best-effort LAN IP so phone/tablet on the same wifi can connect
    lan = "127.0.0.1"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        lan = s.getsockname()[0]
        s.close()
    except Exception:
        pass
    print("\n  📓  Trade Journal running")
    print(f"      this Mac : http://localhost:{PORT}")
    print(f"      phone/tablet (same wifi) : http://{lan}:{PORT}")
    print(f"      data: {DB_PATH}")
    print(f"      Delta account: {creds}")
    login_em = os.environ.get("APP_EMAIL", "") or "(any email)"
    login_pw = os.environ.get("APP_PASSWORD", "tradejournal")
    custom = " (set APP_EMAIL / APP_PASSWORD in .env to change)" if not os.environ.get("APP_PASSWORD") else ""
    print(f"      login: {login_em} / password '{login_pw}'{custom}")
    print("      press Ctrl+C to stop\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped.")
        server.shutdown()


if __name__ == "__main__":
    main()
