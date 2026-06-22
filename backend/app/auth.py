from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from .config import SUPABASE_JWT_SECRET

bearer = HTTPBearer()


def get_current_user(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    token = creds.credentials
    try:
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_aud": False},
        )
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
