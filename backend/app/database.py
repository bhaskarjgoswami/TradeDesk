import psycopg2
import psycopg2.extras
import psycopg2.pool
import threading
import time
from contextlib import contextmanager
from .config import DATABASE_URL

# Reuse connections across requests: opening a new TLS connection to the
# Supabase pooler on every request costs a few hundred ms from Render.
_pool = None
_pool_lock = threading.Lock()
_last_used: dict[int, float] = {}  # id(conn) -> monotonic time it was returned to the pool
IDLE_PING_SECONDS = 30


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
def get_conn(readonly: bool = False):
    """Pooled connection. Every DB round trip crosses regions (Render -> Supabase
    Tokyo), so: ping only connections idle long enough to have been dropped, and
    run read-only work in autocommit (no separate BEGIN/COMMIT round trips)."""
    pool = _get_pool()
    conn = pool.getconn()
    if conn.closed or time.monotonic() - _last_used.get(id(conn), 0) > IDLE_PING_SECONDS:
        try:
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        except psycopg2.Error:
            _last_used.pop(id(conn), None)
            pool.putconn(conn, close=True)
            conn = pool.getconn()
    conn.autocommit = readonly
    broken = False
    try:
        yield conn
        if not readonly:
            conn.commit()
    except Exception:
        try:
            conn.rollback()
        except psycopg2.Error:
            broken = True
        raise
    finally:
        close = broken or bool(conn.closed)
        if close:
            _last_used.pop(id(conn), None)
        else:
            _last_used[id(conn)] = time.monotonic()
        pool.putconn(conn, close=close)
