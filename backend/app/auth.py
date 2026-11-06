import json
import urllib.request
import time
import threading
import re

from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from jwt import InvalidTokenError as JWTError

from .database import get_conn
from .config import SUPABASE_JWT_SECRET, SUPABASE_URL, SUPABASE_ANON_KEY

bearer = HTTPBearer()

_JWKS_URL = SUPABASE_URL.rstrip("/") + "/auth/v1/.well-known/jwks.json"
_jwks_cache: dict[str, dict] = {}  # kid -> JWK
_jwks_loaded_at = 0.0
_jwks_attempt_at = 0.0
_jwks_lock = threading.Lock()
_ISSUER = SUPABASE_URL.rstrip("/") + "/auth/v1"


def _fetch_jwks() -> dict[str, dict]:
    global _jwks_loaded_at, _jwks_attempt_at
    with _jwks_lock:
        now = time.monotonic()
        if now - _jwks_attempt_at < 30:
            return _jwks_cache
        _jwks_attempt_at = now
        req = urllib.request.Request(_JWKS_URL, headers={"apikey": SUPABASE_ANON_KEY})
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.load(resp)
        except Exception:
            raise HTTPException(503, "Authentication temporarily unavailable")
        _jwks_cache.clear()
        _jwks_cache.update({k["kid"]: k for k in data.get("keys", []) if "kid" in k})
        _jwks_loaded_at = now
        return _jwks_cache


def _decode_token(token: str) -> dict:
    if not isinstance(token, str) or len(token) > 16384:
        raise JWTError("Invalid token")
    header = jwt.get_unverified_header(token)
    alg, kid = header.get("alg"), header.get("kid")
    if alg in ("ES256", "RS256"):
        if not isinstance(kid, str) or not 1 <= len(kid) <= 128:
            raise JWTError("Invalid key id")
        keys = _jwks_cache
        if time.monotonic() - _jwks_loaded_at > 300 or kid not in keys:
            keys = _fetch_jwks()
        jwk = keys.get(kid)
        if not jwk or jwk.get("alg", alg) != alg:
            raise JWTError("Unknown signing key")
        key = jwt.PyJWK.from_dict(jwk, algorithm=alg).key
    elif alg == "HS256" and SUPABASE_JWT_SECRET:
        key = SUPABASE_JWT_SECRET
    else:
        raise JWTError("Unsupported signing algorithm")
    payload = jwt.decode(token, key, algorithms=[alg], issuer=_ISSUER,
                         audience="authenticated", options={"require": ["exp", "iat", "sub", "iss", "aud"]}, leeway=30)
    if payload.get("role") != "authenticated" or not re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", payload["sub"]):
        raise JWTError("Invalid access token identity")
    return payload


def get_current_user(creds: HTTPAuthorizationCredentials = Depends(bearer), request: Request = None) -> dict:
    token = creds.credentials
    try:
        payload = _decode_token(token)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    uid = payload.get("sub")
    if not uid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    # JWT signatures remain valid until expiry after an Auth user is deleted.
    # The signup trigger creates this profile; its deletion revokes API access.
    try:
        with get_conn(readonly=True) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT deletion_started_at FROM public.user_profiles WHERE id=%s", (uid,))
                exists = cur.fetchone()
    except Exception:
        raise HTTPException(status_code=503, detail="Account verification temporarily unavailable")
    if not exists:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is no longer available")
    if exists.get('deletion_started_at') and not (request is not None and request.method=='DELETE' and request.url.path=='/api/account'):
        raise HTTPException(423, 'Account deletion is pending. Retry deletion to finish removing your account.')
    return {"user_id": uid, "email": payload.get("email", "")}


def media_token(uid: str) -> str:
    import hmac, hashlib
    key = hmac.new(SUPABASE_JWT_SECRET.encode(), b"tradedesk-media-v1", hashlib.sha256).digest()
    now = int(time.time())
    return jwt.encode({"sub":uid,"iss":_ISSUER,"aud":"tradedesk-media","iat":now,"exp":now+300,"scope":"images"}, key, algorithm="HS256")


def decode_media_token(token: str) -> str:
    import hmac, hashlib
    key = hmac.new(SUPABASE_JWT_SECRET.encode(), b"tradedesk-media-v1", hashlib.sha256).digest()
    payload = jwt.decode(token, key, algorithms=["HS256"], issuer=_ISSUER, audience="tradedesk-media", options={"require":["exp","iat","sub","scope"]})
    if payload.get("scope") != "images": raise JWTError("Invalid media scope")
    return payload["sub"]
