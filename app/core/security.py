"""Password hashing, JWT minting/verification, and Fernet URI encryption."""
from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings

TokenType = Literal["access", "refresh"]

_hasher = PasswordHasher()

# mongodb://user:pass@host  ->  mongodb://user:***@host
_URI_CREDS_RE = re.compile(r"^(mongodb(?:\+srv)?:\/\/[^:\/]+):([^@\/]+)@")


class TokenError(Exception):
    """Raised when a token is invalid, expired, or of the wrong type."""


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, password)
    except VerifyMismatchError:
        return False
    except Exception:  # malformed hash: never authenticate on it
        return False


def create_token(sub: str, token_type: TokenType) -> tuple[str, str, datetime]:
    """Return (token, jti, expires_at)."""
    settings = get_settings()
    if token_type == "access":
        delta = timedelta(minutes=settings.access_token_expire_minutes)
    else:
        delta = timedelta(days=settings.refresh_token_expire_days)
    now = datetime.now(UTC)
    expires_at = now + delta
    jti = uuid.uuid4().hex
    payload: dict[str, Any] = {
        "sub": sub,
        "exp": int(expires_at.timestamp()),
        "iat": int(now.timestamp()),
        "jti": jti,
        "type": token_type,
    }
    token = jwt.encode(payload, settings.app_secret_key, algorithm=settings.jwt_algorithm)
    return token, jti, expires_at


def decode_token(token: str, expected_type: TokenType) -> dict[str, Any]:
    """Decode and enforce token type. Raises TokenError on any problem."""
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.app_secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("Token expired") from exc
    except jwt.PyJWTError as exc:
        raise TokenError("Invalid token") from exc
    if payload.get("type") != expected_type:
        raise TokenError("Invalid token type")
    if not payload.get("sub") or not payload.get("jti"):
        raise TokenError("Invalid token")
    return payload


def get_cipher() -> Fernet:
    return Fernet(get_settings().fernet_key.encode())


def encrypt_secret(plain: str) -> str:
    return get_cipher().encrypt(plain.encode()).decode()


def decrypt_secret(encrypted: str) -> str:
    try:
        return get_cipher().decrypt(encrypted.encode()).decode()
    except InvalidToken as exc:
        raise ValueError("Unable to decrypt stored secret (wrong FERNET_KEY?)") from exc


def mask_uri(uri: str) -> str:
    """Mask credentials in a MongoDB URI for safe display."""
    return _URI_CREDS_RE.sub(r"\1:***@", uri)


def mask_uri_in_text(text: str) -> str:
    """Scrub any embedded mongo URI credentials from arbitrary text."""
    return _URI_CREDS_RE.sub(r"\1:***@", text)
