import os

# Dummy config so the app imports without real secrets (no DB is touched:
# the pool is created lazily and tests stub get_conn where needed).
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "anon")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "service")
os.environ.setdefault("SUPABASE_JWT_SECRET", "jwt-secret")
os.environ.setdefault("DATABASE_URL", "postgresql://u:p@localhost:1/db")
os.environ.setdefault("EXCHANGE_ENC_KEY", "x" * 43 + "=")
