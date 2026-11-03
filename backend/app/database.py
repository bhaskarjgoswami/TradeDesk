import psycopg2
import psycopg2.extras
import psycopg2.pool
import threading
from contextlib import contextmanager
from .config import DATABASE_URL

# Reuse connections across requests: opening a new TLS connection to the
# Supabase pooler on every request costs a few hundred ms from Render.
_pool = None
_pool_lock = threading.Lock()


def _get_pool():
    global _pool
    if _pool is None:  # created on first use so importing the app needs no DB
        with _pool_lock:
            if _pool is None:
                _pool = psycopg2.pool.ThreadedConnectionPool(
                    1, 20, DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor,
                    keepalives=1, keepalives_idle=30,
                )
    return _pool


@contextmanager
def get_conn():
    pool = _get_pool()
    conn = pool.getconn()
    try:  # the server may have dropped an idle connection; swap it for a fresh one
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
        conn.rollback()
    except psycopg2.Error:
        pool.putconn(conn, close=True)
        conn = pool.getconn()
    broken = False
    try:
        yield conn
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except psycopg2.Error:
            broken = True
        raise
    finally:
        pool.putconn(conn, close=broken or bool(conn.closed))
