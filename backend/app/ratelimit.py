"""Atomic, shared per-account limits across restarts and backend workers."""
import time
import threading
from fastapi import Depends,HTTPException
from .auth import get_current_user
from .database import get_conn

_cleanup_at = 0
_cleanup_lock = threading.Lock()


def record_hit(uid,action,maximum):
    global _cleanup_at
    window = int(time.time()) // 60
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("INSERT INTO public.api_rate_buckets(user_id,action,bucket,hits) VALUES (%s,%s,%s,1) "
                            "ON CONFLICT(user_id,action,bucket) DO UPDATE SET hits=LEAST(public.api_rate_buckets.hits+1,%s) RETURNING hits",(uid,action,window,maximum+1))
                row = cur.fetchone()
                hits = row["hits"] if isinstance(row,dict) else row[0]
                if window > _cleanup_at:
                    with _cleanup_lock:
                        if window > _cleanup_at:
                            cur.execute("DELETE FROM public.api_rate_buckets WHERE bucket < %s",(window-2,))
                            _cleanup_at = window
        return hits
    except Exception:
        raise HTTPException(503,"Request protection temporarily unavailable. Please retry.")


def limit(name: str, per_minute: int):
    def dep(user=Depends(get_current_user)):
        if record_hit(user["user_id"],name,per_minute) > per_minute:
            raise HTTPException(429,"Too many requests. Please retry in a minute.",headers={"Retry-After":"60"})
        return user
    return dep
