import time
import jwt
import pytest
from app import auth

@pytest.fixture
def claims():
    now=int(time.time())
    return {"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","iss":auth._ISSUER,"aud":"authenticated","role":"authenticated","iat":now,"exp":now+3600}

@pytest.mark.parametrize("patch,omit", [({"iss":"https://wrong.example"},None),({"aud":"anon"},None),({},"exp"),({"role":"service_role"},None),({"exp":1},None),({"sub":"not-a-uuid"},None)])
def test_invalid_access_claims_rejected(claims,patch,omit):
    claims.update(patch)
    if omit: claims.pop(omit)
    token=jwt.encode(claims,auth.SUPABASE_JWT_SECRET,algorithm="HS256")
    with pytest.raises(jwt.InvalidTokenError): auth._decode_token(token)

def test_valid_access_claims_allowed(claims):
    token=jwt.encode(claims,auth.SUPABASE_JWT_SECRET,algorithm="HS256")
    assert auth._decode_token(token)["sub"]==claims["sub"]
