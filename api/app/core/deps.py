"""Who is asking: the session cookie, the current user, and role guards."""
from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.modules.users.models import User

from .db import get_db, utcnow
from .errors import AppError
from .security import read_token

COOKIE = "session"


def optional_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    token = request.cookies.get(COOKIE) or (request.headers.get("authorization", "").removeprefix("Bearer ").strip() or None)
    data = read_token(token) if token else None
    if not data:
        return None
    user = db.get(User, data[0])
    if not user or not user.active or user.session_key != data[1]:
        return None
    now = utcnow()
    if not user.last_seen_at or (now - user.last_seen_at).total_seconds() > 300:
        user.last_seen_at = now
        db.commit()
    return user


def current_user(user: User | None = Depends(optional_user)) -> User:
    if not user:
        raise AppError("auth.required", 401)
    return user


def ready_user(user: User = Depends(current_user)) -> User:
    """Signed in and past the forced password change (R-ACC-1)."""
    if user.must_change_password:
        raise AppError("auth.password_change_required", 403)
    return user


def role(*roles: str) -> Callable[..., User]:
    def guard(user: User = Depends(ready_user)) -> User:
        if user.role not in roles:
            raise AppError("auth.forbidden", 403)
        return user
    return guard


staff = role("admin", "faculty")
admin = role("admin")
