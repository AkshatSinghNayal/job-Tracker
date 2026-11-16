"""Single-owner auth: admin bootstrap, JWT issue/verify, refresh rotation & revocation."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.security import TokenError, create_token, decode_token, hash_password, verify_password
from app.services.rate_limit import rate_limiter

log = get_logger(__name__)
REFRESH_COLLECTION = "refresh_tokens"
USERS_COLLECTION = "users"


async def ensure_admin(db: AsyncIOMotorDatabase) -> None:
    settings = get_settings()
    existing = await db[USERS_COLLECTION].find_one({"username": settings.admin_username})
    if existing is None:
        await db[USERS_COLLECTION].insert_one(
            {
                "username": settings.admin_username,
                "password_hash": hash_password(settings.admin_password),
                "created_at": datetime.now(UTC),
            }
        )
        log.info("admin user created", extra={"ctx": {"username": settings.admin_username}})
    elif not verify_password(settings.admin_password, existing["password_hash"]):
        # keep the admin password in sync with .env across restarts
        await db[USERS_COLLECTION].update_one(
            {"_id": existing["_id"]},
            {"$set": {"password_hash": hash_password(settings.admin_password)}},
        )
        log.info("admin password updated from env")


async def register_user(db: AsyncIOMotorDatabase, username: str, password: str) -> None:
    from fastapi import HTTPException
    existing = await db[USERS_COLLECTION].find_one({"username": username})
    if existing is not None:
        raise HTTPException(400, "Username already registered")
    await db[USERS_COLLECTION].insert_one(
        {
            "username": username,
            "password_hash": hash_password(password),
            "created_at": datetime.now(UTC),
        }
    )
    log.info("user registered", extra={"ctx": {"username": username}})


async def change_password(db: AsyncIOMotorDatabase, username: str, current_pw: str, new_pw: str) -> bool:
    user = await db[USERS_COLLECTION].find_one({"username": username})
    if not user or not verify_password(current_pw, user["password_hash"]):
        return False
    await db[USERS_COLLECTION].update_one(
        {"username": username},
        {"$set": {"password_hash": hash_password(new_pw)}},
    )
    return True


async def authenticate(db: AsyncIOMotorDatabase, username: str, password: str, ip: str) -> bool:
    if rate_limiter.is_locked(ip, username):
        return False
    user = await db[USERS_COLLECTION].find_one({"username": username})
    ok = bool(user) and verify_password(password, user["password_hash"])
    if ok:
        rate_limiter.reset(ip, username)
    else:
        rate_limiter.record_failure(ip, username)
    return ok


async def issue_pair(db: AsyncIOMotorDatabase, username: str) -> tuple[str, str, str]:
    """Return (access_token, refresh_token, refresh_jti)."""
    access, _, _ = create_token(username, "access")
    refresh, jti, expires_at = create_token(username, "refresh")
    await db[REFRESH_COLLECTION].insert_one(
        {
            "jti": jti,
            "sub": username,
            "expires_at": expires_at,
            "revoked": False,
            "created_at": datetime.now(UTC),
        }
    )
    return access, refresh, jti


async def rotate_refresh(db: AsyncIOMotorDatabase, refresh_token: str) -> tuple[str, str]:
    """Validate + revoke the old refresh token; return (access, new_refresh)."""
    try:
        payload = decode_token(refresh_token, "refresh")
    except TokenError as exc:
        raise TokenError(str(exc)) from exc
    record = await db[REFRESH_COLLECTION].find_one({"jti": payload["jti"]})
    if not record or record.get("revoked"):
        raise TokenError("Refresh token revoked")
    await db[REFRESH_COLLECTION].update_one(
        {"jti": payload["jti"]}, {"$set": {"revoked": True}}
    )
    access, _, _ = create_token(payload["sub"], "access")
    new_refresh, new_jti, expires_at = create_token(payload["sub"], "refresh")
    await db[REFRESH_COLLECTION].insert_one(
        {
            "jti": new_jti,
            "sub": payload["sub"],
            "expires_at": expires_at,
            "revoked": False,
            "created_at": datetime.now(UTC),
        }
    )
    return access, new_refresh


async def revoke_refresh(db: AsyncIOMotorDatabase, refresh_token: str) -> None:
    try:
        payload = decode_token(refresh_token, "refresh")
    except TokenError:
        return  # already invalid: nothing to revoke
    await db[REFRESH_COLLECTION].update_one(
        {"jti": payload["jti"]}, {"$set": {"revoked": True}}
    )


async def verify_access(token: str) -> dict[str, Any]:
    return decode_token(token, "access")


async def cleanup_expired_tokens(db: AsyncIOMotorDatabase) -> None:
    await db[REFRESH_COLLECTION].delete_many(
        {"expires_at": {"$lt": datetime.now(UTC)}}
    )
