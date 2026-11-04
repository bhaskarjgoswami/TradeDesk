import os
import psycopg2
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from .journal.pgcompat import MissingJournalSchema
from fastapi.middleware.cors import CORSMiddleware
from .config import FRONTEND_URL
from .routers import trades, stats, daylogs, exchange, subscription, account, playbooks
from .journal.router import router as journal_router

if os.environ.get("SENTRY_DSN"):
    import sentry_sdk
    sentry_sdk.init(
        dsn=os.environ["SENTRY_DSN"],
        environment="production" if os.environ.get("RENDER") else "development",
        traces_sample_rate=0.1,
        send_default_pii=False,  # never ship emails, keys or request bodies
    )

# Interactive API docs only outside production (Render sets RENDER=true).
_docs = not os.environ.get("RENDER")
app = FastAPI(
    title="TradeDesk API", version="1.0.0",
    docs_url="/docs" if _docs else None, redoc_url=None,
    openapi_url="/openapi.json" if _docs else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_URL,
        "http://localhost:5173",   # Vite dev
        "http://localhost:3000",   # alt dev
        "capacitor://localhost",   # Capacitor mobile
        "http://localhost",        # Expo mobile
    ],
    # Allow this project's Vercel domains (stable production alias + per-deploy preview URLs)
    allow_origin_regex=r"https://trade-desk-dl66[a-z0-9-]*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trades.router)
app.include_router(stats.router)
app.include_router(daylogs.router)
app.include_router(exchange.router)
app.include_router(subscription.router)
app.include_router(account.router)
app.include_router(playbooks.router)
app.include_router(journal_router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "TradeDesk API"}


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
                cur.execute("SELECT to_regclass('public.user_profiles') IS NOT NULL AND to_regclass('public.billing_orders') IS NOT NULL AND to_regclass('public.api_rate_windows') IS NOT NULL AS ready")
                row = cur.fetchone()
                if not row or not row["ready"]:
                    return JSONResponse(status_code=503, content={"status": "unavailable"})
        return {"status": "ready"}
    except Exception:
        return JSONResponse(status_code=503, content={"status": "unavailable"})


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
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
