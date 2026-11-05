import contextlib
import sqlite3
import pytest
from app.journal import core,workspace

@pytest.fixture
def journal(monkeypatch,tmp_path):
    path=tmp_path/'integrity.sqlite'
    @contextlib.contextmanager
    def connect():
        conn=sqlite3.connect(path);conn.row_factory=sqlite3.Row
        try:
            with conn:yield conn
        finally:conn.close()
    monkeypatch.setattr(core,'db',connect)
    core.init_db();core.init_day_logs();core.init_plan_settings();core.init_routine();workspace.init(connect)
    return connect

def trade(**kwargs):return dict(date='2026-11-05',symbol='EURUSD',direction='Long',pnl=100,contract_value=100000,**kwargs)

def test_manual_retry_is_idempotent_and_new_intent_can_be_identical(journal):
    a=core.create_trade(trade(clientId='intent-1'))
    assert core.create_trade(trade(clientId='intent-1'))['id']==a['id']
    assert core.create_trade(trade(clientId='intent-2'))['id']!=a['id']
    with journal() as conn:assert conn.execute('SELECT count(*) FROM trades').fetchone()[0]==2

def test_reusing_save_id_with_changed_payload_is_rejected(journal):
    core.create_trade(trade(clientId='same',notes='original'))
    with pytest.raises(workspace.Conflict):core.create_trade(trade(clientId='same',notes='changed'))
    assert core.list_trades({})[0]['notes']=='original'

def test_full_edits_require_revision_and_response_lost_update_is_safe(journal):
    a=core.create_trade(trade(clientId='original'))
    first=core.update_trade(a['id'],{**a,'notes':'newer','expectedRevision':a['revision']})
    assert first['revision']==2
    assert core.update_trade(a['id'],{**a,'notes':'newer','expectedRevision':1})['revision']==2
    with pytest.raises(workspace.Conflict):core.update_trade(a['id'],{**a,'notes':'stale','expectedRevision':1})
    with pytest.raises(workspace.Conflict):core.update_trade(a['id'],first)
    assert core.list_trades({})[0]['notes']=='newer'

def test_failed_insert_does_not_consume_pretrade_checklist(journal):
    with journal() as conn:
        conn.execute("INSERT INTO journal_settings(key,value,revision) VALUES ('pending_checklist',?,1)", ('{"at":"2026-11-05T09:00","criteria":["Ready"],"charting":[],"management":[],"keys":[],"template":{}}',))
        conn.execute("CREATE TRIGGER reject_insert BEFORE INSERT ON trades BEGIN SELECT RAISE(ABORT,'quota'); END")
    with pytest.raises(sqlite3.IntegrityError):core.create_trade(trade(clientId='will-retry'))
    with journal() as conn:assert conn.execute("SELECT 1 FROM journal_settings WHERE key='pending_checklist'").fetchone()
