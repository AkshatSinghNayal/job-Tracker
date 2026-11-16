"""Authentication endpoints. Generic errors; access token in body, refresh in cookie."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response

from app.core.config import get_settings
from app.db.mongo import get_app_db
from app.routers.deps import CurrentUser, client_ip
from app.schemas.auth import ChangePasswordRequest, LoginRequest, RegisterRequest, TokenResponse, UserOut
from app.services import auth_service
from app.services.audit_service import audit
from app.services.rate_limit import rate_limiter

router = APIRouter(prefix="/api/auth", tags=["auth"])
REFRESH_COOKIE = "jt_refresh"


def _set_refresh_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        REFRESH_COOKIE,
        token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/api/auth",
        max_age=settings.refresh_token_expire_days * 86400,
    )


def _clear_refresh_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        REFRESH_COOKIE, path="/api/auth", secure=settings.cookie_secure, samesite="strict"
    )


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(body: RegisterRequest, request: Request, response: Response) -> TokenResponse:
    db = get_app_db()
    ip = client_ip(request)
    await auth_service.register_user(db, body.username, body.password)
    access, refresh, _ = await auth_service.issue_pair(db, body.username)
    _set_refresh_cookie(response, refresh)
    await audit(db, "register", ip=ip, username=body.username)
    return TokenResponse(
        access_token=access, expires_in=get_settings().access_token_expire_minutes * 60
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request, response: Response) -> TokenResponse:
    db = get_app_db()
    ip = client_ip(request)
    if rate_limiter.is_locked(ip, body.username):
        raise HTTPException(429, "Too many attempts. Try again later.")
    ok = await auth_service.authenticate(db, body.username, body.password, ip)
    if not ok:
        raise HTTPException(401, "Invalid credentials")
    access, refresh, _ = await auth_service.issue_pair(db, body.username)
    _set_refresh_cookie(response, refresh)
    await audit(db, "login", ip=ip, username=body.username)
    return TokenResponse(
        access_token=access, expires_in=get_settings().access_token_expire_minutes * 60
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: Request, response: Response) -> TokenResponse:
    db = get_app_db()
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise HTTPException(401, "Missing refresh token")
    try:
        access, new_refresh = await auth_service.rotate_refresh(db, token)
    except auth_service.TokenError as exc:
        _clear_refresh_cookie(response)
        raise HTTPException(401, str(exc)) from exc
    _set_refresh_cookie(response, new_refresh)
    return TokenResponse(
        access_token=access, expires_in=get_settings().access_token_expire_minutes * 60
    )


@router.post("/logout")
async def logout(request: Request, response: Response) -> dict:
    db = get_app_db()
    token = request.cookies.get(REFRESH_COOKIE)
    if token:
        await auth_service.revoke_refresh(db, token)
    _clear_refresh_cookie(response)
    await audit(db, "logout", ip=client_ip(request))
    return {"ok": True}


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> UserOut:
    return UserOut(username=user)


@router.post("/change-password")
async def change_pw(body: ChangePasswordRequest, user: CurrentUser, request: Request) -> dict:
    db = get_app_db()
    ok = await auth_service.change_password(db, user, body.current_password, body.new_password)
    if not ok:
        raise HTTPException(400, "Current password incorrect")
    await audit(db, "password.change", ip=client_ip(request), username=user)
    return {"ok": True, "message": "Password updated successfully"}


@router.get("/system-info")
async def get_system_info(user: CurrentUser) -> dict:
    import os
    import time
    settings = get_settings()
    is_vercel = bool(os.environ.get("VERCEL") or os.environ.get("VERCEL_ENV"))
    db_ok = False
    latency_ms = 0.0
    try:
        t0 = time.monotonic()
        await get_app_db().command("ping")
        latency_ms = round((time.monotonic() - t0) * 1000, 1)
        db_ok = True
    except Exception:
        pass

    deployment_label = (
        "Vercel Serverless"
        if is_vercel
        else ("Production (Container)" if settings.cookie_secure else "Localhost Development")
    )

    return {
        "deployment": deployment_label,
        "is_vercel": is_vercel,
        "database": {
            "name": settings.app_db_name,
            "connected": db_ok,
            "latency_ms": latency_ms,
            "source": "Vercel Environment Variables" if is_vercel else "Central Cluster (APP_DB_URI)",
        },
        "storage": {
            "engine": "MongoDB GridFS",
            "max_upload_mb": settings.max_upload_mb,
        },
        "security": {
            "session_mode": "Multi-User Isolated (JWT + HttpOnly Cookie)",
            "encryption": "Fernet (AES-128-CBC + HMAC-SHA256)",
            "cookie_secure": settings.cookie_secure,
        },
        "privacy": {
            "isolation": "Active (scoped to user_id)",
            "data_policy": (
                "Each account has an isolated workspace. Applications and resumes are strictly private."
            ),
        },
    }
