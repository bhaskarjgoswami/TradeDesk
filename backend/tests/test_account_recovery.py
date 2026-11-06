import contextlib
from unittest.mock import MagicMock
import httpx
import pytest
from fastapi import HTTPException
from app.routers import account


def test_auth_provider_failure_retains_pending_deletion_and_retry_completes(monkeypatch):
    cur=MagicMock();cur.__enter__.return_value=cur
    conn=MagicMock();conn.cursor.return_value=cur
    @contextlib.contextmanager
    def connect(**kwargs):yield conn
    monkeypatch.setattr(account,'get_conn',connect)
    calls=[]
    class Provider:
        attempts=0
        def __init__(self,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def post(self,*args,**kwargs):return httpx.Response(200,json=[])
        def delete(self,*args,**kwargs):
            Provider.attempts+=1
            return httpx.Response(502 if Provider.attempts==1 else 200)
    monkeypatch.setattr(account.httpx,'Client',Provider)
    user=dict(user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    with pytest.raises(HTTPException) as error:account.delete_account(user)
    assert error.value.status_code==502
    assert account.delete_account(user)==dict(ok=True)
    statements=[call.args[0] for call in cur.execute.call_args_list]
    assert sum('deletion_started_at=COALESCE' in query for query in statements)==2
    assert sum('DROP SCHEMA IF EXISTS' in query for query in statements)==2
