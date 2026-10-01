from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt


def create_session_token(
    secret_key: str,
    session_id: str,
    role: str,
    ttl_seconds: int,
) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "session_id": session_id,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl_seconds)).timestamp()),
    }
    return jwt.encode(payload, secret_key, algorithm="HS256")


def decode_session_token(secret_key: str, token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, secret_key, algorithms=["HS256"])
    except JWTError:
        return None
