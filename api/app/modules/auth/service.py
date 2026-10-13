"""Sign-in, sessions, passwords and self-registration (R-ACC-1..5)."""
from __future__ import annotations

import datetime as dt
import secrets

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core import mail
from app.core.config import settings
from app.core.db import utcnow
from app.core.errors import AppError
from app.core.security import digest, hash_password, make_token, random_code, verify_password
from app.modules.admin import service as admin_settings
from app.modules.users.models import User

from .models import LoginFailure, PasswordReset, PendingRegistration

LOCK_TRIES, LOCK_MINUTES = 5, 15
CODE_MINUTES, CODE_TRIES, CODE_SENDS = 10, 5, 5


def new_session_key() -> str:
    return secrets.token_hex(16)


def me(user: User) -> dict:
    return {"id": user.id, "name": user.name, "email": user.email, "role": user.role, "locale": user.locale,
            "must_change_password": user.must_change_password, "self_registered": user.self_registered,
            "program_id": user.program_id, "term_no": user.term_no, "placed": user.role != "student" or bool(user.program_id),
            "own_ai_key": bool(user.ai_key_sealed)}


def login(db: Session, email: str, password: str) -> tuple[User, str]:
    email = email.lower()
    since = utcnow() - dt.timedelta(minutes=LOCK_MINUTES)
    fails = db.scalar(select(func.count(LoginFailure.id)).where(LoginFailure.email == email, LoginFailure.at >= since)) or 0
    if fails >= LOCK_TRIES:
        raise AppError("auth.locked", 429, minutes=LOCK_MINUTES)
    user = db.scalar(select(User).where(User.email == email))
    if not user or not verify_password(password, user.password_hash):
        db.add(LoginFailure(email=email))
        db.commit()
        raise AppError("auth.wrong_credentials", 401)
    if not user.active:
        raise AppError("auth.disabled", 403)
    db.execute(delete(LoginFailure).where(LoginFailure.email == email))
    db.commit()
    return user, make_token(user.id, user.session_key)


def change_password(db: Session, user: User, current: str, new: str) -> str:
    if not verify_password(current, user.password_hash):
        raise AppError("auth.wrong_password", 400)
    user.password_hash, user.must_change_password, user.session_key = hash_password(new), False, new_session_key()
    db.commit()
    return make_token(user.id, user.session_key)


def forgot(db: Session, email: str) -> None:
    user = db.scalar(select(User).where(User.email == email.lower(), User.active.is_(True)))
    if not user or not settings.mail_enabled:
        return  # same answer either way, so nobody can probe which emails exist
    token = secrets.token_urlsafe(32)
    db.add(PasswordReset(user_id=user.id, token_hash=digest(token), expires_at=utcnow() + dt.timedelta(hours=1)))
    db.commit()
    mail.send(user.email, "Reset your password", f"Open this link within an hour to choose a new password:\n\n{settings.app_url}/reset#{token}\n")


def reset(db: Session, token: str, password: str) -> tuple[User, str]:
    row = db.scalar(select(PasswordReset).where(PasswordReset.token_hash == digest(token)))
    if not row or row.used_at or row.expires_at < utcnow():
        raise AppError("auth.reset_invalid", 400)
    user = db.get(User, row.user_id)
    if not user or not user.active:
        raise AppError("auth.reset_invalid", 400)
    row.used_at = utcnow()
    user.password_hash, user.must_change_password, user.session_key = hash_password(password), False, new_session_key()
    db.commit()
    return user, make_token(user.id, user.session_key)


def registration_open(db: Session) -> bool:
    return admin_settings.get(db, "self_registration") == "1" and settings.mail_enabled


def register_start(db: Session, name: str, email: str, password: str) -> None:
    if not registration_open(db):
        raise AppError("auth.registration_closed", 403)
    email = email.lower()
    domains = [d.strip().lower().lstrip("@") for d in admin_settings.get(db, "allowed_domains").split(",") if d.strip()]
    if domains and email.split("@")[-1] not in domains:
        raise AppError("auth.domain_not_allowed", 400)
    if db.scalar(select(User.id).where(User.email == email)):
        raise AppError("auth.email_taken", 409)
    pending = db.scalar(select(PendingRegistration).where(PendingRegistration.email == email))
    if pending and pending.sends >= CODE_SENDS and pending.expires_at > utcnow():
        raise AppError("auth.too_many_codes", 429)
    code = random_code()
    pending = pending or PendingRegistration(email=email, sends=0)
    pending.name, pending.password_hash, pending.code_hash = name.strip(), hash_password(password), digest(code)
    pending.tries, pending.sends, pending.expires_at, pending.sent_at = 0, pending.sends + 1, utcnow() + dt.timedelta(minutes=CODE_MINUTES), utcnow()
    db.add(pending)
    db.commit()
    mail.send(email, "Your sign-up code", f"Your code is {code}. It is valid for {CODE_MINUTES} minutes.\n")


def register_verify(db: Session, email: str, code: str) -> tuple[User, str]:
    pending = db.scalar(select(PendingRegistration).where(PendingRegistration.email == email.lower()))
    if not pending or pending.expires_at < utcnow() or pending.tries >= CODE_TRIES:
        raise AppError("auth.code_expired", 400)
    if digest(code) != pending.code_hash:
        pending.tries += 1
        db.commit()
        raise AppError("auth.code_wrong", 400, left=CODE_TRIES - pending.tries)
    user = User(email=pending.email, name=pending.name, role="student", password_hash=pending.password_hash,
                session_key=new_session_key(), self_registered=True)
    db.add(user)
    db.delete(pending)
    db.commit()
    return user, make_token(user.id, user.session_key)
