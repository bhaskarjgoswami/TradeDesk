"""
Run the local journal's sqlite3 code against Postgres, one schema per user.

The local app (core.py / workspace.py, ported from the desktop journal) talks
to its database through `db()` and plain sqlite-style SQL. This adapter makes a
pooled Postgres connection behave like that sqlite3 connection, pointed at the
signed-in user's private schema, so the journal logic runs unchanged and users
are isolated by the database itself rather than by per-query filters.

Translations (all mechanical):
  ?                          -> %s  (literal % escaped)
  INTEGER PRIMARY KEY AUTOINCREMENT -> BIGSERIAL PRIMARY KEY   (DDL)
  REAL                       -> DOUBLE PRECISION (DDL; PG REAL is float4)
  PRAGMA table_info(t)       -> information_schema.columns
  BEGIN IMMEDIATE            -> per-user transaction advisory lock
  LIKE                       -> ILIKE (sqlite LIKE is case-insensitive)
  cursor.lastrowid           -> INSERT ... RETURNING id
  sqlite3.Row                -> dict rows that also index by position
"""
from __future__ import annotations

import contextvars
import re
import threading

import psycopg2
import psycopg2.extras

import time

from ..database import IDLE_PING_SECONDS, _get_pool, _last_used

current_schema: contextvars.ContextVar[str | None] = contextvars.ContextVar("journal_schema", default=None)
current_user_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("journal_user", default=None)

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_SCHEMA = re.compile(r"^j_[0-9a-f]{32}$")


class AccountDeleting(RuntimeError):
    """Account cleanup has started; no journal access is allowed."""


class MissingJournalSchema(RuntimeError):
    """A tenant namespace disappeared; never fall back to another schema."""


_PRAGMA = re.compile(r"^\s*PRAGMA\s+table_info\((\w+)\)\s*;?\s*$", re.I)
_INSERT_WITH_ID = re.compile(r"^\s*INSERT\s+INTO\s+(trades|workspace_items)\b", re.I)


def schema_for(user_id: str) -> str:
    uid = (user_id or "").lower()
    if not _UUID.match(uid):
        raise ValueError("invalid user id")
    return "j_" + uid.replace("-", "")


class Row(dict):
    """dict row that also supports row[0] like sqlite3.Row."""
    __slots__ = ()

    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


class Cursor:
    def __init__(self, rows=None, lastrowid=None, rowcount=-1):
        self._rows = rows or []
        self.lastrowid = lastrowid
        self.rowcount = rowcount

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)

    def __iter__(self):
        return iter(self._rows)


def _translate(sql: str) -> str:
    s = sql.strip()
    head = s[:20].upper()
    if head.startswith(("CREATE TABLE", "ALTER TABLE")):
        s = re.sub(r"\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b", "BIGSERIAL PRIMARY KEY", s, flags=re.I)
        s = re.sub(r"\bREAL\b", "DOUBLE PRECISION", s)
    s = re.sub(r"(?<!I)\bLIKE\b", "ILIKE", s)
    s = s.replace("%", "%%").replace("?", "%s")
    if _INSERT_WITH_ID.match(s) and not re.search(r"\bRETURNING\b", s, re.I):
        s += " RETURNING id"
    return s


# set_config(..., true) is SET LOCAL: it lasts one transaction. The schema name is strictly
# validated before use; pg_catalog stays implicit and shared tables are never searched.
_PATH_SQL = """SELECT p.deletion_started_at,
    EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=%s) AS ns,
    CASE WHEN p.deletion_started_at IS NULL AND EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=%s)
         THEN set_config('search_path', %s, true) END AS path
  FROM public.user_profiles p WHERE p.id=%s::uuid FOR SHARE OF p"""


