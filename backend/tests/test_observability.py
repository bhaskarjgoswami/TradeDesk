import json
from app.observability import scrub_event
from fastapi.testclient import TestClient
from app.main import app


def test_error_scrubber_drops_values_headers_tokens_bodies_and_locals():
    event=dict(event_id='safe',request={'headers':{'Authorization':'Bearer secret'},'data':{'password':'secret'}},user={'email':'private'},extra={'token':'secret'},breadcrumbs=['secret'],exception={'values':[{'type':'ValueError','value':'sensitive DB query','stacktrace':{'frames':[{'filename':'/private/account/file.py','function':'save','lineno':12,'vars':{'secret':'value'}}]}}]})
    safe=scrub_event(event,{})
    assert safe['event_id']=='safe'
    encoded=json.dumps(safe)
    for value in ('Bearer','password','sensitive','private','secret','vars'):assert value not in encoded
    assert safe['exception']['values'][0]['stacktrace']['frames'][0]['filename']=='file.py'


def test_request_references_are_generated_by_server_and_never_echo_input():
    response=TestClient(app).get('/health',headers={'X-Request-ID':'untrusted'})
    assert response.status_code==200
    reference=response.headers['X-Request-ID']
    assert len(reference)==32 and reference!='untrusted'
