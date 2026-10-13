"""Institution settings and the audit log."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.security import seal, unseal

from .models import AuditEntry, Setting

DEFAULTS = {
    "app_name": "Iniyavan Learn",
    "logo": "",
    "self_registration": "0",
    "allowed_domains": "",
    "ai_key": "",  # sealed
    "ai_model": "",
    "ai_daily_limit": "",
}
SECRET = {"ai_key"}


def get(db: Session, key: str) -> str:
    row = db.get(Setting, key)
    value = row.value if row else DEFAULTS.get(key, "")
    return unseal(value) if key in SECRET else value


def put(db: Session, key: str, value: str) -> None:
    row = db.get(Setting, key) or Setting(key=key)
    row.value = seal(value) if key in SECRET and value else value
    db.add(row)


def audit(db: Session, user_id: int | None, action: str, target: str = "", **detail) -> None:
    db.add(AuditEntry(user_id=user_id, action=action, target=target, detail=detail))
