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
import workspace
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
    "outcome", "rating", "tags", "notes", "images", "checklist", "fee", "plan",
    "review", "strategy_id", "entry_time", "exit_time", "contract_value",
    "target", "swap",
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
        if "plan" not in cols:
            conn.execute("ALTER TABLE trades ADD COLUMN plan TEXT")
        conn.commit()
    os.makedirs(IMAGES_DIR, exist_ok=True)


DAY_FIELDS = ["market", "watchlist", "mistakes", "did_great", "reinforcement", "overall", "tags", "checklist", "grade", "loop"]


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
        # Daily loop: day grade and before/during/after step state (JSON).
        for name in ("grade", "loop"):
            if name not in cols:
                conn.execute(f"ALTER TABLE day_logs ADD COLUMN {name} TEXT")
        conn.commit()


# Shared plan defaults are stored in the journal database, behind the existing login.
DEFAULT_PLAN_SETTINGS = json.loads('{"version": 1, "defaultType": "golden", "active": true, "templates": {"golden": {"charting": ["Mark the higher-timeframe range and premium / discount.", "Mark liquidity: previous-day highs / lows and equal highs / lows.", "Decide the context: continuation, pullback or reversal.", "Pick one target: opposing zone or structure.", "Define invalidation: “My bias is wrong if price breaks and holds beyond…”"], "management": ["Predefine risk before entry: fixed R, no resizing mid-trade.", "Set and forget.", "If invalidation hits, exit and reassess. No “one more trade to make it back.”"], "exitRules": "", "notes": ["Bias is a plan and invalidation, not a prediction.", "If you cannot say your bias in one sentence, you do not have one.", "If invalidation hits: reset. No coping, no revenge trade.", "Build trust in your system with data.", "Conviction → confidence → competence → consistency."], "setupImages": [], "entryImages": [], "name": "The 5 Golden Rules", "criteria": ["Bias alignment", "High probability POI", "Liquidity sweep + market shift", "During killzone", "Asymmetric risk to reward"]}, "custom": {"charting": ["Mark the higher-timeframe range and premium / discount.", "Mark liquidity: previous-day highs / lows and equal highs / lows.", "Decide the context: continuation, pullback or reversal.", "Pick one target: opposing zone or structure.", "Define invalidation: “My bias is wrong if price breaks and holds beyond…”"], "management": ["Predefine risk before entry: fixed R, no resizing mid-trade.", "Set and forget.", "If invalidation hits, exit and reassess. No “one more trade to make it back.”"], "exitRules": "", "notes": ["Bias is a plan and invalidation, not a prediction.", "If you cannot say your bias in one sentence, you do not have one.", "If invalidation hits: reset. No coping, no revenge trade.", "Build trust in your system with data.", "Conviction → confidence → competence → consistency."], "setupImages": [], "entryImages": [], "name": "My custom checklist", "criteria": ["High time frame bias", "Liquidity take", "Low Time frame bias sync with HTF", "LTF CHoCH", "Candle high/low cross confirmation"]}}}')


class SettingsConflict(ValueError):
    pass


def init_plan_settings():
    with db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS journal_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, revision INTEGER NOT NULL)")


