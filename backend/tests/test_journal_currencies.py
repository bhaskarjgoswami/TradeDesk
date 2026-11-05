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


def test_csv_requires_explicit_contract_units_before_calculating(journal):
    row=dict(date='2026-11-05',symbol='EURUSD',direction='Long',entry=1.1,exit=1.101,qty=1,stop=1.099)
    with pytest.raises(ValueError,match='contract multiplier'):workspace.import_trades(journal,{'rows':[row]})
    assert workspace.import_trades(journal,{'rows':[{**row,'contract_value':100000}]})['imported']==1
    saved=core.list_trades({})[0]
    assert saved['pnl']==pytest.approx(100) and saved['risk']==pytest.approx(100)


def test_csv_trade_ids_distinguish_identical_executions_and_ignore_notes(journal):
    row=dict(date='2026-11-05',symbol='SPY',direction='Long',pnl=10,execution_id='one',broker_key='Example')
    assert workspace.import_trades(journal,{'rows':[row]})['imported']==1
    assert workspace.import_trades(journal,{'rows':[{**row,'notes':'edited'}]})['skipped']==1
    assert workspace.import_trades(journal,{'rows':[{**row,'execution_id':'two'}]})['imported']==1


def test_fallback_import_identity_ignores_mutable_annotations(journal):
    row=dict(date='2026-11-05',symbol='SPY',direction='Long',pnl=10)
    workspace.import_trades(journal,{'rows':[row]})
    assert workspace.import_trades(journal,{'rows':[{**row,'notes':'edited','tags':'reviewed'}]})['skipped']==1


def test_net_outcome_agrees_with_stats_and_filters_for_existing_trades(journal):
    saved=core.create_trade(dict(date='2026-11-05',symbol='SPY',direction='Long',pnl=2,fee=5,outcome='Win'))
    assert saved['outcome']=='Loss'
    assert core.stats()['losses']==1
    assert len(core.list_trades({'outcome':['Loss']}))==1
    assert core.list_trades({'outcome':['Win']})==[]
