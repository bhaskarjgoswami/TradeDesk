"""First-party product events: allowed names only, one row per account/event/day."""
import contextlib
import os
from urllib.parse import urlparse

import psycopg2
import pytest
from fastapi.testclient import TestClient
from psycopg2.extras import RealDictCursor

from app import events, main
from app.auth import get_current_user

UID = "cccccccc-cccc-cccc-cccc-cccccccccccc"


@pytest.fixture
def client():
    main.app.dependency_overrides[get_current_user] = lambda: {"user_id": UID, "email": ""}
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def test_unknown_event_is_rejected(client, monkeypatch):
    seen = []
    monkeypatch.setattr(events, "record", lambda uid, name: seen.append(name))
    assert client.post("/j/api/events", json={"name": "keystroke"}).status_code == 400
    assert client.post("/j/api/events", json=["app_open"]).status_code == 400
    assert seen == []


def test_known_event_is_recorded(client, monkeypatch):
    seen = []
    monkeypatch.setattr(events, "record", lambda uid, name: seen.append((uid, name)))
    assert client.post("/j/api/events", json={"name": "trade_logged"}).status_code == 204
    assert seen == [(UID, "trade_logged")]


def test_storage_failure_never_breaks_the_app(client, monkeypatch):
    def boom(uid, name):
        raise RuntimeError("db down")
    monkeypatch.setattr(events, "record", boom)
    assert client.post("/j/api/events", json={"name": "app_open"}).status_code == 202


DSN = os.environ.get("TEST_DATABASE_URL", "")


@pytest.mark.skipif(not DSN, reason="Dedicated PostgreSQL test database not configured")
def test_one_row_per_account_event_and_day(monkeypatch):
    target = urlparse(DSN)
    assert target.hostname in ("localhost", "127.0.0.1") and target.path == "/tradedesk_test"

    @contextlib.contextmanager
    def connect(readonly=False):
        conn = psycopg2.connect(DSN, cursor_factory=RealDictCursor)
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    monkeypatch.setattr(events, "get_conn", connect)
    monkeypatch.setattr(events, "_ready", False)
    with connect() as conn, conn.cursor() as cur:
        cur.execute("DROP SCHEMA IF EXISTS analytics CASCADE")
    events.record(UID, "app_open")
    events.record(UID, "app_open")
    events.record(UID, "trade_logged")
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT name FROM analytics.product_events WHERE user_id=%s ORDER BY name", (UID,))
        assert [r["name"] for r in cur.fetchall()] == ["app_open", "trade_logged"]
        cur.execute("DROP SCHEMA analytics CASCADE")
