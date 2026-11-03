"""
Per-user rate limits for expensive endpoints (uploads, exchange pulls,
payments, account actions). In-memory sliding window: fine for a single
Render instance; move to Redis if the API is ever scaled out.
"""
import threading
import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException
from .auth import get_current_user

_hits: dict[tuple, deque] = defaultdict(deque)
_lock = threading.Lock()


def limit(name: str, per_minute: int):
    def dep(user=Depends(get_current_user)):
        key, now = (name, user["user_id"]), time.monotonic()
        with _lock:
            q = _hits[key]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= per_minute:
                raise HTTPException(429, "Too many requests, slow down and retry in a minute")
            q.append(now)
        return user
    return dep
