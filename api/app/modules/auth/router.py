from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.core import messages
from app.core.config import settings
from app.core.db import get_db
from app.core.deps import COOKIE, current_user
from app.core.errors import AppError
from app.core.security import seal
from app.modules.admin import service as admin_settings
from app.modules.users.models import User

from . import service
from .schemas import AiKeyIn, ForgotIn, LoginIn, Me, PasswordIn, ProfileIn, RegisterIn, ResetIn, VerifyIn

router = APIRouter(prefix="/api/auth", tags=["auth"])
LOCALES = set(messages.LOCALES)


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(COOKIE, token, httponly=True, samesite="lax", secure=settings.secure_cookies, max_age=settings.session_days * 86400, path="/")


@router.get("/config")
def public_config(db: Session = Depends(get_db)) -> dict:
    return {"app_name": admin_settings.get(db, "app_name"), "logo": admin_settings.get(db, "logo"),
            "registration": service.registration_open(db), "password_reset": settings.mail_enabled, "locales": sorted(LOCALES)}


@router.post("/login", response_model=Me)
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)):
    user, token = service.login(db, body.email, body.password)
    _set_cookie(response, token)
    return service.me(user)


@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(COOKIE, path="/")


@router.get("/me", response_model=Me)
def get_me(user: User = Depends(current_user)):
    return service.me(user)


@router.patch("/me", response_model=Me)
def update_me(body: ProfileIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.name is not None:
        user.name = body.name.strip()
    if body.locale is not None:
        if body.locale not in LOCALES:
            raise AppError("auth.locale_unknown", 400)
        user.locale = body.locale
    db.commit()
    return service.me(user)


@router.post("/password", response_model=Me)
def change_password(body: PasswordIn, response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _set_cookie(response, service.change_password(db, user, body.current, body.new))
    return service.me(user)


@router.post("/forgot", status_code=204)
def forgot(body: ForgotIn, db: Session = Depends(get_db)):
    service.forgot(db, body.email)


@router.post("/reset", response_model=Me)
def reset(body: ResetIn, response: Response, db: Session = Depends(get_db)):
    user, token = service.reset(db, body.token, body.password)
    _set_cookie(response, token)
    return service.me(user)


@router.post("/register", status_code=204)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    service.register_start(db, body.name, body.email, body.password, body.locale)


@router.post("/register/verify", response_model=Me)
def register_verify(body: VerifyIn, response: Response, db: Session = Depends(get_db)):
    user, token = service.register_verify(db, body.email, body.code)
    _set_cookie(response, token)
    return service.me(user)


@router.put("/me/ai-key", response_model=Me)
def set_ai_key(body: AiKeyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not user.self_registered:
        raise AppError("ai.key_not_needed", 400)
    user.ai_key_sealed = seal(body.key.strip()) if body.key.strip() else None
    db.commit()
    return service.me(user)
