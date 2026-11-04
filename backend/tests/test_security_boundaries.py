import contextlib
import hashlib
import hmac
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient

from app import auth
from app.journal import pgcompat
from app.main import app
from app.routers import subscription


SCHEMA = "j_" + "a" * 32


def test_missing_namespace_never_searches_public_and_releases_connection(monkeypatch):
    cursor = Mock()
    cursor.__enter__ = Mock(return_value=cursor)
    cursor.__exit__ = Mock(return_value=False)
    cursor.fetchone.return_value = (False,)
    connection = Mock(closed=False)
    connection.cursor.return_value = cursor
    pool = Mock()
    pool.getconn.return_value = connection
    monkeypatch.setattr(pgcompat, "_get_pool", lambda: pool)
    with pytest.raises(pgcompat.MissingJournalSchema):
        pgcompat.Connection(SCHEMA)
    statements = [str(c.args[0]) for c in cursor.execute.call_args_list]
    assert not any("SET LOCAL search_path" in s for s in statements)
    connection.rollback.assert_called_once()
    pool.putconn.assert_called_once()


def test_tenant_search_path_excludes_shared_tables(monkeypatch):
    cursor = Mock()
    cursor.__enter__ = Mock(return_value=cursor)
    cursor.__exit__ = Mock(return_value=False)
    cursor.fetchone.return_value = (True,)
    connection = Mock(closed=False)
    connection.cursor.return_value = cursor
    pool = Mock()
    pool.getconn.return_value = connection
    monkeypatch.setattr(pgcompat, "_get_pool", lambda: pool)
    wrapped = pgcompat.Connection(SCHEMA)
    path = cursor.execute.call_args_list[-1].args[0]
    assert path == f'SET LOCAL search_path TO "{SCHEMA}"'
    assert "public" not in path
    wrapped.close()


def test_deleted_account_token_is_rejected(monkeypatch):
    cursor = Mock()
    cursor.__enter__ = Mock(return_value=cursor)
    cursor.__exit__ = Mock(return_value=False)
    cursor.fetchone.return_value = None
    connection = Mock()
    connection.cursor.return_value = cursor
    @contextlib.contextmanager
    def connect(**kwargs):
        yield connection
    monkeypatch.setattr(auth, "get_conn", connect)
    monkeypatch.setattr(auth, "_decode_token", lambda _: {"sub": "deleted-user"})
    with pytest.raises(HTTPException) as error:
        auth.get_current_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials="old-jwt"))
    assert error.value.status_code == 401


def test_deletion_invalidates_provisioning_cache():
    pgcompat._provisioned.add(SCHEMA)
    pgcompat.forget_schema(SCHEMA)
    assert SCHEMA not in pgcompat._provisioned


def test_empty_webhook_secret_cannot_authorize_forged_event(monkeypatch):
    monkeypatch.setattr(subscription, "RAZORPAY_WEBHOOK_SECRET", "")
    payload = b'{"event":"order.paid"}'
    forged = hmac.new(b"", payload, hashlib.sha256).hexdigest()
    assert subscription._verify_webhook_sig(payload, forged) is False
    with TestClient(app) as client:
        response = client.post("/api/subscription/webhook", content=payload, headers={"x-razorpay-signature": forged})
    assert response.status_code == 503


def test_empty_payment_secret_rejects_verification(monkeypatch):
    monkeypatch.setattr(subscription, "RAZORPAY_KEY_SECRET", "")
    assert subscription._verify_payment_sig("order", "payment", "signature") is False
