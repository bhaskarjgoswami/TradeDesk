import os

# Dummy config so the app imports without real secrets (no DB is touched:
# the pool is created lazily and tests stub get_conn where needed).
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "anon")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "service")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-jwt-secret-at-least-thirty-two-characters")
os.environ.setdefault("DATABASE_URL", "postgresql://u:p@localhost:1/db")
os.environ.setdefault("EXCHANGE_ENC_KEY", "x" * 43 + "=")
# Never let unit tests load real payment keys from the ignored local .env.
for name in ("RAZORPAY_KEY_ID","RAZORPAY_KEY_SECRET","RAZORPAY_WEBHOOK_SECRET"):
    os.environ.setdefault(name, "")


import pytest

@pytest.fixture(autouse=True)
def isolated_rate_limits(monkeypatch):
    from collections import Counter
    from app import ratelimit
    counts=Counter()
    def hit(uid,action,maximum):
        counts[uid,action]+=1
        return counts[uid,action]
    monkeypatch.setattr(ratelimit,"record_hit",hit)