def validate_plan_settings(value):
    import re
    if not isinstance(value, dict) or value.get('version') != 1:
        raise ValueError('Unsupported plan settings version')
    if value.get('defaultType') not in ('golden', 'custom') or not isinstance(value.get('active'), bool):
        raise ValueError('Choose a valid default plan and Active state')
    templates = value.get('templates')
    if not isinstance(templates, dict) or set(templates) != {'golden', 'custom'}:
        raise ValueError('Both plan templates are required')
    def text(v, label, limit, required=False):
        if not isinstance(v, str) or len(v) > limit or (required and not v.strip()):
            raise ValueError(label + ' is missing or too long')
        return v.strip()
    def lines(v, label, limit, required=False):
        if not isinstance(v, list) or len(v) > limit or (required and not v):
            raise ValueError(label + ' has an invalid number of items')
        result = [text(item, label, 500, True) for item in v]
        if len(set(item.casefold() for item in result)) != len(result):
            raise ValueError(label + ' contains duplicate items')
        return result
    def images(v):
        if not isinstance(v, list) or len(v) > 8:
            raise ValueError('Use at most 8 reference charts per group')
        if any(not isinstance(item, str) or not re.fullmatch(r'images/[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp|gif)', item) for item in v):
            raise ValueError('Reference charts must be uploaded to this journal')
        return list(dict.fromkeys(v))
    clean = dict(version=1, defaultType=value['defaultType'], active=value['active'], templates={})
    for key, plan in templates.items():
        if not isinstance(plan, dict):
            raise ValueError('Invalid plan template')
        clean['templates'][key] = dict(
            name=text(plan.get('name'), 'Plan name', 80, True),
            criteria=lines(plan.get('criteria'), 'Entry criteria', 25, True),
            charting=lines(plan.get('charting'), 'Charting steps', 15),
            management=lines(plan.get('management'), 'Management rules', 15),
            exitRules=text(plan.get('exitRules'), 'Exit rules', 4000),
            notes=lines(plan.get('notes'), 'Trading notes', 25),
            setupImages=images(plan.get('setupImages')), entryImages=images(plan.get('entryImages')))
    return clean


def get_plan_settings():
    with db() as conn:
        row = conn.execute("SELECT value, revision FROM journal_settings WHERE key='trade_plan'").fetchone()
    if row:
        return dict(settings=validate_plan_settings(json.loads(row['value'])), revision=row['revision'], customized=True)
    return dict(settings=json.loads(json.dumps(DEFAULT_PLAN_SETTINGS)), revision=0, customized=False)


def save_plan_settings(body):
    if not isinstance(body, dict):
        raise ValueError('Plan settings are required')
    revision = body.get('revision')
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise ValueError('A valid settings revision is required')
    clean = validate_plan_settings(body.get('settings'))
    with db() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute("SELECT revision FROM journal_settings WHERE key='trade_plan'").fetchone()
        current = row['revision'] if row else 0
        if revision != current:
            raise SettingsConflict('Settings changed in another tab. Reload the saved defaults before saving again.')
        conn.execute("INSERT INTO journal_settings(key,value,revision) VALUES('trade_plan',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=excluded.revision",
                     (json.dumps(clean, ensure_ascii=False), current + 1))
    return dict(settings=clean, revision=current + 1, customized=True)


DEFAULT_ROUTINE = dict(enabled=True, showAll=True, autoHide=True, popup=False, resetTime='00:00', steps=[
    dict(id='news', title='Review news on the economic calendar', action='none', icon='calendar'),
    dict(id='plan', title='Review your trade plan', action='preferences', icon='target'),
    dict(id='meditate', title='Meditate (15 mins)', action='focus', icon='calm')])


def init_routine():
    with db() as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS routine_progress (period TEXT PRIMARY KEY, checked TEXT NOT NULL)')
        cols={r[1] for r in conn.execute('PRAGMA table_info(routine_progress)')}
        if 'ticked_at' not in cols:   # local time of the latest tick; a trade after it resets the routine
            conn.execute('ALTER TABLE routine_progress ADD COLUMN ticked_at TEXT')


