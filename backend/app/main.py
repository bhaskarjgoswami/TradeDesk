import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import FRONTEND_URL
from .routers import trades, stats, daylogs, exchange, subscription, account, playbooks

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


@app.get("/health")
def health():
    return {"status": "ok", "service": "TradeDesk API"}