class Connection:
    """sqlite3.Connection look-alike over a pooled psycopg2 connection."""

    def __init__(self, schema: str):
        if not _SCHEMA.fullmatch(schema):
            raise ValueError("invalid journal schema")
        self._pool = _get_pool()
        self._conn = self._pool.getconn()
        # A pooled connection idle long enough may have been dropped by the network or the
        # pooler; check it first so the request doesn't hang on a dead socket.
        if self._conn.closed or time.monotonic() - _last_used.get(id(self._conn), 0) > IDLE_PING_SECONDS:
            try:
                self._conn.autocommit = True
                with self._conn.cursor() as cur:
                    cur.execute("SELECT 1")
            except psycopg2.Error:
                _last_used.pop(id(self._conn), None)
                self._pool.putconn(self._conn, close=True)
                self._conn = self._pool.getconn()
        self._closed = False
        self._schema = schema
        try:
            self._conn.autocommit = False
            self._set_path()
        except Exception:
            try:
                self._conn.rollback()
            finally:
                self.close()
            raise

    def _set_path(self):
        # SET LOCAL lasts one transaction (correct behind Supabase's transaction-mode
        # pooler, where a session-level SET could leak to another user). The journal
        # code commits mid-block and keeps going, so re-apply after every commit.
        # One round trip (each one crosses regions): lock the account row, confirm the
        # namespace exists, and only then set the transaction-local search_path.
        with self._conn.cursor() as cur:
            cur.execute(_PATH_SQL, (self._schema, self._schema, f'"{self._schema}"', self._schema[2:]))
            row = cur.fetchone()
            if not row or row['deletion_started_at'] is not None:
                raise AccountDeleting('Account deletion is pending')
            if not row['ns']:
                raise MissingJournalSchema("Journal namespace is unavailable")

    # sqlite3 uses the connection itself as a transaction context
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            if exc_type is None:
                self._conn.commit()
            else:
                self._conn.rollback()
        finally:
            self.close()  # unlike sqlite, also return the connection to the pool
        return False

    def execute(self, sql, params=()):
        if _PRAGMA.match(sql):
            table = _PRAGMA.match(sql).group(1)
            return self._query(
                "SELECT ordinal_position-1 AS cid, column_name AS name, data_type AS type, "
                "0 AS notnull, NULL AS dflt_value, 0 AS pk FROM information_schema.columns "
                "WHERE table_schema=current_schema() AND table_name=%s ORDER BY ordinal_position",
                (table,),
            )
        if sql.strip().upper() == "BEGIN IMMEDIATE":
            return self._query("SELECT pg_advisory_xact_lock(hashtext(current_schema()))")
        return self._query(_translate(sql), tuple(params or ()))

    def executemany(self, sql, seq):
        last = Cursor()
        for params in seq:
            last = self.execute(sql, params)
        return last

    def _query(self, sql, params=()):
        with self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = [Row(r) for r in cur.fetchall()] if cur.description else []
            lastrowid = rows[0].get("id") if rows and sql.rstrip().endswith("RETURNING id") else None
            return Cursor(rows, lastrowid, cur.rowcount)

    def commit(self):
        self._conn.commit()
        self._set_path()

    def rollback(self):
        self._conn.rollback()
        self._set_path()

    def close(self):
        if not self._closed:
            self._closed = True
            if self._conn.closed:
                _last_used.pop(id(self._conn), None)
            else:
                _last_used[id(self._conn)] = time.monotonic()
            self._pool.putconn(self._conn, close=bool(self._conn.closed))


def db() -> Connection:
    schema = current_schema.get()
    if not schema:
        raise RuntimeError("journal db() used outside a user request")
    return Connection(schema)


_provisioned: set[str] = set()
_provision_lock = threading.Lock()


def forget_schema(schema: str) -> None:
    with _provision_lock:
        _provisioned.discard(schema)