def validate_routine(value):
    import re
    if not isinstance(value, dict) or any(not isinstance(value.get(k), bool) for k in ('enabled', 'showAll', 'autoHide')):
        raise ValueError('Routine switches must be on or off')
    if not isinstance(value.get('popup', False), bool):
        raise ValueError('Routine switches must be on or off')
    reset = value.get('resetTime')
    if not isinstance(reset, str) or not re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]', reset):
        raise ValueError('Choose a valid UTC reset time')
    steps = value.get('steps')
    if not isinstance(steps, list) or not 1 <= len(steps) <= 6:
        raise ValueError('Use between 1 and 6 routine steps')
    clean=[]
    for step in steps:
        if not isinstance(step, dict):
            raise ValueError('Invalid routine step')
        key, title = step.get('id'), step.get('title')
        if not isinstance(key, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', key):
            raise ValueError('Invalid routine step ID')
        if not isinstance(title, str) or not title.strip() or len(title)>200:
            raise ValueError('Each routine step needs a title of up to 200 characters')
        if step.get('action') not in ('none','journal','preferences','performance','focus') or step.get('icon') not in ('calendar','target','chart','calm'):
            raise ValueError('Choose a valid routine icon and action')
        med=step.get('meditation') or ''
        if not isinstance(med,str) or (med and not re.fullmatch(r'[a-z0-9-]{1,40}',med)):
            raise ValueError('Choose a valid meditation template')
        clean.append(dict(id=key,title=title.strip(),action=step['action'],icon=step['icon'],meditation=med))
    if len({step['id'] for step in clean}) != len(clean):
        raise ValueError('Routine step IDs must be unique')
    return dict(enabled=value['enabled'],showAll=value['showAll'],autoHide=value['autoHide'],popup=value.get('popup',False),resetTime=reset,steps=clean)


def routine_state():
    from datetime import datetime, timedelta, timezone
    with db() as conn:
        row=conn.execute("SELECT value,revision FROM journal_settings WHERE key='routine'").fetchone()
        settings=validate_routine(json.loads(row['value'])) if row else json.loads(json.dumps(DEFAULT_ROUTINE))
        hours,minutes=map(int,settings['resetTime'].split(':'))
        now=datetime.now(timezone.utc)
        boundary=now.replace(hour=hours,minute=minutes,second=0,microsecond=0)
        if now < boundary:
            boundary-=timedelta(days=1)
        period=boundary.isoformat()
        progress=conn.execute('SELECT checked,ticked_at FROM routine_progress WHERE period=?',(period,)).fetchone()
        checked=json.loads(progress['checked']) if progress else []
        reset=None
        # Plan ticks are stored by item position, so they only make sense for the plan they were ticked on.
        # If the active plan changed since, drop them and the pending checklist.
        pend=conn.execute("SELECT value FROM journal_settings WHERE key='pending_checklist'").fetchone()
        if pend and json.loads(pend['value']).get('planId')!=routine_active_plan(conn)[0]:
            conn.execute("DELETE FROM journal_settings WHERE key='pending_checklist'")
            checked=[k for k in checked if '::' not in k]
            conn.execute('UPDATE routine_progress SET checked=? WHERE period=?',(json.dumps(checked),period))
            conn.commit()
        # A trade taken after the latest tick means the routine was used: start fresh for the next trade.
        ticked_at=progress['ticked_at'] if progress else None
        if checked and ticked_at:
            hit=conn.execute("""SELECT symbol,COALESCE(NULLIF(entry_time,''),REPLACE(created_at,' ','T')) AS at FROM trades
                WHERE (entry_time IS NOT NULL AND entry_time<>'' AND entry_time>=?)
                   OR (source_id IS NULL AND REPLACE(created_at,' ','T')>?)
                ORDER BY at LIMIT 1""",(ticked_at[:16],ticked_at)).fetchone()
            if hit:
                conn.execute('UPDATE routine_progress SET checked=?,ticked_at=NULL WHERE period=?',('[]',period))
                conn.execute("DELETE FROM journal_settings WHERE key='pending_checklist'")
                conn.commit()
                checked=[]
                reset=dict(symbol=hit['symbol'],at=hit['at'])
    valid={step['id'] for step in settings['steps']}
    # "<stepId>::c3" / "<stepId>::e1" = one item of the trade plan inside a routine step
    plan_checked=[key for key in checked if '::' in key and key.split('::')[0] in valid]
    return dict(settings=settings,revision=row['revision'] if row else 0,period=period,planChecked=plan_checked,reset=reset,
                checked=[key for key in checked if key in valid],nextReset=(boundary+timedelta(days=1)).isoformat())


def save_routine(body):
    if not isinstance(body,dict):
        raise ValueError('Routine settings are required')
    clean=validate_routine(body.get('settings'))
    revision=body.get('revision')
    if type(revision) is not int or revision<0:
        raise ValueError('A valid settings revision is required')
    with db() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row=conn.execute("SELECT revision FROM journal_settings WHERE key='routine'").fetchone()
        current=row['revision'] if row else 0
        if revision!=current:
            raise SettingsConflict('Routine changed in another tab. Reload saved settings before saving again.')
        conn.execute("INSERT INTO journal_settings(key,value,revision) VALUES('routine',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=excluded.revision",(json.dumps(clean),current+1))
    return routine_state()


def routine_active_plan(conn):
    """The plan shown in the routine: the Active plan, else the first available one, else the default template."""
    rows = conn.execute("SELECT id,title,body FROM workspace_items WHERE kind='strategy' ORDER BY updated_at DESC,id DESC").fetchall()
    plans = [(r['id'], r['title'], json.loads(r['body'])) for r in rows]
    for pid, title, body in plans:
        if body.get('primary') and body.get('active', True):
            return pid, title, body
    for pid, title, body in plans:
        if body.get('active', True):
            return pid, title, body
    row = conn.execute("SELECT value FROM journal_settings WHERE key='trade_plan'").fetchone()
    settings = json.loads(row['value']) if row else DEFAULT_PLAN_SETTINGS
    tpl = settings['templates'].get(settings.get('defaultType'), {})
    return None, tpl.get('name', 'Default checklist'), tpl


def update_pending_checklist(conn, plan_keys):
    """Remember the ticked plan items (with the time) so the next trade can carry them."""
    if not plan_keys:
        conn.execute("DELETE FROM journal_settings WHERE key='pending_checklist'")
        return
    pid, name, body = routine_active_plan(conn)
    def pick(prefix, items):
        idx = sorted({int(k.split('::' + prefix)[1]) for k in plan_keys if '::' + prefix in k})
        return [items[i] for i in idx if i < len(items)]
    exit_rules = [line.strip() for line in str(body.get('exitRules') or '').splitlines() if line.strip()]
    pending = dict(at=time.strftime('%Y-%m-%dT%H:%M'), planId=pid, planName=name, keys=sorted(plan_keys),
                   charting=pick('c', body.get('charting', [])), criteria=pick('e', body.get('criteria', [])),
                   exit=pick('x', exit_rules), management=pick('m', body.get('management', [])),
                   template={k: body.get(k) for k in ('charting', 'criteria', 'management', 'exitRules', 'notes')} | {'name': name})
    conn.execute("INSERT INTO journal_settings(key,value,revision) VALUES('pending_checklist',?,1) "
                 "ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=revision+1", (json.dumps(pending),))


def apply_pending_checklist(conn, trade):
    """Attach the pending pre-trade checklist to a new trade opened after it was ticked, then clear it."""
    row = conn.execute("SELECT value FROM journal_settings WHERE key='pending_checklist'").fetchone()
    if not row:
        return False
    pending = json.loads(row['value'])
    opened = trade.get('entry_time') or (str(trade.get('date') or '') + 'T23:59')
    if opened < pending['at'][:10] + 'T00:00' or (trade.get('entry_time') and trade['entry_time'] < pending['at']):
        return False
    if not trade.get('checklist'):
        trade['checklist'] = json.dumps(pending['criteria'])
    if not trade.get('strategy_id') and pending.get('planId'):
        trade['strategy_id'] = pending['planId']
    plan = {}
    try:
        plan = json.loads(trade.get('plan') or '{}') or {}
    except ValueError:
        pass
    plan.setdefault('version', 2)
    plan.setdefault('template', pending['template'])
    plan['pretrade'] = dict(at=pending['at'], charting=pending['charting'], criteria=pending['criteria'],
                            exit=pending.get('exit', []), management=pending.get('management', []),
                            criteriaTotal=len(pending['template'].get('criteria') or []))
    trade['plan'] = json.dumps(plan)
    # consumed: clear the pending checklist and the ticked plan items for the next trade
    conn.execute("DELETE FROM journal_settings WHERE key='pending_checklist'")
    for r in conn.execute('SELECT period,checked FROM routine_progress').fetchall():
        keep = [k for k in json.loads(r['checked']) if k not in pending['keys']]
        step_ids = {k.split('::')[0] for k in pending['keys']}
        keep = [k for k in keep if k not in step_ids]
        conn.execute('UPDATE routine_progress SET checked=? WHERE period=?', (json.dumps(keep), r['period']))
    return True


def save_routine_progress(body):
    if not isinstance(body,dict) or not isinstance(body.get('checked'),bool):
        raise ValueError('A step and completion state are required')
    state=routine_state()
    if body.get('period')!=state['period']:
        raise SettingsConflict('The daily routine has reset. Review the fresh checklist.')
    key=body.get('id')
    steps={step['id'] for step in state['settings']['steps']}
    import re as _re
    sub=_re.fullmatch(r'(.+)::[cexm]\d{1,2}',key) if isinstance(key,str) else None
    if key not in steps and not (sub and sub.group(1) in steps):
        raise ValueError('This routine step no longer exists')
    with db() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row=conn.execute('SELECT checked FROM routine_progress WHERE period=?',(state['period'],)).fetchone()
        checked=set(json.loads(row['checked'])) if row else set()
        if body['checked']:
            checked.add(key)
        else:
            checked.discard(key)
        conn.execute('INSERT INTO routine_progress(period,checked) VALUES(?,?) ON CONFLICT(period) DO UPDATE SET checked=excluded.checked',(state['period'],json.dumps(sorted(checked))))
        if body['checked']:
            conn.execute('UPDATE routine_progress SET ticked_at=? WHERE period=?',(time.strftime('%Y-%m-%dT%H:%M:%S'),state['period']))
        if '::' in key:
            update_pending_checklist(conn, [k for k in checked if '::' in k])
    return routine_state()


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
    data = dict(data)
    with db() as conn:
        apply_pending_checklist(conn, data)
        conn.commit()
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
        rows = conn.execute("SELECT pnl, r_multiple, outcome, fee FROM trades").fetchall()
    n = len(rows)
    pnls = [r["pnl"] - (r["fee"] or 0) for r in rows if r["pnl"] is not None]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    gross_win = sum(wins)
    gross_loss = abs(sum(losses))
    rs = [r["r_multiple"] for r in rows if r["r_multiple"] is not None]
    decided = [r["outcome"] for r in rows if r["outcome"] in ("Win", "Loss")]
    win_ct = len(wins)
    return {
        "total": n,
        "net_pnl": round(sum(pnls), 2) if pnls else 0,
        "win_rate": round(100 * win_ct / len(pnls), 1) if pnls else 0,
        "wins": win_ct,
        "losses": len(losses),
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
    net_values = [r["pnl"] - (r["fee"] or 0) for r in rows if r["pnl"] is not None]
    wins = [p for p in net_values if p > 0]
    losses = [p for p in net_values if p < 0]
    gw, gl = sum(wins), abs(sum(losses))
    n = len(rows)
    w, l = len(wins), len(losses)
    decided = w + l
    gross = sum(pnls) if pnls else 0
    fees = sum((r["fee"] or 0) for r in rows if r["pnl"] is not None)
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
        "winrate": round(100 * w / len(net_values), 1) if net_values else 0,
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


def _fill_local(created_at):
    """Delta created_at (ISO string or epoch s/ms/us) -> local datetime."""
    from datetime import datetime, timezone
    s = str(created_at)
    if s.isdigit():
        n = int(s)
        if n > 1e14:
            n /= 1_000_000
        elif n > 1e11:
            n /= 1000
        return datetime.fromtimestamp(n).astimezone()
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).astimezone()
    except ValueError:
        return None


def delta_all_fills(max_pages=6):
    """All fills Delta returns, newest first, following the 'after' cursor."""
    fills, after = [], None
    for _ in range(max_pages):
        query = "?page_size=500" + (f"&after={urllib.parse.quote(after)}" if after else "")
        data = delta_signed_get("/v2/fills", query)
        fills += data.get("result", []) or []
        after = (data.get("meta") or {}).get("after")
        if not after:
            break
    return fills


def delta_round_trips(fills, stop_orders):
    """Rebuild closed round-trips (flat -> flat) per symbol from fills, across days.

    Entry/exit are VWAPs, P&L is Delta's realized_pnl summed over closing fills,
    fee is the commission on every fill. A still-open position is not returned.
    Each trade's source_id is the id of its first fill, so re-syncing is idempotent.
    """
    by_sym = {}
    for f in fills:
        by_sym.setdefault(f.get("product_symbol") or f.get("symbol") or "?", []).append(f)
    trades = []
    for sym, fs in by_sym.items():
        fs.sort(key=lambda f: (_fill_local(f.get("created_at", "")) or 0, str(f.get("id", ""))))
        cv = _contract_value(sym)
        pos, cur = 0.0, None
        for f in fs:
            side = (f.get("side") or "").lower()
            sz = abs(float(f.get("size") or 0))
            px = float(f.get("price") or 0)
            if not sz or side not in ("buy", "sell"):
                continue
            when = _fill_local(f.get("created_at", ""))
            comm = abs(float(f.get("commission") or 0))
            rp = ((f.get("meta_data") or {}).get("new_position") or {}).get("realized_pnl")
            if pos == 0:
                cur = dict(side=side, op_sz=sz, op_not=sz * px, cl_sz=0.0, cl_not=0.0, realized=0.0,
                           has_rp=False, fee=comm, t_open=when, t_close=None, first_id=str(f.get("id") or f.get("created_at")))
                pos = sz if side == "buy" else -sz
                continue
            if (pos > 0) == (side == "buy"):          # adding to the position
                cur["op_sz"] += sz; cur["op_not"] += sz * px; cur["fee"] += comm
                pos += sz if side == "buy" else -sz
                continue
            close = min(sz, abs(pos))                 # reducing (a flip closes first)
            cur["cl_sz"] += close; cur["cl_not"] += close * px; cur["fee"] += comm
            if rp is not None:
                cur["realized"] += float(rp); cur["has_rp"] = True
            pos += close if pos < 0 else -close
            if abs(pos) < 1e-9:
                pos = 0.0
                cur["t_close"] = when
                trades.append((sym, cv, cur))
                cur = None
                rest = sz - close
                if rest > 1e-9:                       # flip: remainder opens a new trade
                    cur = dict(side=side, op_sz=rest, op_not=rest * px, cl_sz=0.0, cl_not=0.0, realized=0.0,
                               has_rp=False, fee=0.0, t_open=when, t_close=None, first_id=str(f.get("id") or "") + ":flip")
                    pos = rest if side == "buy" else -rest
    out = []
    for sym, cv, c in trades:
        direction = "Long" if c["side"] == "buy" else "Short"
        entry = round(c["op_not"] / c["op_sz"], 4)
        exit_ = round(c["cl_not"] / c["cl_sz"], 4) if c["cl_sz"] else None
        sign = 1 if direction == "Long" else -1
        pnl = round(c["realized"], 4) if c["has_rp"] else round((exit_ - entry) * sign * c["op_sz"] * cv, 4)
        stop = None
        t_open, t_close = c["t_open"], c["t_close"]
        for (ts, s_, sp) in stop_orders:
            if s_ == sym and t_open and t_close and t_open <= ts <= t_close and ((direction == "Long" and sp < entry) or (direction == "Short" and sp > entry)):
                stop = sp
                break
        risk = round(abs(entry - stop) * c["op_sz"] * cv, 2) if stop else None
        out.append({
            "date": t_open.strftime("%Y-%m-%d") if t_open else time.strftime("%Y-%m-%d"),
            "symbol": sym, "direction": direction, "entry": entry, "exit": exit_, "stop": stop,
            "qty": c["op_sz"], "risk": risk, "pnl": pnl, "fee": round(c["fee"], 4),
            "r_multiple": round(pnl / risk, 2) if risk else None,
            "outcome": "Win" if pnl > 0 else "Loss" if pnl < 0 else "BE",
            "entry_time": t_open.strftime("%Y-%m-%dT%H:%M") if t_open else None,
            "exit_time": t_close.strftime("%Y-%m-%dT%H:%M") if t_close else None,
            "contract_value": cv, "tags": "delta", "notes": "Imported from Delta Exchange.",
            "source_id": f"delta:{sym}:{c['first_id']}",
        })
    return out


def delta_sync():
    """Import every closed Delta round-trip into the journal; skip ones already there."""
    fills = delta_all_fills()
    stop_orders = []
    try:
        od = delta_signed_get("/v2/orders/history", "?page_size=500")
        for o in (od.get("result", []) or []):
            if o.get("stop_order_type") == "stop_loss_order" and o.get("product_symbol") and o.get("stop_price"):
                ts = _fill_local(o.get("created_at", ""))
                if ts:
                    stop_orders.append((ts, o["product_symbol"], float(o["stop_price"])))
        stop_orders.sort(key=lambda x: x[0])
    except Exception:
        pass
    trades = delta_round_trips(fills, stop_orders)
    added, dates = 0, []
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    trades.sort(key=lambda t: t.get("entry_time") or "")
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        for t in trades:
            if conn.execute("SELECT 1 FROM trades WHERE source_id=?", (t["source_id"],)).fetchone():
                continue
            apply_pending_checklist(conn, t)
            cols = list(t) + ["created_at"]
            conn.execute(f"INSERT INTO trades ({','.join(cols)}) VALUES ({','.join('?' for _ in cols)})",
                         [t[c] for c in t] + [now])
            added += 1
            dates.append(t["date"])
        conn.commit()
    return {"fills": len(fills), "closed": len(trades), "imported": added,
            "skipped": len(trades) - added, "latest": max(dates) if dates else None}


_FX_CACHE = {}


def fx_rate(base, to):
    """Live exchange rate base -> to. USDT is treated as USD. Cached for 1 hour."""
    base = "USD" if base == "USDT" else base
    to = "USD" if to == "USDT" else to
    if base == to:
        return {"base": base, "to": to, "rate": 1.0, "source": "same currency", "ts": int(time.time())}
    key = (base, to)
    hit = _FX_CACHE.get(key)
    if hit and time.time() - hit["ts"] < 3600:
        return hit
    sources = [
        (f"https://open.er-api.com/v6/latest/{urllib.parse.quote(base)}", lambda d: d["rates"][to], "open.er-api.com"),
        (f"https://api.frankfurter.app/latest?from={urllib.parse.quote(base)}&to={urllib.parse.quote(to)}", lambda d: d["rates"][to], "frankfurter.app"),
    ]
    last = None
    for url, pick, name in sources:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "trade-journal"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                rate = float(pick(json.loads(resp.read().decode())))
            if rate > 0:
                _FX_CACHE[key] = {"base": base, "to": to, "rate": rate, "source": name, "ts": int(time.time())}
                return _FX_CACHE[key]
        except Exception as e:
            last = e
    raise RuntimeError(f"Exchange rate unavailable: {last}")


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

    def _workspace_request(self, method):
        parsed=urllib.parse.urlparse(self.path)
        if not parsed.path.startswith('/api/workspace/'):
            return False
        if not self._authed():
            self._send_json({'error':'unauthorized'},401)
            return True
        try:
            if parsed.path=='/api/workspace/backup' and method=='GET':
                body=workspace.backup(db,IMAGES_DIR)
                self.send_response(200)
                self.send_header('Content-Type','application/zip')
                self.send_header('Content-Disposition','attachment; filename="trade-journal-backup.zip"')
                self.send_header('Content-Length',str(len(body)))
                self.end_headers();self.wfile.write(body)
            else:
                data=self._read_body() if method in ('POST','PUT','DELETE') else None
                result,status=workspace.handle(db,method,parsed.path,urllib.parse.parse_qs(parsed.query),data)
                self._send_json(result,status)
        except workspace.Conflict as error:
            self._send_json({'error':str(error)},409)
        except (ValueError,TypeError) as error:
            self._send_json({'error':str(error)},400)
        return True

    def do_GET(self):
        if self._workspace_request('GET'):return
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = urllib.parse.parse_qs(parsed.query)

        if path in ('/workspace.js','/workspace.css','/theme.css','/theme-mercury.css','/calendar.js','/trade.js','/playbook.js','/profile.js','/meditation.js'):
            filename=os.path.join(HERE,path[1:])
            try:
                with open(filename,'rb') as handle:body=handle.read()
            except FileNotFoundError:
                self._send_json({'error':'Asset not found'},404);return
            self.send_response(200)
            self.send_header('Content-Type','text/javascript; charset=utf-8' if path.endswith('.js') else 'text/css; charset=utf-8')
            self.send_header('Cache-Control','no-cache')
            self.send_header('Content-Length',str(len(body)))
            self.end_headers();self.wfile.write(body);return

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

        if path == "/api/routine":
            self._send_json(routine_state())
            return

        if path == "/api/plan-settings":
            self._send_json(get_plan_settings())
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

        if path == "/api/fx":
            try:
                self._send_json(fx_rate(params.get("base", ["USD"])[0].upper()[:5], params.get("to", ["USD"])[0].upper()[:5]))
            except RuntimeError as e:
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
        if self._workspace_request('POST'):return
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
        if self.path == "/api/delta/sync":
            try:
                self._send_json(delta_sync())
            except RuntimeError as e:
                self._send_json({"error": str(e)}, 400 if str(e) == "no-credentials" else 502)
            except urllib.error.HTTPError as e:
                self._send_json({"error": f"Delta returned {e.code}"}, 502)
            except Exception as e:
                self._send_json({"error": f"Could not reach Delta: {e}"}, 502)
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
        if self._workspace_request('PUT'):return
        if not self._authed():
            self._send_json({"error": "unauthorized"}, 401)
            return
        if self.path in ('/api/routine', '/api/routine/progress'):
            try:
                action=save_routine if self.path=='/api/routine' else save_routine_progress
                self._send_json(action(self._read_body()))
            except SettingsConflict as error:
                self._send_json({'error':str(error)},409)
            except ValueError as error:
                self._send_json({'error':str(error)},400)
            return
        if self.path == "/api/plan-settings":
            try:
                self._send_json(save_plan_settings(self._read_body()))
            except SettingsConflict as error:
                self._send_json({"error": str(error)}, 409)
            except ValueError as error:
                self._send_json({"error": str(error)}, 400)
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
        if self._workspace_request('DELETE'):return
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
    init_plan_settings()
    init_routine()
    workspace.init(db)
    load_sessions()
    creds = "✓ connected" if all(delta_creds()) else "✗ no API keys (price-only)"
    server = ThreadingHTTPServer((os.environ.get("TRADE_HOST", "0.0.0.0"), PORT), Handler)
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
    if os.environ.get("TRADE_HOST", "0.0.0.0") == "0.0.0.0":
        print(f"      phone/tablet (same wifi) : http://{lan}:{PORT}")
    print(f"      data: {DB_PATH}")
    print(f"      Delta account: {creds}")
    print("      Sign in with the credentials configured in your local .env file.")
    print("      press Ctrl+C to stop\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped.")
        server.shutdown()


if __name__ == "__main__":
    main()
