"""
Trade journal logic, ported unchanged in spirit from the local desktop app
(Trade/app.py). The web UI is the local app's own frontend; this module serves
its API for each signed-in user. Differences from the local app:
  - db() is a per-user Postgres schema via pgcompat (same SQL as before)
  - chart images live in private Supabase Storage under the user's folder
  - exchange keys come from the user's encrypted profile, not exchange.json/.env
  - login, sessions and the HTTP server are handled by FastAPI + Supabase Auth
"""
from __future__ import annotations

import json
import re
import os
import urllib.request
import urllib.parse
import urllib.error
import time
import hmac
import hashlib
import base64
import secrets

import httpx

from . import workspace
from .pgcompat import db, current_user_id
from ..config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
from ..database import get_conn
from ..secretbox import decrypt

IMAGE_BUCKET = "trade-images"


def load_exchange():
    """The signed-in user's Delta credentials (decrypted), shaped like the old exchange.json."""
    with get_conn(readonly=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT delta_key, delta_secret FROM user_profiles WHERE id=%s", (current_user_id.get(),))
            row = cur.fetchone()
    if not row:
        return {"exchange": "delta", "key": "", "secret": ""}
    return {"exchange": "delta", "key": decrypt(row["delta_key"]), "secret": decrypt(row["delta_secret"])}



DELTA_BASE = "https://api.india.delta.exchange"


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


# Match the desktop journal's configured popup, including its meditation template.
# Saved per-user routines still take precedence over these first-run defaults.
DEFAULT_ROUTINE = dict(enabled=True, showAll=True, autoHide=True, popup=True, resetTime='00:00', steps=[
    dict(id='plan', title='Review your trade plan', action='preferences', icon='target', meditation=''),
    dict(id='meditate', title='Meditate (15 mins)', action='focus', icon='calm', meditation='visualize-plan')])


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
        now=datetime.now(journal_zone())
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
    result={k:row[k] for k in row.keys()}
    if 'pnl' in result and result['pnl'] is not None:
        net=result['pnl']-(result.get('fee') or 0)
        result['outcome']='Win' if net>0 else 'Loss' if net<0 else 'BE'
    return result


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
        q += " AND (CASE WHEN pnl IS NULL THEN outcome WHEN pnl-COALESCE(fee,0)>0 THEN 'Win' WHEN pnl-COALESCE(fee,0)<0 THEN 'Loss' ELSE 'BE' END) = ?"
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
    if params.get("limit"):
        limit = int(params["limit"][0])
        before = int(params.get("before_id", [0])[0])
        if not 1 <= limit <= 500 or before < 0: raise ValueError("Invalid trade page")
        if before:
            q += " AND id < ?"
            args.append(before)
        q += " ORDER BY id DESC LIMIT ?"
        args.append(limit)
    else:
        q += " ORDER BY date DESC, id DESC"
    with db() as conn:
        rows = conn.execute(q, args).fetchall()
    return [row_to_dict(r) for r in rows]


def validate_trade(data):
    """Validate shared journal payloads before any journal write occurs."""
    import math
    from datetime import date
    if not isinstance(data, dict):
        raise ValueError("Trade must be an object")
    clean = {key: data.get(key) for key in FIELDS}
    try:
        day = clean.get("date")
        if not isinstance(day, str) or len(day) != 10:
            raise ValueError()
        date.fromisoformat(day)
    except (TypeError, ValueError):
        raise ValueError("Use a valid YYYY-MM-DD trade date")
    if clean.get("direction") not in ("Long", "Short"):
        raise ValueError("Choose Long or Short")
    if not isinstance(clean.get("symbol"), str) or not clean["symbol"].strip() or len(clean["symbol"]) > 100:
        raise ValueError("Add a valid symbol (up to 100 characters)")
    numeric = {"entry", "stop", "exit", "qty", "risk", "pnl", "r_multiple", "fee", "contract_value", "rating", "strategy_id", "target", "swap"}
    signed = {"pnl", "r_multiple", "swap"}
    for key, value in clean.items():
        if value is None or value == "":
            if key in numeric: clean[key] = None
            continue
        if key in numeric:
            try:
                if isinstance(value, bool): raise ValueError()
                number = float(value)
                if not math.isfinite(number) or abs(number) > 1e12 or (key not in signed and number < 0): raise ValueError()
                if key == "contract_value" and number <= 0: raise ValueError()
                if key == "rating" and (number != int(number) or not 0 <= number <= 5): raise ValueError()
            except (TypeError, ValueError):
                raise ValueError("Invalid " + key)
            clean[key] = number
        elif not isinstance(value, str) or len(value) > (200_000 if key == "images" else 100_000 if key in ("plan","review","checklist") else 20_000):
            raise ValueError("Invalid " + key)
    if clean.get("outcome") not in (None, "", "Win", "Loss", "BE", "Open"):
        raise ValueError("Invalid outcome")
    return clean


def create_trade(data):
    client_id=data.get('clientId') if isinstance(data,dict) else None
    clean=normalize_trade_times(validate_trade(data),data.get('timezone'))
    fields=list(FIELDS)
    source_id=data.get('sourceId')
    if source_id:
        if not isinstance(source_id,str) or not re.fullmatch(r'delta:[A-Za-z0-9_.-]{1,100}:[A-Za-z0-9_.:-]{1,100}',source_id):
            raise ValueError('Invalid broker trade reference')
        clean['source_id']=source_id;fields.append('source_id')
    return workspace.create_trade_record(db,fields,clean,client_id,apply_pending_checklist)


def update_trade(trade_id, data):
    expected=data.get('expectedRevision') if isinstance(data,dict) else None
    clean=normalize_trade_times(validate_trade(data),data.get('timezone'))
    return workspace.update_trade_record(db,FIELDS,trade_id,clean,expected)


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


MAX_IMAGE_BYTES = 5 * 1024 * 1024
IMAGE_TYPES = {"png": "png", "jpeg": "jpg", "jpg": "jpg", "gif": "gif", "webp": "webp"}


def save_image(data_url):
    """Store a 'data:image/...;base64,XXX' chart in the user's private storage folder.
    Returns the same 'images/<name>' path the local app used; the API serves it."""
    header, sep, b64 = (data_url or "").partition(",")
    if not sep or not header.startswith("data:image/"):
        raise ValueError("Expected a base64 image")
    ext = IMAGE_TYPES.get(header[len("data:image/"):].split(";")[0].lower())
    if not ext:
        raise ValueError("Use a PNG, JPG, GIF or WebP image")
    if len(b64) > MAX_IMAGE_BYTES * 4 // 3 + 4:
        raise ValueError("Image too large (max 5 MB)")
    raw = base64.b64decode(b64, validate=True)
    name = f"{int(time.time())}_{secrets.token_hex(4)}.{ext}"
    resp = httpx.put(
        f"{SUPABASE_URL}/storage/v1/object/{IMAGE_BUCKET}/{current_user_id.get()}/{name}",
        content=raw,
        headers={"Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                 "Content-Type": "image/" + ("jpeg" if ext == "jpg" else ext)},
        timeout=30,
    )
    if resp.status_code not in (200, 201):
        raise ValueError("Image upload failed")
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
        aggregates = {row["date"]:dict(row) for row in conn.execute(
            "SELECT date, COUNT(*) AS total_trades, "
            "COALESCE(SUM(CASE WHEN pnl IS NOT NULL THEN pnl-COALESCE(fee,0) ELSE 0 END),0) AS net_pnl "
            "FROM trades WHERE date IS NOT NULL AND date<>'' GROUP BY date")}
        logged = {row[0] for row in conn.execute("SELECT date FROM day_logs")}
    return [{"date":day, "net_pnl":round(aggregates.get(day,{}).get("net_pnl",0),2),
             "total_trades":aggregates.get(day,{}).get("total_trades",0), "has_log":day in logged}
            for day in sorted(set(aggregates)|logged, reverse=True)]


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


def validate_daylog(day, data):
    from datetime import date
    try:
        if not isinstance(day,str) or len(day)!=10: raise ValueError()
        date.fromisoformat(day)
    except (TypeError,ValueError):
        raise ValueError("Use a valid YYYY-MM-DD journal date")
    if not isinstance(data,dict): raise ValueError("Journal entry must be an object")
    for key in DAY_FIELDS:
        value=data.get(key, "")
        if value is not None and (not isinstance(value,str) or len(value)>100000):
            raise ValueError("Invalid journal " + key)
    return data


def upsert_daylog(date, data):
    data = validate_daylog(date, data)
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
    return (ex.get("key") or "").strip(), (ex.get("secret") or "").strip()


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


def journal_zone(preferred=None):
    from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
    name=preferred or workspace.read_settings(db,'profile')['settings'].get('timezone') or 'UTC'
    try:
        if not isinstance(name,str) or len(name)>64:raise ValueError()
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError,ValueError):
        raise ValueError('Choose a valid time zone in Settings before importing trades.')


def normalize_trade_times(data,zone_name=None):
    from datetime import datetime,timezone,date
    if not data.get('entry_time') and not data.get('exit_time'):return data
    zone=journal_zone(zone_name)
    times={}
    for key in ('entry_time','exit_time'):
        value=data.get(key)
        if not value:continue
        try:
            if len(value)==10:
                date.fromisoformat(value)
                continue
            parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
            if parsed.tzinfo is None:
                aware=parsed.replace(tzinfo=zone)
                if aware.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None)!=parsed:
                    raise ValueError('This clock time does not exist because of daylight saving. Choose a valid time or leave it blank.')
                other=parsed.replace(tzinfo=zone,fold=1)
                if aware.utcoffset()!=other.utcoffset():
                    raise ValueError('This clock time occurs twice because of daylight saving. Use UTC in Settings, or leave the time blank.')
                parsed=aware
            times[key]=parsed.astimezone(timezone.utc)
            data[key]=times[key].isoformat()
        except (ValueError,TypeError) as error:
            if str(error).startswith('This clock time'):raise
            raise ValueError('Use a valid '+key.replace('_',' ')) from error
    if len(times)==2 and times['exit_time']<times['entry_time']:
        raise ValueError('Exit time cannot be earlier than entry time.')
    return data


