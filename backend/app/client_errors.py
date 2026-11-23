"""Uncaught browser errors from the web app, without accounts or credentials.

The endpoint is public, so everything is bounded: body size, field lengths,
reports per IP and in total per minute. Values that look like credentials or
personal data are replaced before anything is logged or forwarded.
"""
import json
import logging
import os
import re
import threading
import time
from collections import defaultdict

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

log = logging.getLogger("tradedesk.client_errors")
router = APIRouter(tags=["observability"])

MAX_BODY = 8 * 1024
LIMITS = {"message": 500, "source": 300, "stack": 4000, "url": 300, "ua": 300}
PER_IP_PER_MINUTE = 10
TOTAL_PER_MINUTE = 300

_SCRUBBERS = [
    # JWTs (three base64url segments, header starts with eyJ).
    (re.compile(r"eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*"), "[jwt]"),
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+"), "Bearer [token]"),
    # key=value pairs for anything credential-shaped, in URLs or messages.
    (re.compile(r"(?i)\b((?:access|refresh|id)_token|token|code|key|secret|password|passwd|apikey|api_key|signature|auth|session)=([^&#\s\"']+)"), r"\1=[redacted]"),
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "[email]"),
    # Long opaque strings (API keys, hashes, Razorpay ids) of 32+ chars.
    (re.compile(r"\b[A-Za-z0-9_-]{32,}\b"), "[token]"),
]


def scrub(value):
    for pattern, replacement in _SCRUBBERS:
        value = pattern.sub(replacement, value)
    return value


def clean(payload):
    out = {}
    for field, limit in LIMITS.items():
        value = payload.get(field)
        out[field] = scrub(value if isinstance(value, str) else "")[:limit]
    for field in ("line", "col"):
        value = payload.get(field)
        out[field] = value if isinstance(value, int) and not isinstance(value, bool) and 0 <= value < 10_000_000 else None
    # Only the page path is useful; drop query strings and fragments outright.
    out["url"] = re.split(r"[?#]", out["url"], maxsplit=1)[0]
    return out


class _Limiter:
    def __init__(self):
        self.lock = threading.Lock()
        self.window = 0
        self.per_ip = defaultdict(int)
        self.total = 0

    def allow(self, ip):
        window = int(time.time()) // 60
        with self.lock:
            if window != self.window:
                self.window, self.per_ip, self.total = window, defaultdict(int), 0
            if self.total >= TOTAL_PER_MINUTE or self.per_ip[ip] >= PER_IP_PER_MINUTE:
                return False
            self.total += 1
            self.per_ip[ip] += 1
            return True


limiter = _Limiter()


def client_ip(request):
    # Render terminates TLS and appends the caller to X-Forwarded-For.
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return request.client.host if request.client else "unknown"


def report(error):
    tags = {"kind": "client_error", "client_source": os.path.basename(error["source"])[:200] or "unknown", "client_page": error["url"][:200] or "unknown"}
    if os.environ.get("SENTRY_DSN"):
        import sentry_sdk
        with sentry_sdk.new_scope() as scope:
            for key, value in tags.items():
                scope.set_tag(key, value)
            scope.set_context("client_error", {k: error[k] for k in ("source", "line", "col", "stack", "url", "ua")})
            sentry_sdk.capture_message("Client error: " + error["message"], level="error")
    else:
        log.warning(json.dumps(dict(event="client_error", **error), separators=(",", ":")))


@router.post("/client-errors", status_code=204)
async def client_errors(request: Request):
    declared = request.headers.get("content-length")
    if declared and (not declared.isdigit() or int(declared) > MAX_BODY):
        return JSONResponse(status_code=413, content={"detail": "Request is too large"})
    body = b""
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_BODY:
            return JSONResponse(status_code=413, content={"detail": "Request is too large"})
    try:
        payload = json.loads(body or b"{}")
        if not isinstance(payload, dict):
            raise ValueError()
    except (ValueError, UnicodeError):
        return JSONResponse(status_code=400, content={"detail": "Send a valid JSON object"})
    if not limiter.allow(client_ip(request)):
        return JSONResponse(status_code=429, content={"detail": "Too many reports"})
    report(clean(payload))
    return Response(status_code=204)
