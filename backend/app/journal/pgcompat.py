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

from ..database import _get_pool

current_schema: contextvars.ContextVar[str | None] = contextvars.ContextVar("journal_schema", default=None)
current_user_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("journal_user", default=None)

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
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


class Connection:
    """sqlite3.Connection look-alike over a pooled psycopg2 connection."""

    def __init__(self, schema: str):
        self._pool = _get_pool()
        self._conn = self._pool.getconn()
        self._conn.autocommit = False
        self._closed = False
        self._schema = schema
        self._set_path()

    def _set_path(self):
        # SET LOCAL lasts one transaction (correct behind Supabase's transaction-mode
        # pooler, where a session-level SET could leak to another user). The journal
        # code commits mid-block and keeps going, so re-apply after every commit.
        with self._conn.cursor() as cur:
            cur.execute("SET LOCAL search_path TO %s, public" % psycopg2.extensions.quote_ident(self._schema, cur))

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
            self._pool.putconn(self._conn, close=bool(self._conn.closed))


def db() -> Connection:
    schema = current_schema.get()
    if not schema:
        raise RuntimeError("journal db() used outside a user request")
    return Connection(schema)


_provisioned: set[str] = set()
_provision_lock = threading.Lock()


def ensure_schema(schema: str, init) -> None:
    """Create the user's schema and run the journal's own table setup once."""
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
                cur.execute("CREATE SCHEMA IF NOT EXISTS %s" % psycopg2.extensions.quote_ident(schema, cur))
                # API roles never see journal schemas (browser access is auth-only)
                cur.execute("REVOKE ALL ON SCHEMA %s FROM anon, authenticated" % psycopg2.extensions.quote_ident(schema, cur))
            conn.commit()
        finally:
            pool.putconn(conn)
        token = current_schema.set(schema)
        try:
            init()  # the journal's own CREATE TABLE IF NOT EXISTS + column migrations
        finally:
            current_schema.reset(token)
        _provisioned.add(schema)
