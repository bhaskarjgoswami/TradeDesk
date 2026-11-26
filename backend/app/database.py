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
POOL_WAIT_SECONDS = 15


class ReusingPool(psycopg2.pool.ThreadedConnectionPool):
    """ThreadedConnectionPool tuned for one slow, far-away database.

    The stock pool keeps only `minconn` idle connections and closes the rest, and it
    opens new connections while holding its lock. The journal fires ~10 requests at
    once, so every page load re-opened connections one after another (~0.4 s each)
    and requests queued for seconds, failing with "pool exhausted" past maxconn.
    Here every returned connection stays open (up to maxconn), new connections open
    in parallel outside the lock, and a full pool waits briefly instead of failing."""

    def __init__(self, minconn, maxconn, *args, **kwargs):
        super().__init__(minconn, maxconn, *args, **kwargs)
        self._free = threading.Condition(self._lock)
        self._opening = 0

    def getconn(self, key=None):
        deadline = time.monotonic() + POOL_WAIT_SECONDS
        with self._free:
            while True:
                if self.closed:
                    raise psycopg2.pool.PoolError("connection pool is closed")
                if self._pool or (key is not None and key in self._used):
                    return self._getconn(key)
                if len(self._used) + self._opening < self.maxconn:
                    self._opening += 1
                    break
                left = deadline - time.monotonic()
                if left <= 0:
                    raise psycopg2.pool.PoolError("connection pool exhausted")
                self._free.wait(left)
        try:
            conn = psycopg2.connect(*self._args, **self._kwargs)
        except BaseException:
            with self._free:
                self._opening -= 1
                self._free.notify()
            raise
        with self._free:
            self._opening -= 1
            if key is None:
                key = self._getkey()
            self._used[key] = conn
            self._rused[id(conn)] = key
        return conn

    def _putconn(self, conn, key=None, close=False):
        # The base class keeps a returned connection only while fewer than `minconn`
        # are idle; keep up to `maxconn` instead. Called with the lock held.
        keep, self.minconn = self.minconn, self.maxconn
        try:
            super()._putconn(conn, key, close)
        finally:
            self.minconn = keep
            self._free.notify()


def _get_pool():
    global _pool
    if _pool is None:  # created on first use so importing the app needs no DB
        with _pool_lock:
            if _pool is None:
                _pool = ReusingPool(
                    1, 20, DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor,
                    keepalives=1, keepalives_idle=15, keepalives_interval=5, keepalives_count=3,
                    # Fail fast instead of hanging for minutes when the network or pooler drops a connection.
                    connect_timeout=10, tcp_user_timeout=20000,
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
