import contextlib
from unittest.mock import Mock
from fastapi.testclient import TestClient
from app import main


def test_readiness_fails_when_database_is_unavailable(monkeypatch):
    import app.database as database
    @contextlib.contextmanager
    def unavailable(**kw):
        raise RuntimeError("database down")
        yield
    monkeypatch.setattr(database,"get_conn",unavailable)
    assert TestClient(main.app).get("/ready").status_code == 503


def test_security_headers_present():
    response=TestClient(main.app).get("/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
