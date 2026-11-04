"""Real-Postgres isolation checks against a dedicated, disposable CI database."""
import contextlib
import os
from urllib.parse import urlparse

import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from psycopg2.extras import RealDictCursor
from datetime import timedelta
from pathlib import Path
from app.billing import extend
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app import auth
from app.journal import pgcompat

DSN = os.environ.get("TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="Dedicated PostgreSQL test database not configured")
UIDS = ("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")


@pytest.fixture
def database(monkeypatch):
    target = urlparse(DSN)
    if target.hostname not in ("localhost", "127.0.0.1") or target.path != "/tradedesk_test":
        pytest.fail("Isolation tests only run on a disposable localhost/tradedesk_test database")
    pool = ThreadedConnectionPool(1, 8, DSN)
    @contextlib.contextmanager
    def public_connect(**kwargs):
        conn = pool.getconn()
        try:
            conn.autocommit = False
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            pool.putconn(conn)
    with public_connect() as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE TABLE IF NOT EXISTS public.user_profiles(id uuid PRIMARY KEY, subscription_tier text, subscription_plan text, subscription_expires_at timestamptz, razorpay_payment_id text, updated_at timestamptz)")
            cur.execute("CREATE TABLE IF NOT EXISTS public.trades(id serial PRIMARY KEY, title text)")
            cur.execute("TRUNCATE public.trades, public.user_profiles CASCADE")
            cur.execute("INSERT INTO public.trades(title) VALUES ('legacy-private-record')")
            cur.executemany("INSERT INTO public.user_profiles(id) VALUES (%s)", [(u,) for u in UIDS])
            for role in ("anon", "authenticated"):
                cur.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (role,))
                if not cur.fetchone():
                    cur.execute(f'CREATE ROLE "{role}" NOLOGIN')
    with public_connect() as conn:
        with conn.cursor() as cur:
            cur.execute((Path(__file__).parents[2] / "supabase/migrations/20261104_payment_ledger.sql").read_text())
    monkeypatch.setattr(pgcompat, "_get_pool", lambda: pool)
    monkeypatch.setattr(auth, "get_conn", public_connect)
    schemas = [pgcompat.schema_for(uid) for uid in UIDS]
    for schema in schemas:
        pgcompat.forget_schema(schema)
        def initialize():
            with pgcompat.db() as conn:
                conn.execute("CREATE TABLE trades(id serial PRIMARY KEY, title text)")
        pgcompat.ensure_schema(schema, initialize)
    yield public_connect, schemas
    with public_connect() as conn:
        with conn.cursor() as cur:
            for schema in schemas:
                cur.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
    for schema in schemas:
        pgcompat.forget_schema(schema)
    pool.closeall()


def test_two_journals_never_read_or_delete_each_others_trades(database):
    public_connect, (first, second) = database
    with pgcompat.Connection(first) as conn:
        conn.execute("INSERT INTO trades(title) VALUES (?)", ("first-user-only",))
    with pgcompat.Connection(second) as conn:
        conn.execute("INSERT INTO trades(title) VALUES (?)", ("second-user-only",))
    with pgcompat.Connection(first) as conn:
        assert [r["title"] for r in conn.execute("SELECT title FROM trades")] == ["first-user-only"]
        conn.execute("DELETE FROM trades")
    with pgcompat.Connection(second) as conn:
        assert [r["title"] for r in conn.execute("SELECT title FROM trades")] == ["second-user-only"]
    with public_connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT title FROM public.trades")
            assert cur.fetchall() == [("legacy-private-record",)]


def test_missing_cached_schema_cannot_fall_back_to_shared_trades(database):
    public_connect, (first, _) = database
    assert first in pgcompat._provisioned
    with public_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(f'DROP SCHEMA "{first}" CASCADE')
    with pytest.raises(pgcompat.MissingJournalSchema):
        pgcompat.Connection(first)
    with public_connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT title FROM public.trades")
            assert cur.fetchall() == [("legacy-private-record",)]


def test_deleted_profile_revokes_an_otherwise_valid_token(database, monkeypatch):
    public_connect, _ = database
    monkeypatch.setattr(auth, "_decode_token", lambda _: {"sub": UIDS[0], "email": "test@example.com"})
    credential = HTTPAuthorizationCredentials(scheme="Bearer", credentials="previously-valid-token")
    assert auth.get_current_user(credential)["user_id"] == UIDS[0]
    with public_connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM public.user_profiles WHERE id=%s", (UIDS[0],))
    with pytest.raises(HTTPException) as error:
        auth.get_current_user(credential)
    assert error.value.status_code == 401


def test_payment_ledger_replay_renewal_and_owner(database):
    public_connect, _ = database
    with public_connect() as conn:
        conn.cursor_factory = RealDictCursor
        with conn.cursor() as cur:
            for number in (1, 2):
                cur.execute("INSERT INTO public.billing_orders(id,user_id,plan,currency,amount) VALUES (%s,%s,'monthly','INR',9900)", (f"order_{number}", UIDS[0]))
        first = extend(conn, UIDS[0], "monthly", "pay_A", "order_1")
        second = extend(conn, UIDS[0], "monthly", "pay_B", "order_2")
        assert second - first == timedelta(days=30)
        assert extend(conn, UIDS[0], "monthly", "pay_A", "order_1") == second
        # A different payment for the already granted order also adds no days.
        assert extend(conn, UIDS[0], "monthly", "pay_C", "order_1") == second
        with pytest.raises(ValueError, match="mismatched"):
            extend(conn, UIDS[1], "monthly", "pay_A", "order_1")
