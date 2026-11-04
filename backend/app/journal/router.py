"""
The local journal's HTTP API, served per signed-in user under /j/api/*.
Paths, methods, payloads and status codes mirror the local app's handler
(Trade/app.py) so its frontend runs unchanged; the browser shim only adds the
base URL and the Supabase token.
"""
from __future__ import annotations

import contextlib
import json
import time
import urllib.error

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response

from ..auth import get_current_user, _decode_token
from ..billing import active_tier
from ..config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
from ..database import get_conn
from ..ratelimit import limit
from ..secretbox import encrypt
from . import core, workspace
from .pgcompat import current_schema, current_user_id, db, ensure_schema, schema_for, install_trade_guards

router = APIRouter(prefix="/j", tags=["journal"])
FREE_DAILY_LIMIT = 2


def _init_tables():
    core.init_db()
    core.init_day_logs()
    core.init_plan_settings()
    core.init_routine()
    workspace.init(db)
    install_trade_guards(schema_for(current_user_id.get()))


@contextlib.contextmanager
def scoped(user):
    """Point db() at this user's schema (creating it on first use)."""
    schema = schema_for(user["user_id"])
    t1, t2 = current_user_id.set(user["user_id"]), current_schema.set(None)
    try:
        ensure_schema(schema, _init_tables)
        current_schema.set(schema)
        yield
    finally:
        current_schema.reset(t2)
        current_user_id.reset(t1)


def ok(obj, status=200):
    return JSONResponse(json.loads(json.dumps(obj, default=str)), status_code=status)


def err(msg, status):
    return JSONResponse({"error": msg}, status_code=status)


async def body(request: Request) -> dict:
    try:
        data = await request.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def qs(request: Request) -> dict:
    out: dict = {}
    for k, v in request.query_params.multi_items():
        out.setdefault(k, []).append(v)
    return out


# ── session ──────────────────────────────────────────────
@router.get("/api/session")
def session(user=Depends(get_current_user)):
    return {"authed": True, "email": user["email"]}


# ── routine & plan settings ──────────────────────────────
@router.get("/api/routine")
def get_routine(user=Depends(get_current_user)):
    with scoped(user):
        return ok(core.routine_state())


@router.put("/api/routine")
@router.put("/api/routine/progress")
async def put_routine(request: Request, user=Depends(get_current_user)):
    data = await body(request)
    action = core.save_routine if request.url.path.endswith("/routine") else core.save_routine_progress
    with scoped(user):
        try:
            return ok(action(data))
        except core.SettingsConflict as e:
            return err(str(e), 409)
        except ValueError as e:
            return err(str(e), 400)


@router.get("/api/plan-settings")
def get_plan(user=Depends(get_current_user)):
    with scoped(user):
        return ok(core.get_plan_settings())


@router.put("/api/plan-settings")
async def put_plan(request: Request, user=Depends(get_current_user)):
    data = await body(request)
    with scoped(user):
        try:
            return ok(core.save_plan_settings(data))
        except core.SettingsConflict as e:
            return err(str(e), 409)
        except ValueError as e:
            return err(str(e), 400)


# ── trades ───────────────────────────────────────────────
@router.get("/api/trades")
def get_trades(request: Request, user=Depends(get_current_user)):
    with scoped(user):
        return ok(core.list_trades(qs(request)))


@router.post("/api/trades")
async def post_trade(request: Request, user=Depends(get_current_user)):
    data = await body(request)
    day = data.get("date") or time.strftime("%Y-%m-%d")
    with scoped(user):
        try:
            return ok(core.create_trade(data), 201)
        except ValueError as e:
            return err(str(e), 400)


@router.put("/api/trades/{trade_id}")
async def put_trade(trade_id: int, request: Request, user=Depends(get_current_user)):
    data = await body(request)
    with scoped(user):
        try:
            res = core.update_trade(trade_id, data)
        except ValueError as e:
            return err(str(e), 400)
        return ok(res) if res else err("not found", 404)


@router.delete("/api/trades/{trade_id}")
def del_trade(trade_id: int, user=Depends(get_current_user)):
    with scoped(user):
        core.delete_trade(trade_id)
        return ok({"ok": True})


@router.get("/api/stats")
def get_stats(user=Depends(get_current_user)):
    with scoped(user):
        return ok(core.stats())


# ── day logs ─────────────────────────────────────────────
@router.get("/api/daylogs")
def get_daylogs(user=Depends(get_current_user)):
    with scoped(user):
        return ok(core.list_daylogs())


@router.get("/api/daylog")
def get_daylog(date: str = "", user=Depends(get_current_user)):
    with scoped(user):
        return ok(core.get_daylog(date))


@router.put("/api/daylog")
async def put_daylog(request: Request, user=Depends(get_current_user)):
    data = await body(request)
    if not data.get("date"):
        return err("date required", 400)
    with scoped(user):
        return ok(core.upsert_daylog(data["date"], data))


# ── market data & exchange ───────────────────────────────
@router.get("/api/price")
def get_price(symbol: str = "BTCUSD", user=Depends(limit("price", 30))):
    try:
        return ok(core.delta_price(symbol))
    except Exception as e:
        return err(str(e), 502)


