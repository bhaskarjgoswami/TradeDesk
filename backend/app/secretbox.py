"""
Encryption for third-party credentials (exchange API keys) stored in Postgres.

Values are Fernet tokens prefixed with "enc:v1:". Rows written before this
existed are plaintext; `decrypt` passes them through so they keep working and
get encrypted on the next save.
"""
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from .config import EXCHANGE_ENC_KEY

_PREFIX = "enc:v1:"
_fernet = Fernet(EXCHANGE_ENC_KEY.encode()) if EXCHANGE_ENC_KEY else None


def encrypt(value: str) -> str:
    if not value:
        return ""
    if _fernet is None:
        raise HTTPException(503, "Credential encryption is not configured on the server")
    return _PREFIX + _fernet.encrypt(value.encode()).decode()


def decrypt(value: str | None) -> str:
    if not value or not value.startswith(_PREFIX):
        return value or ""  # legacy plaintext
    if _fernet is None:
        raise HTTPException(503, "Credential encryption is not configured on the server")
    try:
        return _fernet.decrypt(value[len(_PREFIX):].encode()).decode()
    except InvalidToken:
        raise HTTPException(500, "Stored credentials could not be decrypted")
