import json
import pytest
from app.journal import portable,workspace


def snapshot(**tables):return {key:tables.get(key,[]) for key in portable.TABLES}


def test_restored_profile_and_preferences_use_live_validators():
    data=snapshot(journal_settings=[dict(key='workspace_profile',value=json.dumps({**workspace.DEFAULT_PROFILE,'timezone':'Invalid/Zone'}),revision=1)])
    with pytest.raises(ValueError,match='time zone'):portable.validate_snapshot(data,[])
    data['journal_settings']=[dict(key='workspace_preferences',value=json.dumps({**workspace.DEFAULT_PREFS,'fxRate':-1}),revision=1)]
    with pytest.raises(ValueError):portable.validate_snapshot(data,[])


def test_restore_rejects_unsafe_resources_and_duplicate_primary_keys():
    row=dict(id=1,kind='resource',title='unsafe',body=json.dumps(dict(url='javascript:alert(1)')),revision=1)
    with pytest.raises(ValueError,match='Links'):portable.validate_snapshot(snapshot(workspace_items=[row]),[])
    row['body']=json.dumps(dict(url='https://example.com'))
    with pytest.raises(ValueError,match='Duplicate'):portable.validate_snapshot(snapshot(workspace_items=[row,dict(row)]),[])


def test_restore_rejects_invalid_json_shapes_and_missing_images():
    row=dict(id=1,date='2026-11-05',symbol='SPY',direction='Long',images='{}')
    with pytest.raises(ValueError,match='images'):portable.validate_snapshot(snapshot(trades=[row]),[])
    row['images']='["images/missing.png"]'
    with pytest.raises(ValueError,match='missing a referenced'):portable.validate_snapshot(snapshot(trades=[row]),[])
    with pytest.raises(ValueError,match='Non-finite'):portable.strict_json('{"value":NaN}')


def test_restore_checks_daily_logs_and_routine_progress():
    with pytest.raises(ValueError):portable.validate_snapshot(snapshot(day_logs=[dict(date='2026-02-30')]),[])
    with pytest.raises(ValueError):portable.validate_snapshot(snapshot(routine_progress=[dict(period='2026-11-05',checked='{}')]),[])