def _fill_day(created_at,zone=None):
    from datetime import timezone
    parsed=_fill_local(created_at)
    return parsed.astimezone(zone or timezone.utc).strftime('%Y-%m-%d') if parsed else ''


_CV_CACHE = {}


def _contract_value(symbol):
    if symbol in _CV_CACHE:return _CV_CACHE[symbol]
    try:
        url=f'{DELTA_BASE}/v2/products/{urllib.parse.quote(symbol)}'
        with urllib.request.urlopen(url,timeout=8) as response:payload=json.loads(response.read().decode())
        cv=float((payload.get('result') or {}).get('contract_value'))
        import math
        if not math.isfinite(cv) or cv<=0:raise ValueError()
    except Exception as error:
        raise RuntimeError('Could not verify the instrument contract size. Please retry the broker import.') from error
    _CV_CACHE[symbol]=cv
    return cv


def delta_today_trades(timezone_name=None):
    """Closed positions completed today, rebuilt across the full available history."""
    from datetime import datetime
    zone=journal_zone(timezone_name)
    today=datetime.now(zone).date()
    trades=delta_round_trips(delta_all_fills(),[],zone)
    return [t for t in trades if _fill_local(t['exit_time']).astimezone(zone).date()==today]


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
        return datetime.fromtimestamp(n,timezone.utc)
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)
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
    if after:raise RuntimeError('Broker history exceeds this sync window. Import older history using CSV; no partial sync was saved.')
    return fills


