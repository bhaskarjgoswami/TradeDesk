"""Reclaim only unreferenced files older than seven days, under write locks."""
import json
import httpx
from fastapi import HTTPException
from ..database import get_conn
from ..storage_budget import storage_budget
from ..config import SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY
from .pgcompat import db
from .portable import TABLES,IMAGE


def reclaim(uid):
    with storage_budget(uid,0) as usage:
        with db() as journal:
            journal.execute('BEGIN IMMEDIATE')
            # Also block legacy journal paths without explicit advisory locks.
            journal._query('LOCK TABLE '+','.join(TABLES)+' IN SHARE ROW EXCLUSIVE MODE')
            referenced=set()
            for table in TABLES:
                text=json.dumps([dict(row) for row in journal.execute('SELECT * FROM '+table)],default=str)
                referenced.update(match.group(2) for match in IMAGE.finditer(text))
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute('SELECT row_to_json(t) AS data FROM public.trades t WHERE user_id=%s',(uid,))
                    legacy=json.dumps(cur.fetchall(),default=str)
                    referenced.update(match.group(2) for match in IMAGE.finditer(legacy))
                    names=[]
                    after=None
                    while len(names)<100:
                        query="SELECT name,created_at FROM storage.objects WHERE bucket_id='trade-images' AND name LIKE %s AND created_at<now()-interval '7 days'"
                        params=[uid+'/%']
                        if after:
                            query+=' AND (created_at,name)>(%s,%s)'
                            params.extend(after)
                        cur.execute(query+' ORDER BY created_at,name LIMIT 1000',params)
                        page=cur.fetchall()
                        names.extend(row['name'] for row in page if row['name'].split('/')[-1] not in referenced and row['name'] not in legacy)
                        names=names[:100]
                        if len(page)<1000:break
                        after=(page[-1]['created_at'],page[-1]['name'])
                    if names:
                        response=httpx.request('DELETE',f'{SUPABASE_URL}/storage/v1/object/trade-images',json=dict(prefixes=names),headers={'Authorization':'Bearer '+SUPABASE_SERVICE_ROLE_KEY,'apikey':SUPABASE_SERVICE_ROLE_KEY},timeout=30)
                        if response.status_code!=200:raise HTTPException(502,'Could not reclaim image storage. Please retry.')
            return dict(removed=len(names),maximum_per_request=100)
