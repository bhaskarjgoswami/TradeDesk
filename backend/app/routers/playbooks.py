"""
Playbooks: named strategies with their own pre-trade checklist, exit rules,
management notes. Trades link to one via trades.playbook_id.
"""
from fastapi import APIRouter, Depends, HTTPException
from psycopg2.extras import Json
from ..auth import get_current_user
from ..database import get_conn
from ..models import PlaybookIn

router = APIRouter(prefix="/api/playbooks", tags=["playbooks"])

FIELDS = ["name", "description", "checklist", "exit_rules", "management", "notes", "active"]


def _vals(body: PlaybookIn) -> list:
    return [Json(body.checklist) if f == "checklist" else getattr(body, f) for f in FIELDS]


@router.get("")
def list_playbooks(user=Depends(get_current_user)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT p.*, COUNT(t.id) AS trade_count
                FROM playbooks p LEFT JOIN trades t ON t.playbook_id = p.id AND t.user_id = p.user_id
                WHERE p.user_id=%s
                GROUP BY p.id
                ORDER BY p.active DESC, lower(p.name)
                """,
                (user["user_id"],),
            )
            return cur.fetchall()


@router.post("", status_code=201)
def create_playbook(body: PlaybookIn, user=Depends(get_current_user)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO playbooks ({','.join(FIELDS)}, user_id) "
                f"VALUES ({','.join(['%s'] * len(FIELDS))}, %s) RETURNING *, 0 AS trade_count",
                _vals(body) + [user["user_id"]],
            )
            return cur.fetchone()


@router.put("/{playbook_id}")
def update_playbook(playbook_id: int, body: PlaybookIn, user=Depends(get_current_user)):
    sets = ",".join(f"{f}=%s" for f in FIELDS)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE playbooks SET {sets}, updated_at=now() WHERE user_id=%s AND id=%s RETURNING *",
                _vals(body) + [user["user_id"], playbook_id],
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Playbook not found")
    return row


@router.delete("/{playbook_id}")
def delete_playbook(playbook_id: int, user=Depends(get_current_user)):
    """Trades keep their data; their playbook link is cleared (ON DELETE SET NULL)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM playbooks WHERE user_id=%s AND id=%s", (user["user_id"], playbook_id))
            if cur.rowcount == 0:
                raise HTTPException(404, "Playbook not found")
    return {"ok": True}


def assert_owns_playbook(conn, uid: str, playbook_id) -> None:
    """The FK only checks existence; make sure the playbook is this user's."""
    if playbook_id is None:
        return
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM playbooks WHERE id=%s AND user_id=%s", (playbook_id, uid))
        if not cur.fetchone():
            raise HTTPException(400, "Unknown playbook")