@router.get("/api/fx")
def get_fx(base: str = "USD", to: str = "USD", user=Depends(get_current_user)):
    try:
        return ok(core.fx_rate(base.upper()[:5], to.upper()[:5]))
    except RuntimeError as e:
        return err(str(e), 502)


@router.get("/api/exchange")
def get_exchange(user=Depends(get_current_user)):
    with scoped(user):
        key, secret = core.delta_creds()
    return ok({"exchange": "delta", "has_creds": bool(key and secret),
               "key_masked": ("••••" + key[-4:]) if len(key) >= 4 else ""})


@router.post("/api/exchange")
async def post_exchange(request: Request, user=Depends(limit("exchange-save", 10))):
    data = await body(request)
    key, secret = (data.get("key") or "").strip(), (data.get("secret") or "").strip()
    entry = {"key": encrypt(key), "secret": encrypt(secret), "passphrase": ""}
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE user_profiles SET delta_key=%s, delta_secret=%s, "
                "exchange_creds = jsonb_set(COALESCE(exchange_creds,'{}'::jsonb), '{delta}', %s::jsonb, true) WHERE id=%s",
                (entry["key"], entry["secret"], json.dumps(entry), user["user_id"]),
            )
    return ok({"ok": True})


def _delta_error(e):
    if isinstance(e, RuntimeError) and str(e) == "no-credentials":
        return err("no-credentials", 400)
    if isinstance(e, urllib.error.HTTPError):
        msg = f"Delta API {e.code}"
        try:
            b = json.loads(e.read().decode())
            er = b.get("error") or {}
            if er.get("code") == "ip_not_whitelisted_for_api_key":
                ip = (er.get("context") or {}).get("client_ip", "")
                msg = f"This IP is not whitelisted on your Delta API key. Add {ip} to the key's allowed IPs on Delta, then try again."
            elif er.get("code"):
                msg = f"Delta: {er['code']}"
        except Exception:
            pass
        return err(msg, 502)
    return err(str(e), 502)


@router.get("/api/delta/today")
def delta_today(user=Depends(limit("delta", 6))):
    with scoped(user):
        try:
            return ok({"trades": core.delta_today_trades()})
        except Exception as e:
            return _delta_error(e)


@router.post("/api/delta/sync")
def delta_sync(user=Depends(limit("delta", 6))):
    with scoped(user):
        try:
            return ok(core.delta_sync())
        except Exception as e:
            return _delta_error(e)


# ── chart images ─────────────────────────────────────────
@router.post("/api/upload")
async def upload(request: Request, user=Depends(limit("upload", 20))):
    data = await body(request)
    with scoped(user):
        try:
            return ok({"path": core.save_image(data.get("data", ""))})
        except Exception as e:
            return err(str(e), 400)


@router.get("/images/{name}")
def image(name: str, request: Request, t: str = ""):
    """The journal UI renders <img src="/images/<name>">, which can't send headers.
    Vercel proxies /images/* here, and the web shim keeps a short-lived td_img
    cookie (path /images) holding the user's access token. Redirects to a
    short-lived signed URL for the caller's own file."""
    token = t or request.cookies.get("td_img", "")
    try:
        uid = _decode_token(token).get("sub")
    except Exception:
        uid = None
    if not uid or "/" in name or ".." in name:
        return err("unauthorized", 401)
    r = httpx.post(f"{SUPABASE_URL}/storage/v1/object/sign/{core.IMAGE_BUCKET}/{uid}/{name}",
                   json={"expiresIn": 3600}, headers={"Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"}, timeout=20)
    if r.status_code != 200:
        return err("not found", 404)
    return RedirectResponse(SUPABASE_URL + "/storage/v1" + r.json()["signedURL"], status_code=302,
                            headers={"Cache-Control": "private, max-age=3000"})


# ── workspace (notes, plans, events, settings, import, backup) ──
@router.api_route("/api/workspace/{rest:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def workspace_api(rest: str, request: Request, user=Depends(get_current_user)):
    path = "/api/workspace/" + rest
    data = await body(request) if request.method in ("POST", "PUT", "DELETE") else None
    with scoped(user):
        try:
            if path == "/api/workspace/backup" and request.method == "GET":
                return Response(workspace.backup(db), media_type="application/zip",
                                headers={"Content-Disposition": 'attachment; filename="tradedesk-backup.zip"'})
            result, status = workspace.handle(db, request.method, path, qs(request), data)
            return ok(result, status)
        except workspace.Conflict as e:
            return err(str(e), 409)
        except (ValueError, TypeError) as e:
            return err(str(e), 400)


# ── free tier ────────────────────────────────────────────
def _over_free_limit(uid: str, day: str) -> bool:
    with get_conn(readonly=True) as conn:
        if active_tier(conn, uid) == "pro":
            return False
    with db() as conn:
        n = conn.execute("SELECT COUNT(*) AS n FROM trades WHERE date=?", (day,)).fetchone()["n"]
    return n >= FREE_DAILY_LIMIT
