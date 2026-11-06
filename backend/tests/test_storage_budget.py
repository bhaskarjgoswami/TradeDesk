import contextlib
from datetime import datetime,timedelta,timezone
from unittest.mock import MagicMock
import pytest
from fastapi import HTTPException
from app import storage_budget as budget


def connect_for(monkeypatch,profile,used):
    cur=MagicMock();cur.__enter__.return_value=cur;cur.fetchone.side_effect=[profile,dict(used=used)]
    conn=MagicMock();conn.cursor.return_value=cur
    @contextlib.contextmanager
    def connect():yield conn
    monkeypatch.setattr(budget,'get_conn',connect)
    return cur


def test_upload_budget_serializes_accounts_and_rejects_overflow(monkeypatch):
    cur=connect_for(monkeypatch,dict(subscription_tier='free'),budget.FREE_BYTES-1)
    with pytest.raises(HTTPException) as error:
        with budget.storage_budget('a',2):pytest.fail('Must not upload')
    assert error.value.status_code==413
    statements=[call.args[0] for call in cur.execute.call_args_list]
    assert 'pg_advisory_xact_lock' in statements[1]
    assert 'FOR SHARE' in statements[2]


def test_pro_budget_expires_and_pending_deletion_cannot_upload(monkeypatch):
    future=datetime.now(timezone.utc)+timedelta(days=1)
    assert budget.allowance(dict(subscription_tier='pro',subscription_expires_at=future))==budget.PRO_BYTES
    assert budget.allowance(dict(subscription_tier='pro',subscription_expires_at=future-timedelta(days=2)))==budget.FREE_BYTES
    connect_for(monkeypatch,dict(deletion_started_at=future),0)
    with pytest.raises(HTTPException) as error:
        with budget.storage_budget('a',1):pytest.fail('Deletion must block uploads')
    assert error.value.status_code==423
