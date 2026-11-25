import contextlib
import os
import psycopg2
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from .journal.pgcompat import MissingJournalSchema, AccountDeleting
from fastapi.middleware.cors import CORSMiddleware
from .config import FRONTEND_URL
from .observability import scrub_event,request_diagnostics
from .routers import trades, stats, daylogs, exchange, subscription, account, playbooks
from .journal.router import router as journal_router
from .client_errors import router as client_errors_router
from .events import router as events_router

if os.environ.get("SENTRY_DSN"):
    import sentry_sdk
    sentry_sdk.init(
        dsn=os.environ["SENTRY_DSN"],
        environment="production" if os.environ.get("RENDER") else "development",
        traces_sample_rate=0,
        max_request_body_size="never",
        include_local_variables=False,
        before_send=scrub_event,
        before_breadcrumb=lambda breadcrumb,hint:None,
        send_default_pii=False,
    )

# Interactive API docs only outside production (Render sets RENDER=true).
_docs = not os.environ.get("RENDER")
@contextlib.asynccontextmanager
async def lifespan(_app):
    # Fetch market news and the economic calendar once at boot and keep them fresh,
    # so the first person to open News is not waiting on the public feeds.
    if os.environ.get("NEWS_PRELOAD", "1") != "0":
        from .journal import news
        news.start_warmer()
    yield


app = FastAPI(
    title="TradeDesk API", lifespan=lifespan, version="1.0.0",
    docs_url="/docs" if _docs else None, redoc_url=None,
    openapi_url="/openapi.json" if _docs else None,
)


app.include_router(trades.router)
app.include_router(stats.router)
app.include_router(daylogs.router)
app.include_router(exchange.router)
app.include_router(subscription.router)
app.include_router(account.router)
app.include_router(playbooks.router)
app.include_router(journal_router)
app.include_router(client_errors_router)
app.include_router(events_router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "TradeDesk API"}


@app.exception_handler(AccountDeleting)
def account_deleting(request,exc):
    return JSONResponse(status_code=423,content={'detail':'Account deletion is pending. Retry deletion to finish.'})


@app.exception_handler(MissingJournalSchema)
def missing_journal_schema(request, exc):
    return JSONResponse(status_code=503, content={"detail": "Journal temporarily unavailable. Please try again."})


@app.exception_handler(psycopg2.errors.RaiseException)
def journal_rule_error(request, exc):
    if exc.diag.message_primary == "free-daily-limit":
        return JSONResponse(status_code=402, content={"error": "free-daily-limit", "detail": "Free accounts allow up to 2 trades per day. Upgrade to Pro for unlimited trades."})
    if exc.diag.message_primary == "account-unavailable":
        return JSONResponse(status_code=401, content={"detail": "Account is no longer available"})
    return JSONResponse(status_code=500, content={"detail": "Could not save journal changes"})


@app.get("/ready")
def ready():
    from .database import get_conn
    try:
        with get_conn(readonly=True) as conn:
            with conn.cursor() as cur:
                cur.execute("""SELECT to_regclass('public.user_profiles') IS NOT NULL
                    AND to_regclass('public.billing_orders') IS NOT NULL
                    AND to_regclass('public.billing_payments') IS NOT NULL
                    AND to_regclass('public.api_rate_buckets') IS NOT NULL
                    AND to_regclass('public.feedback_triage') IS NOT NULL
                    AND EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema='public' AND table_name='user_profiles'
                        AND column_name='deletion_started_at')
                    AND EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema='public' AND table_name='feedback_triage'
                        AND column_name='reply') AS ready""")
                row = cur.fetchone()
                if not row or not row["ready"]:
                    return JSONResponse(status_code=503, content={"status": "unavailable"})
        return {"status": "ready"}
    except Exception:
        return JSONResponse(status_code=503, content={"status": "unavailable"})


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    return response


@app.middleware("http")
async def parse_journal_body(request, call_next):
    if request.url.path.startswith("/j/api/") and request.method in ("POST","PUT","DELETE"):
        import json
        maximum = 72 * 1024 * 1024 if request.url.path.endswith("/workspace/restore") else 8 * 1024 * 1024
        chunks,total = [],0
        async for chunk in request.stream():
            total += len(chunk)
            if total > maximum:
                return JSONResponse(status_code=413,content={"detail":"Request is too large"})
            chunks.append(chunk)
        try:
            value = json.loads(b"".join(chunks) or b"{}")
            if not isinstance(value,dict): raise ValueError()
        except (ValueError,UnicodeError):
            return JSONResponse(status_code=400,content={"detail":"Send a valid JSON object"})
        request.state.journal_body = value
    return await call_next(request)

# Outermost middleware supplies a support reference even for parser failures.
app.middleware("http")(request_diagnostics)

# CORS wraps generated error responses as well as successful requests.
# Render sets RENDER=true; local development and tests do not.
PRODUCTION = bool(os.environ.get("RENDER"))
DEV_ORIGINS = [
    "http://localhost:5173",   # Vite dev
    "http://localhost:3000",   # alt dev
    "capacitor://localhost",   # Capacitor mobile
    "http://localhost",        # Expo mobile
]
# Only this Vercel project and team: the production alias plus its per-deploy
# (9-character hash) and per-branch preview URLs.
VERCEL_ORIGIN_REGEX = (
    r"https://trade-desk-dl66(?:\.vercel\.app"
    r"|-(?:[a-z0-9]{9}|git-[a-z0-9-]{1,63})-bhaskarjgoswami-5079s-projects\.vercel\.app)"
)
# FRONTEND_URL falls back to the Vite dev URL when unset; never let that open CORS in production.
CORS_ORIGINS = ([] if PRODUCTION and "localhost" in FRONTEND_URL else [FRONTEND_URL]) + ([] if PRODUCTION else DEV_ORIGINS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=VERCEL_ORIGIN_REGEX,
    allow_credentials=True,
    expose_headers=["X-Request-ID"],
    allow_methods=["*"],
    allow_headers=["*"],
)
