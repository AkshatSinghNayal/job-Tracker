"""Auth flow tests: login, failure, expiry, wrong type, rotation, revocation."""
from __future__ import annotations

import time

import jwt as pyjwt


async def test_login_success_sets_refresh_cookie(client):
    res = await client.post(
        "/api/auth/login", json={"username": "admin", "password": "test-password-123"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["token_type"] == "bearer" and body["access_token"]
    set_cookie = res.headers.get("set-cookie", "")
    assert "jt_refresh=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "samesite=strict" in set_cookie.lower()


async def test_login_failure_generic(client):
    res = await client.post(
        "/api/auth/login", json={"username": "admin", "password": "wrong"}
    )
    assert res.status_code == 401
    assert res.json()["detail"] == "Invalid credentials"


async def test_me_requires_token(client):
    res = await client.get("/api/auth/me")
    assert res.status_code == 401


async def test_expired_token_rejected(client, auth_headers):
    from app.core.config import get_settings

    settings = get_settings()
    expired = pyjwt.encode(
        {"sub": "admin", "exp": int(time.time()) - 3600, "iat": int(time.time()) - 7200,
         "jti": "x", "type": "access"},
        settings.app_secret_key, algorithm=settings.jwt_algorithm,
    )
    res = await client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {expired}"}
    )
    assert res.status_code == 401


async def test_wrong_token_type_rejected(client):
    # Use a refresh token where an access token is required.
    login = await client.post(
        "/api/auth/login", json={"username": "admin", "password": "test-password-123"}
    )
    cookies = login.cookies  # noqa: F841 — jar managed by client
    from app.core.security import create_token

    refresh_token, _, _ = create_token("admin", "refresh")
    res = await client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {refresh_token}"}
    )
    assert res.status_code == 401
    assert "type" in res.json()["detail"].lower()


async def test_refresh_rotation_revokes_old(admin_client):
    res = await admin_client.post("/api/auth/refresh")
    assert res.status_code == 200
    new_cookie = res.cookies.get("jt_refresh")
    assert new_cookie
    # Old cookie (pre-rotation) must now be rejected.
    res2 = await admin_client.post("/api/auth/refresh")
    # admin_client still holds the rotated cookie; second rotation works…
    assert res2.status_code == 200
    # …but replaying the first rotated value must fail (single-use).
    res3 = await admin_client.post(
        "/api/auth/refresh", cookies={"jt_refresh": new_cookie}
    )
    assert res3.status_code == 401


async def test_logout_revokes_refresh(admin_client):
    res = await admin_client.post("/api/auth/logout")
    assert res.status_code == 200
    res2 = await admin_client.post("/api/auth/refresh")
    assert res2.status_code == 401


async def test_lockout_after_failures(client):
    for _ in range(5):
        await client.post(
            "/api/auth/login", json={"username": "lockme", "password": "bad"}
        )
    res = await client.post(
        "/api/auth/login", json={"username": "lockme", "password": "bad"}
    )
    assert res.status_code == 429


async def test_register_flow(client):
    res = await client.post(
        "/api/auth/register", json={"username": "alice", "password": "password123"}
    )
    assert res.status_code == 201
    assert "access_token" in res.json()
    assert "jt_refresh" in res.headers.get("set-cookie", "")

    # Duplicate username rejected
    res2 = await client.post(
        "/api/auth/register", json={"username": "alice", "password": "password123"}
    )
    assert res2.status_code == 400
