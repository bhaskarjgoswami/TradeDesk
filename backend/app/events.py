"""First-party product events for the activation funnel, without third-party trackers.

Only an event name, the account id and the UTC day are stored, at most one row
per account, event and day. That is enough to answer: who logged a first trade,
who reviewed one, who completed the routine, and who came back after a week.
No trade content, amounts or device details are recorded.

The table lives in its own `analytics` schema, which the Supabase REST API does
not expose, and is created on first use.
"""
import threading

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse

from .auth import get_current_user
from .database import get_conn

router = APIRouter(prefix="/j", tags=["events"])

EVENTS = frozenset({"app_open", "trade_logged", "trade_reviewed", "routine_completed"})

_DDL = """
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE TABLE IF NOT EXISTS analytics.product_events (
    user_id uuid NOT NULL,
    name text NOT NULL,
    day date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
    first_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, name, day)
);
"""
_ready = False
_lock = threading.Lock()


def _ensure_table(conn):
    global _ready
    if _ready:
        return
    with _lock:
        if not _ready:
            with conn.cursor() as cur:
                cur.execute(_DDL)
            _ready = True


def record(user_id: str, name: str) -> None:
    with get_conn() as conn:
        _ensure_table(conn)
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO analytics.product_events (user_id, name) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (user_id, name),
            )


@router.post("/api/events")
def post_event(request: Request, user=Depends(get_current_user)):
    # main.parse_journal_body has already read and validated the JSON object.
    body = getattr(request.state, "journal_body", None)
    name = body.get("name") if isinstance(body, dict) else None
    if name not in EVENTS:
        return JSONResponse(status_code=400, content={"error": "Unknown event"})
    try:
        record(user["user_id"], name)
    except Exception:
        # Analytics must never break the journal.
        return Response(status_code=202)
    return Response(status_code=204)
