import contextlib,sqlite3
import pytest
from app.journal import core,workspace

@pytest.fixture
def journal(monkeypatch,tmp_path):
    path=tmp_path/'currencies.sqlite'
    @contextlib.contextmanager
    def connect():
        conn=sqlite3.connect(path);conn.row_factory=sqlite3.Row
        try:
            with conn:yield conn
        finally:conn.close()
    monkeypatch.setattr(core,'db',connect)
    core.init_db();core.init_day_logs();core.init_plan_settings();core.init_routine();workspace.init(connect)
    return connect

def test_base_currency_can_be_chosen_before_first_trade_but_not_relabel_history(journal):
    state=workspace.read_settings(journal,'preferences')
    state['settings'].update(currency='INR',displayCurrency='INR')
    state=workspace.save_settings(journal,'preferences',state)
    assert state['settings']['currency']=='INR'
    core.create_trade({'date':'2026-11-04','symbol':'AAPL','direction':'Long','pnl':100,'fee':5})
    changed={'settings':{**state['settings'],'currency':'USD'},'revision':state['revision']}
    with pytest.raises(ValueError,match='relabeling historical'):workspace.save_settings(journal,'preferences',changed)
    assert workspace.read_settings(journal,'preferences')['settings']['currency']=='INR'
    display={'settings':{**state['settings'],'displayCurrency':'USD','fxRate':.012},'revision':state['revision']}
    saved=workspace.save_settings(journal,'preferences',display)
    assert saved['settings']['currency']=='INR' and saved['settings']['displayCurrency']=='USD'
    with journal() as conn:assert conn.execute('SELECT pnl FROM trades').fetchone()['pnl']==100

def test_broker_import_preserves_currency_values_and_deduplicates(journal):
    row={'date':'2026-11-04','symbol':'SPY','direction':'Long','pnl':105,'fee':5,'tags':'Broker: Example Broker'}
    assert workspace.import_trades(journal,{'rows':[row]})=={'imported':1,'skipped':0}
    assert workspace.import_trades(journal,{'rows':[row]})=={'imported':0,'skipped':1}
    assert core.stats()['net_pnl']==100
