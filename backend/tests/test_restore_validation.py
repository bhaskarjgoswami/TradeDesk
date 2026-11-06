import json
import base64
import io
import zipfile
import struct
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


@pytest.mark.parametrize('manifest',[[],None,42,'invalid',{'product':'TradeDesk','version':True,'images':[]}])
def test_malformed_manifest_is_rejected_before_storage_or_database(manifest,monkeypatch):
    archive=io.BytesIO()
    with zipfile.ZipFile(archive,'w') as output:
        output.writestr('manifest.json',json.dumps(manifest))
        output.writestr('journal.json',json.dumps(snapshot()))
    def connect():pytest.fail('Malformed backups must never open the database')
    def budget(*args):pytest.fail('Malformed backups must never inspect storage')
    monkeypatch.setattr('app.storage_budget.storage_budget',budget)
    with pytest.raises(ValueError):portable.restore(connect,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',base64.b64encode(archive.getvalue()).decode())


@pytest.mark.parametrize('kind',['encrypted','unsupported_compression'])
def test_restore_rejects_unsupported_archives_before_storage(kind,monkeypatch):
    archive=io.BytesIO()
    with zipfile.ZipFile(archive,'w') as output:
        output.writestr('manifest.json',json.dumps(dict(product='TradeDesk',version=1,images=[])))
        output.writestr('journal.json',json.dumps(snapshot()))
    raw=bytearray(archive.getvalue());central=raw.index(b'PK\x01\x02')
    if kind=='encrypted':
        struct.pack_into('<H',raw,6,1)
        struct.pack_into('<H',raw,central+8,1)
    else:
        struct.pack_into('<H',raw,8,99)
        struct.pack_into('<H',raw,central+10,99)
    def forbidden(*args):pytest.fail('Invalid archives must not access storage or database')
    monkeypatch.setattr('app.storage_budget.storage_budget',forbidden)
    with pytest.raises(ValueError):portable.restore(forbidden,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',base64.b64encode(raw).decode())
