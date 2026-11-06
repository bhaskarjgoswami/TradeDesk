"""Minimal diagnostics: no bodies, tokens, user identifiers or exception values."""
import json
import logging
import time
import uuid
from pathlib import PurePath
from fastapi.responses import JSONResponse

log=logging.getLogger('tradedesk.requests')


def scrub_event(event,hint):
    safe={key:event[key] for key in ('event_id','timestamp','level','platform','release','environment','sdk') if key in event}
    values=[]
    for error in event.get('exception',{}).get('values',[]):
        frames=[]
        for frame in error.get('stacktrace',{}).get('frames',[]):
            clean={key:frame[key] for key in ('module','function','lineno','in_app') if key in frame}
            if frame.get('filename'):clean['filename']=PurePath(frame['filename']).name
            frames.append(clean)
        values.append(dict(type=error.get('type','Error'),value='Error details omitted for privacy',stacktrace=dict(frames=frames)))
    if values:safe['exception']=dict(values=values)
    return safe


async def request_diagnostics(request,call_next):
    request_id=uuid.uuid4().hex
    started=time.monotonic()
    failure=None
    try:response=await call_next(request)
    except Exception as error:
        failure=type(error).__name__
        # Let configured Sentry collect the traceback through the scrubber.
        import os
        if os.environ.get('SENTRY_DSN'):
            import sentry_sdk
            sentry_sdk.capture_exception(error)
        response=JSONResponse(status_code=500,content=dict(detail='Something went wrong. Please retry.',request_id=request_id))
    response.headers['X-Request-ID']=request_id
    route=getattr(request.scope.get('route'),'path','unmatched')
    record=dict(event='http_request',request_id=request_id,method=request.method,route=route,status=response.status_code,duration_ms=round((time.monotonic()-started)*1000))
    if failure:record['error_type']=failure
    message=json.dumps(record,separators=(',',':'))
    if response.status_code>=500:log.error(message)
    else:log.info(message)
    return response