def ensure_schema(schema: str, init, version: str | None = None) -> None:
    """Create the user's schema and run the journal's own table setup once.

    With a version, the finished setup is recorded as a comment on the schema, so a
    restarted server (free hosting sleeps when idle) skips the ~100 setup queries
    until the journal code changes."""
    if not _SCHEMA.fullmatch(schema):
        raise ValueError("invalid journal schema")
    if schema in _provisioned:
        return
    with _provision_lock:
        if schema in _provisioned:
            return
        pool = _get_pool()
        conn = pool.getconn()
        try:
            conn.autocommit = False
            with conn.cursor() as cur:
                cur.execute('SELECT deletion_started_at FROM public.user_profiles WHERE id=%s::uuid FOR SHARE',(schema[2:],))
                account=cur.fetchone()
                if not account or account['deletion_started_at'] is not None:raise AccountDeleting('Account deletion is pending')
                if version:
                    cur.execute("SELECT obj_description(oid,'pg_namespace') AS note FROM pg_catalog.pg_namespace WHERE nspname=%s",(schema,))
                    found=cur.fetchone()
                    if found and found['note']==version:
                        conn.commit()
                        _provisioned.add(schema)
                        return
                cur.execute("CREATE SCHEMA IF NOT EXISTS %s" % psycopg2.extensions.quote_ident(schema, cur))
                # API roles never see journal schemas (browser access is auth-only)
                cur.execute("REVOKE ALL ON SCHEMA %s FROM anon, authenticated" % psycopg2.extensions.quote_ident(schema, cur))
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            pool.putconn(conn)
        token = current_schema.set(schema)
        try:
            init()  # the journal's own CREATE TABLE IF NOT EXISTS + column migrations
        finally:
            current_schema.reset(token)
        if version:
            conn = pool.getconn()
            try:
                conn.autocommit = False
                with conn.cursor() as cur:
                    cur.execute("COMMENT ON SCHEMA %s IS %%s" % psycopg2.extensions.quote_ident(schema, cur), (version,))
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                pool.putconn(conn)
        _provisioned.add(schema)


def install_trade_guards(schema: str):
    """Every write path shares a database quota guard and per-tenant lock."""
    if not _SCHEMA.fullmatch(schema):
        raise ValueError("invalid journal schema")
    with Connection(schema) as conn:
        conn._query(f'CREATE INDEX IF NOT EXISTS trades_date_id ON "{schema}".trades(date DESC,id DESC)')
        conn._query(f'''CREATE OR REPLACE FUNCTION "{schema}".enforce_trade_quota()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE paid boolean; used integer;
        BEGIN
            IF TG_OP = 'UPDATE' THEN
                IF NEW.date IS NOT DISTINCT FROM OLD.date THEN RETURN NEW; END IF;
            END IF;
            PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_SCHEMA));
            SELECT subscription_tier='pro' AND
                (subscription_expires_at IS NULL OR subscription_expires_at > now())
                INTO paid FROM public.user_profiles
                WHERE id=substring(TG_TABLE_SCHEMA from 3)::uuid;
            IF NOT FOUND THEN RAISE EXCEPTION 'account-unavailable'; END IF;
            IF COALESCE(paid,false) THEN RETURN NEW; END IF;
            -- Bulk imports bring in history: only today's and yesterday's trades count
            -- against the free limit (yesterday covers time zones ahead of UTC).
            IF current_setting('tradedesk.bulk_import', true) = 'on'
               AND NEW.date < to_char(current_date - 1, 'YYYY-MM-DD') THEN RETURN NEW; END IF;
            SELECT count(*) INTO used FROM "{schema}".trades WHERE date=NEW.date AND id IS DISTINCT FROM NEW.id;
            IF used >= 2 THEN RAISE EXCEPTION 'free-daily-limit'; END IF;
            RETURN NEW;
        END $$''')
        conn._query(f'DROP TRIGGER IF EXISTS trade_quota ON "{schema}".trades')
        conn._query(f'CREATE TRIGGER trade_quota BEFORE INSERT OR UPDATE OF date ON "{schema}".trades FOR EACH ROW EXECUTE FUNCTION "{schema}".enforce_trade_quota()')
