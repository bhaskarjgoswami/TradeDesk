"""Measure journal reads/writes against disposable localhost PostgreSQL only.

This is a local application baseline, not a production capacity guarantee.
Run with TEST_DATABASE_URL pointing to localhost/tradedesk_test.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import statistics
import sys
import time
from urllib.parse import urlparse
import uuid


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--trades',type=int,default=10000)
    parser.add_argument('--requests',type=int,default=100)
    parser.add_argument('--concurrency',type=int,default=8)
    args=parser.parse_args()
    dsn=os.environ.get('TEST_DATABASE_URL','')
    target=urlparse(dsn)
    if target.hostname not in ('localhost','127.0.0.1') or target.path!='/tradedesk_test':
        parser.error('Use a disposable localhost/tradedesk_test database')
    if not 1<=args.trades<=100000 or not 1<=args.requests<=10000 or not 1<=args.concurrency<=16:
        parser.error('Use 1–100000 trades, 1–10000 requests and 1–16 workers')
    # Override before importing the application; no production provider is used.
    os.environ.update(DATABASE_URL=dsn,SUPABASE_URL='https://example.supabase.co',
        SUPABASE_ANON_KEY='test',SUPABASE_SERVICE_ROLE_KEY='test',
        SUPABASE_JWT_SECRET='local-benchmark-secret-at-least-32-characters',
        RAZORPAY_KEY_ID='',RAZORPAY_KEY_SECRET='',RAZORPAY_WEBHOOK_SECRET='',SENTRY_DSN='')
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
    from fastapi.testclient import TestClient
    from app.main import app
    from app.auth import get_current_user
    from app.database import get_conn
    from app.journal import pgcompat,router
    uid=str(uuid.uuid4());schema=pgcompat.schema_for(uid)
    user={'user_id':uid,'email':'benchmark@example.invalid'}
    app.dependency_overrides[get_current_user]=lambda:user
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO public.user_profiles(id,subscription_tier) VALUES (%s,'pro')",(uid,))
    try:
        with router.scoped(user):
            with pgcompat.db() as conn:
                conn._query("INSERT INTO trades(date,symbol,direction,pnl,created_at) SELECT '2026-11-06','TEST','Long',1,now()::text FROM generate_series(1,%s)",(args.trades,))
        def request(index):
            started=time.perf_counter()
            with TestClient(app) as client:
                if index%5==0:
                    response=client.post('/j/api/trades',json={'date':'2026-11-06','symbol':'TEST','direction':'Long','pnl':1,'clientId':uuid.uuid4().hex})
                else:response=client.get('/j/api/trades/page?limit=500')
            return (time.perf_counter()-started)*1000,response.status_code
        started=time.perf_counter()
        with ThreadPoolExecutor(max_workers=args.concurrency) as workers:
            results=list(workers.map(request,range(args.requests)))
        elapsed=time.perf_counter()-started
        timings=sorted(duration for duration,status in results)
        errors=sum(status not in (200,201) for duration,status in results)
        print(json.dumps(dict(environment='disposable_local_postgresql',seed_trades=args.trades,
            requests=args.requests,concurrency=args.concurrency,read_page_rows=500,
            write_fraction=0.2,errors=errors,p50_ms=round(statistics.median(timings),2),
            p95_ms=round(timings[max(0,__import__('math').ceil(len(timings)*0.95)-1)],2),
            requests_per_second=round(len(results)/elapsed,2),
            production_capacity_verified=False),indent=2))
        if errors:raise SystemExit(1)
    finally:
        app.dependency_overrides.pop(get_current_user,None)
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
                cur.execute('DELETE FROM public.user_profiles WHERE id=%s',(uid,))
        pgcompat.forget_schema(schema)


if __name__=='__main__':main()
