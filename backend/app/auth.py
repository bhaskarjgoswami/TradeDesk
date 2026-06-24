import json
import urllib.request

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError

from .config import SUPABASE_JWT_SECRET, SUPABASE_URL, SUPABASE_ANON_KEY

bearer = HTTPBearer()

_JWKS_URL = SUPABASE_URL.rstrip("/") + "/auth/v1/.well-known/jwks.json"
_jwks_cache: dict[str, dict] = {}  # kid -> JWK


def _fetch_jwks() -> dict[str, dict]:
    """Fetch (and cache) Supabase's public signing keys, keyed by kid."""
    req = urllib.request.Request(_JWKS_URL, headers={"apikey": SUPABASE_ANON_KEY})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.load(resp)
    keys = {k["kid"]: k for k in data.get("keys", []) if "kid" in k}
    _jwks_cache.clear()
    _jwks_cache.update(keys)
    return _jwks_cache


def _decode_token(token: str) -> dict:
    """Verify a Supabase access token.

    New projects sign with asymmetric keys (ES256/RS256) exposed via JWKS;
    older ones use the legacy HS256 shared secret. Support both.
    """
    header = jwt.get_unverified_header(token)
    alg = header.get("alg", "")
    kid = header.get("kid")

    if alg.startswith(("ES", "RS", "PS")):  # asymmetric -> verify via JWKS
        jwk = _jwks_cache.get(kid) or _fetch_jwks().get(kid)
        if jwk is None:
            raise JWTError(f"no JWKS key for kid {kid}")
        return jwt.decode(token, jwk, algorithms=[alg], options={"verify_aud": False})

    # legacy symmetric secret
    return jwt.decode(
        token, SUPABASE_JWT_SECRET, algorithms=["HS256"], options={"verify_aud": False}
    )


def get_current_user(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    token = creds.credentials
    try:
        payload = _decode_token(token)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    uid = payload.get("sub")
    if not uid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return {"user_id": uid, "email": payload.get("email", "")}


def get_pro_user(user: dict = Depends(get_current_user)) -> dict:
    """Dependency that checks the user has an active Pro subscription."""
    from .database import get_conn
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT subscription_tier FROM user_profiles WHERE id = %s",
                (user["user_id"],),
            )
            row = cur.fetchone()
    tier = (row["subscription_tier"] if row else "free") or "free"
    if tier != "pro":
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Pro subscription required",
        )
    return user
