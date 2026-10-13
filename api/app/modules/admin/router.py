from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import admin
from app.modules.users.models import User

from . import service

router = APIRouter(prefix="/api/admin", tags=["admin"])


class SettingsIn(BaseModel):
    app_name: str | None = Field(default=None, min_length=1, max_length=80)
    logo: str | None = Field(default=None, max_length=200)
    self_registration: bool | None = None
    allowed_domains: str | None = Field(default=None, max_length=1000)
    ai_key: str | None = Field(default=None, max_length=300)  # "" removes it
    ai_model: str | None = Field(default=None, max_length=80)
    ai_daily_limit: str | None = Field(default=None, max_length=6)
    prompts: dict[str, str] | None = None


@router.get("/settings")
def get_settings(user: User = Depends(admin), db: Session = Depends(get_db)):
    return service.settings_view(db)


@router.patch("/settings")
def patch_settings(body: SettingsIn, user: User = Depends(admin), db: Session = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    if "self_registration" in data and data["self_registration"] is not None:
        data["self_registration"] = "1" if data["self_registration"] else "0"
    return service.update_settings(db, user.id, data)


@router.get("/audit")
def audit(action: str = "", user_id: int | None = None, before: int | None = None, limit: int = Query(50, ge=1, le=200),
          user: User = Depends(admin), db: Session = Depends(get_db)):
    return service.audit_log(db, action, user_id, before, limit)
