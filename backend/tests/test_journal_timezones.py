from datetime import timezone
from zoneinfo import ZoneInfo
import pytest
from app.journal import core

def test_delta_round_trip_day_uses_journal_zone_and_keeps_utc_timestamps(monkeypatch):
    monkeypatch.setattr(core,'_contract_value',lambda symbol:1)
    fills=[{'id':1,'product_symbol':'TEST','created_at':'2026-11-04T20:00:00Z','side':'buy','size':1,'price':100},{'id':2,'product_symbol':'TEST','created_at':'2026-11-04T20:05:00Z','side':'sell','size':1,'price':101}]
    row=core.delta_round_trips(fills,[],ZoneInfo('Asia/Kolkata'))[0]
    assert row['date']=='2026-11-05'
    assert row['entry_time']=='2026-11-04T20:00:00+00:00'
    assert core._fill_day('2026-11-04T20:00:00Z',ZoneInfo('Asia/Kolkata'))=='2026-11-05'

def test_naive_manual_clocks_become_utc_and_unknown_clocks_stay_unknown(monkeypatch):
    monkeypatch.setattr(core,'journal_zone',lambda name:ZoneInfo(name))
    row=core.normalize_trade_times({'entry_time':'2026-11-05T09:00','exit_time':'2026-11-05T10:00'},'Asia/Kolkata')
    assert row['entry_time']=='2026-11-05T03:30:00+00:00'
    assert core.normalize_trade_times({'entry_time':'2026-11-05'},'Asia/Kolkata')['entry_time']=='2026-11-05'
    with pytest.raises(ValueError,match='earlier'):core.normalize_trade_times({'entry_time':'2026-11-05T10:00','exit_time':'2026-11-05T09:00'},'UTC')

@pytest.mark.parametrize('clock',['2026-03-08T02:30','2026-11-01T01:30'])
def test_ambiguous_or_nonexistent_dst_clock_is_not_silently_guessed(monkeypatch,clock):
    monkeypatch.setattr(core,'journal_zone',lambda name:ZoneInfo(name))
    with pytest.raises(ValueError,match='clock time'):core.normalize_trade_times({'entry_time':clock},'America/New_York')

def test_incomplete_delta_history_is_explicit_and_does_not_return_partial_fills(monkeypatch):
    monkeypatch.setattr(core,'delta_signed_get',lambda *args:{'result':[{'id':1}],'meta':{'after':'more'}})
    with pytest.raises(RuntimeError,match='no partial sync'):core.delta_all_fills(max_pages=2)

def test_contract_metadata_failure_is_not_cached_as_one(monkeypatch):
    monkeypatch.setattr(core,'_CV_CACHE',{})
    def fail(*args,**kwargs):raise OSError('Unavailable')
    monkeypatch.setattr(core.urllib.request,'urlopen',fail)
    with pytest.raises(RuntimeError,match='contract size'):core._contract_value('UNKNOWN')
    assert not core._CV_CACHE

def test_flip_commission_is_split_between_the_closed_and_new_positions(monkeypatch):
    monkeypatch.setattr(core,'_contract_value',lambda symbol:1)
    fills=[{'id':i,'product_symbol':'TEST','created_at':f'2026-11-05T0{i}:00:00Z','side':side,'size':size,'price':100,'commission':fee} for i,side,size,fee in [(1,'buy',1,0),(2,'sell',2,2),(3,'buy',1,0)]]
    rows=core.delta_round_trips(fills,[],timezone.utc)
    assert [r['fee'] for r in rows]==[1,1]
