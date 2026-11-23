import importlib
import json
import logging
import re

import pytest
from fastapi.testclient import TestClient

from app import client_errors, main
from app.observability import scrub_event


def preflight(client, origin):
    return client.options("/health", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})


@pytest.mark.parametrize("origin", [
    "https://trade-desk-dl66.vercel.app",
    "https://trade-desk-dl66-od3jehirp-bhaskarjgoswami-5079s-projects.vercel.app",
    "https://trade-desk-dl66-git-launch-fixes-bhaskarjgoswami-5079s-projects.vercel.app",
])
def test_vercel_regex_accepts_this_project_and_team(origin):
    assert re.fullmatch(main.VERCEL_ORIGIN_REGEX, origin)


@pytest.mark.parametrize("origin", [
    "https://trade-desk-dl66-evil.vercel.app",
    "https://trade-desk-dl66attacker.vercel.app",
    "https://trade-desk-dl66-od3jehirp-someone-elses-projects.vercel.app",
    "https://trade-desk-dl66-od3jehirp-bhaskarjgoswami-5079s-projects.vercel.app.evil.com",
    "http://trade-desk-dl66.vercel.app",
    "https://evil-trade-desk-dl66.vercel.app",
])
def test_vercel_regex_rejects_lookalikes(origin):
    assert not re.fullmatch(main.VERCEL_ORIGIN_REGEX, origin)
    assert "access-control-allow-origin" not in preflight(TestClient(main.app), origin).headers


def test_localhost_allowed_outside_production():
    response = preflight(TestClient(main.app), "http://localhost:5173")
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_localhost_rejected_in_production(monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("FRONTEND_URL", "https://trade-desk-dl66.vercel.app")
    try:
        from app import config
        importlib.reload(config)
        prod = importlib.reload(main)
        client = TestClient(prod.app)
        assert "access-control-allow-origin" not in preflight(client, "http://localhost:5173").headers
        assert "access-control-allow-origin" not in preflight(client, "capacitor://localhost").headers
        allowed = preflight(client, "https://trade-desk-dl66.vercel.app")
        assert allowed.headers.get("access-control-allow-origin") == "https://trade-desk-dl66.vercel.app"
    finally:
        monkeypatch.delenv("RENDER")
        monkeypatch.delenv("FRONTEND_URL")
        from app import config
        importlib.reload(config)
        importlib.reload(main)


@pytest.fixture
def reports(monkeypatch):
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    monkeypatch.setattr(client_errors, "limiter", client_errors._Limiter())
    sent = []
    monkeypatch.setattr(client_errors, "report", sent.append)
    return sent


def post(body, **headers):
    return TestClient(main.app).post("/client-errors", content=body, headers={"Content-Type": "text/plain", **headers})


def test_client_error_is_accepted_without_auth_and_scrubbed(reports):
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJlLXZhbHVl"
    body = json.dumps(dict(
        message=f"Failed for trader@example.com with {jwt} and Bearer abc.def",
        source="https://trade-desk-dl66.vercel.app/assets/main.js", line=12, col=3,
        stack="Error\n at x (main.js:1:2) token=sekret&code=abc",
        url="https://trade-desk-dl66.vercel.app/auth/confirm?code=private#access_token=private",
        ua="Mozilla/5.0", extra="ignored",
    ))
    response = post(body)
    assert response.status_code == 204
    [error] = reports
    encoded = json.dumps(error)
    for secret in ("trader@example.com", jwt, "abc.def", "sekret", "private", "ignored"):
        assert secret not in encoded
    assert error["url"] == "https://trade-desk-dl66.vercel.app/auth/confirm"
    assert error["line"] == 12 and error["col"] == 3
    assert set(error) == {"message", "source", "line", "col", "stack", "url", "ua"}


def test_client_error_fields_are_truncated(reports):
    assert post(json.dumps(dict(message="m " * 1000, stack="s " * 1500, line="x"))).status_code == 204
    error = reports[0]
    assert len(error["message"]) == 500 and len(error["stack"]) <= 4000 and error["line"] is None


def test_client_error_rejects_large_and_invalid_bodies(reports):
    assert post("x" * (8 * 1024 + 1)).status_code == 413
    assert post("[1,2]").status_code == 400
    assert post("not json").status_code == 400
    assert reports == []


def test_client_error_rate_limit_per_ip(reports):
    statuses = [post('{"message":"x"}', **{"X-Forwarded-For": "203.0.113.5"}).status_code for _ in range(12)]
    assert statuses.count(204) == client_errors.PER_IP_PER_MINUTE
    assert statuses[-1] == 429
    assert post('{"message":"x"}', **{"X-Forwarded-For": "203.0.113.6"}).status_code == 204


def test_client_error_logs_warning_without_sentry(monkeypatch, caplog):
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    monkeypatch.setattr(client_errors, "limiter", client_errors._Limiter())
    with caplog.at_level(logging.WARNING, logger="tradedesk.client_errors"):
        assert post('{"message":"boom"}').status_code == 204
    assert any("client_error" in r.getMessage() and "boom" in r.getMessage() for r in caplog.records)


def test_client_error_uses_sentry_when_configured(monkeypatch):
    import sentry_sdk
    captured = []
    monkeypatch.setenv("SENTRY_DSN", "https://key@example.invalid/1")
    monkeypatch.setattr(client_errors, "limiter", client_errors._Limiter())
    monkeypatch.setattr(sentry_sdk, "capture_message", lambda message, level=None: captured.append((message, level)))
    assert post('{"message":"boom","source":"https://x/assets/a.js"}').status_code == 204
    assert captured == [("Client error: boom", "error")]


def test_sentry_scrubber_keeps_client_error_tags_but_not_server_messages():
    client = scrub_event(dict(message="Client error: boom", tags=dict(kind="client_error", client_source="a.js", other="x"), contexts=dict(client_error=dict(line=1), os=dict(name="x"))), {})
    assert client["message"] == "Client error: boom"
    assert client["tags"] == dict(kind="client_error", client_source="a.js")
    assert client["contexts"] == dict(client_error=dict(line=1))
    server = scrub_event(dict(message="SELECT secret", tags=dict(kind="other")), {})
    assert "message" not in server and "tags" not in server
