from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import FRONTEND_URL
from .routers import trades, stats, daylogs, exchange, subscription

app = FastAPI(title="TradeDesk API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_URL,
        "http://localhost:5173",   # Vite dev
        "http://localhost:3000",   # alt dev
        "capacitor://localhost",   # Capacitor mobile
        "http://localhost",        # Expo mobile
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trades.router)
app.include_router(stats.router)
app.include_router(daylogs.router)
app.include_router(exchange.router)
app.include_router(subscription.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "TradeDesk API"}
