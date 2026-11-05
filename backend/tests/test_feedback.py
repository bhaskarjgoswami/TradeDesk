import contextlib
import sqlite3
import pytest
from app.journal import workspace

@pytest.fixture
def store(tmp_path):
    path=tmp_path/'feedback.sqlite'
    @contextlib.contextmanager
    def connect():
        conn=sqlite3.connect(path);conn.row_factory=sqlite3.Row
        try:
            with conn:yield conn
        finally:conn.close()
    with connect() as conn:conn.execute('CREATE TABLE trades(id INTEGER PRIMARY KEY)')
    workspace.init(connect)
    return connect

def payload(**body):
    return dict(kind='feedback',title='suggestion',clientId='feedback-retry-1',body=dict(category='suggestion',message='Please improve chart zoom',images=['images/chart.png'],**body))

def test_feedback_round_trip_and_retry_does_not_duplicate(store):
    data=payload()
    saved,status=workspace.handle(store,'POST','/api/workspace/items',{},data)
    assert status==201
    retry,status=workspace.handle(store,'POST','/api/workspace/items',{},data)
    assert status==200 and retry['id']==saved['id']
    rows,_=workspace.handle(store,'GET','/api/workspace/items',{'kind':['feedback']})
    assert len(rows)==1 and rows[0]['body']==data['body']

@pytest.mark.parametrize('field,value',[('message',' '),('message','x'*4001),('category','admin'),('images',['../private.png']),('images',['images/a.png']*4),('images','images/a.png')])
def test_invalid_feedback_rejected_without_writes(store,field,value):
    data=payload();data['body'][field]=value
    with pytest.raises(ValueError):workspace.handle(store,'POST','/api/workspace/items',{},data)
    rows,_=workspace.handle(store,'GET','/api/workspace/items',{'kind':['feedback']})
    assert rows==[]
