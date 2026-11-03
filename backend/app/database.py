import psycopg2
import psycopg2.extras
import psycopg2.pool
from contextlib import contextmanager
from .config import DATABASE_URL

# Reuse connections across requests: opening a new TLS connection to the
# Supabase pooler on every request costs a few hundred ms from Render.
_pool = psycopg2.pool.ThreadedConnectionPool(
    1, 20, DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor,
    keepalives=1, keepalives_idle=30,
)


@contextmanager
def get_conn():
    conn = _pool.getconn()
    try:  # the server may have dropped an idle connection; swap it for a fresh one
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
        conn.rollback()
    except psycopg2.Error:
        _pool.putconn(conn, close=True)
        conn = _pool.getconn()
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
        _pool.putconn(conn, close=broken or bool(conn.closed))