def delta_round_trips(fills, stop_orders, zone=None):
    """Rebuild closed round-trips (flat -> flat) per symbol from fills, across days.

    Entry/exit are VWAPs, P&L is Delta's realized_pnl summed over closing fills,
    fee is the commission on every fill. A still-open position is not returned.
    Each trade's source_id is the id of its first fill, so re-syncing is idempotent.
    """
    from datetime import timezone
    zone=zone or timezone.utc
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
            cur["cl_sz"] += close; cur["cl_not"] += close * px; cur["fee"] += comm*(close/sz)
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
                               has_rp=False, fee=comm*(rest/sz), t_open=when, t_close=None, first_id=str(f.get("id") or "") + ":flip")
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
            "date": t_open.astimezone(zone).strftime("%Y-%m-%d") if t_open else time.strftime("%Y-%m-%d"),
            "symbol": sym, "direction": direction, "entry": entry, "exit": exit_, "stop": stop,
            "qty": c["op_sz"], "risk": risk, "pnl": pnl, "fee": round(c["fee"], 4),
            "r_multiple": round(pnl / risk, 2) if risk else None,
            "outcome": "Win" if pnl > 0 else "Loss" if pnl < 0 else "BE",
            "entry_time": t_open.isoformat() if t_open else None,
            "exit_time": t_close.isoformat() if t_close else None,
            "contract_value": cv, "tags": "delta", "notes": "Imported from Delta Exchange.",
            "source_id": f"delta:{sym}:{c['first_id']}",
        })
    return out


def delta_sync(timezone_name=None):
    """Import every closed Delta round-trip into the journal; skip ones already there."""
    zone=journal_zone(timezone_name)
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
    trades = [{**validate_trade(t),'source_id':t['source_id']} for t in delta_round_trips(fills, stop_orders,zone)]
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
