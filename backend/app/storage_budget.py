"""Account-wide upload budget; a transaction lock serializes concurrent uploads."""
from contextlib import contextmanager
from fastapi import HTTPException
from .database import get_conn
from .billing import _tier

FREE_BYTES=100*1024*1024
PRO_BYTES=1024*1024*1024


def allowance(profile):return PRO_BYTES if _tier(profile)=='pro' else FREE_BYTES


@contextmanager
def storage_budget(uid,incoming):
    if type(incoming) is not int or incoming<0:raise ValueError('Invalid upload size')
    with get_conn() as conn:
        with conn.cursor() as cur:
            profile=lock_account_write(conn,uid)
            cur.execute("SELECT COALESCE(SUM(CASE WHEN (metadata->>'size') ~ '^[0-9]+$' THEN (metadata->>'size')::bigint ELSE 0 END),0) AS used FROM storage.objects WHERE bucket_id='trade-images' AND name LIKE %s",(uid+'/%',))
            used=int(cur.fetchone()['used'])
            maximum=allowance(profile)
            if incoming and used+incoming>maximum:raise HTTPException(413,'Image storage limit reached ('+str(maximum//1024//1024)+' MB). Export and remove unused images or contact support.')
        yield dict(used=used,limit=maximum)


def lock_account_write(conn,uid):
    """Recheck account state after waiting for deletion or storage cleanup."""
    with conn.cursor() as cur:
        cur.execute("SET LOCAL lock_timeout='10s'")
        cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))",('storage:'+uid,))
        cur.execute('SELECT subscription_tier,subscription_expires_at,deletion_started_at FROM public.user_profiles WHERE id=%s FOR SHARE',(uid,))
        profile=cur.fetchone()
        if not profile or profile.get('deletion_started_at'):
            raise HTTPException(423,'Account deletion is pending')
        return profile
