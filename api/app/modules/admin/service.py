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


def settings_view(db: Session) -> dict:
    """Everything an admin edits; the AI key is never sent back, only whether one is set."""
    from app.modules.ai.service import PROMPTS
    out = {k: get(db, k) for k in DEFAULTS if k not in SECRET}
    out["ai_key_set"] = bool(get(db, "ai_key"))
    out["prompts"] = {k: {"value": get(db, f"prompt_{k}"), "default": v} for k, v in PROMPTS.items()}
    return out


def update_settings(db: Session, user_id: int, data: dict) -> dict:
    from app.core.errors import AppError
    from app.modules.ai.service import PROMPTS
    from app.modules.catalog.content import check_image_url
    changed = []
    for k, v in data.items():
        if v is None:
            continue
        if k == "prompts":
            for name, text in v.items():
                if name not in PROMPTS:
                    raise AppError("settings.unknown_prompt", 400, name=name)
                put(db, f"prompt_{name}", text.strip())
                changed.append(f"prompt_{name}")
            continue
        if k == "logo":
            v = check_image_url(v)
        if k == "ai_daily_limit" and v and not (v.isdigit() and 1 <= int(v) <= 10000):
            raise AppError("settings.limit_out_of_range", 400, min=1, max=10000)
        if k == "allowed_domains":
            v = ",".join(d.strip().lower().lstrip("@") for d in v.split(",") if d.strip())
        put(db, k, v.strip() if isinstance(v, str) else v)
        changed.append(k)
    audit(db, user_id, "settings.update", "", keys=changed)  # the key's value is never logged
    db.commit()
    return settings_view(db)


def audit_log(db: Session, action: str = "", user_id: int | None = None, before: int | None = None, limit: int = 50) -> dict:
    from sqlalchemy import select

    from app.modules.users.models import User
    q = select(AuditEntry, User.name).outerjoin(User, User.id == AuditEntry.user_id).order_by(AuditEntry.id.desc()).limit(limit + 1)
    if action:
        q = q.where(AuditEntry.action.startswith(action))
    if user_id:
        q = q.where(AuditEntry.user_id == user_id)
    if before:
        q = q.where(AuditEntry.id < before)
    rows = db.execute(q).all()
    items = [{"id": e.id, "at": e.at.isoformat() + "Z", "user_id": e.user_id, "user": name, "action": e.action, "target": e.target, "detail": e.detail}
             for e, name in rows[:limit]]
    return {"items": items, "more": len(rows) > limit}
