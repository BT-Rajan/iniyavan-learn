"""Accounts, roles and placement (R-ROLE-1/2, R-ACC-1/5, R-PROG-4)."""
from __future__ import annotations

import csv
import io
import secrets

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.db import get_or_404
from app.core.errors import AppError
from app.core.security import hash_password
from app.modules.admin.service import audit
from app.modules.auth.service import new_session_key
from app.modules.catalog import service as catalog

from .models import ROLES, User

PASSWORD_CHARS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"


def temp_password() -> str:
    return "".join(secrets.choice(PASSWORD_CHARS) for _ in range(10))


def row(u: User, programs: dict[int, str] | None = None) -> dict:
    return {"id": u.id, "name": u.name, "email": u.email, "role": u.role, "active": u.active, "program_id": u.program_id,
            "program": (programs or {}).get(u.program_id, "") if u.program_id else "", "term_no": u.term_no,
            "self_registered": u.self_registered, "must_change_password": u.must_change_password,
            "last_seen_at": u.last_seen_at.isoformat() + "Z" if u.last_seen_at else None}


def search(db: Session, q: str = "", role: str = "", program_id: int | None = None, term_no: int | None = None, limit: int = 50, offset: int = 0) -> dict:
    stmt = select(User)
    for word in q.split()[:5]:
        like = f"%{word.lower()}%"
        stmt = stmt.where(or_(func.lower(User.name).like(like), func.lower(User.email).like(like)))
    if role:
        stmt = stmt.where(User.role == role)
    if program_id:
        stmt = stmt.where(User.program_id == program_id)
    if term_no:
        stmt = stmt.where(User.term_no == term_no)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    users = db.scalars(stmt.order_by(User.role, func.lower(User.name)).offset(max(offset, 0)).limit(min(max(limit, 1), 200))).all()
    return {"total": total, "items": [row(u, catalog.program_names(db)) for u in users]}


def _email_free(db: Session, email: str, keep: int | None = None) -> str:
    email = email.lower()
    other = db.scalar(select(User.id).where(User.email == email, User.id != (keep or 0)))
    if other:
        raise AppError("user.email_taken", 409)
    return email


def create(db: Session, actor: User, name: str, email: str, role: str, password: str, program_id: int | None, term_no: int | None) -> tuple[User, str]:
    if password and len(password) < 8:
        raise AppError("user.password_short", 400, min=8)
    plain = password or temp_password()
    program_id, term_no = catalog.check_placement(db, program_id, term_no) if role == "student" else (None, None)
    user = User(name=name.strip(), email=_email_free(db, email), role=role, password_hash=hash_password(plain), session_key=new_session_key(),
                must_change_password=role != "admin" or not password, program_id=program_id, term_no=term_no)
    db.add(user)
    db.flush()
    audit(db, actor.id, "user.create", f"user:{user.id}", role=role)
    db.commit()
    return user, plain


def update(db: Session, actor: User, user_id: int, patch: dict) -> User:
    user = get_or_404(db, User, user_id, "user")
    if user.id == actor.id and (("role" in patch and patch["role"] != user.role) or patch.get("active") is False):
        raise AppError("user.cannot_change_self", 400)  # R-ROLE-2
    if "email" in patch and patch["email"]:
        user.email = _email_free(db, patch["email"], user.id)
    if patch.get("name"):
        user.name = patch["name"].strip()
    if patch.get("role"):
        user.role = patch["role"]
    if "active" in patch and patch["active"] is not None and patch["active"] != user.active:
        user.active = patch["active"]
        if not user.active:
            user.session_key = new_session_key()  # R-ACC-5
    if "program_id" in patch or "term_no" in patch:
        pid = patch.get("program_id", user.program_id)
        tno = patch.get("term_no", user.term_no)
        user.program_id, user.term_no = catalog.check_placement(db, pid, tno) if user.role == "student" else (None, None)
    if user.role != "student":
        user.program_id = user.term_no = None
    audit(db, actor.id, "user.update", f"user:{user.id}", fields=sorted(patch))
    db.commit()
    return user


def reset_password(db: Session, actor: User, user_id: int) -> str:
    user = get_or_404(db, User, user_id, "user")
    plain = temp_password()
    user.password_hash, user.must_change_password, user.session_key = hash_password(plain), True, new_session_key()
    audit(db, actor.id, "user.reset_password", f"user:{user.id}")
    db.commit()
    return plain


def bulk(db: Session, actor: User, ids: list[int], action: str, program_id: int | None, term_no: int | None) -> dict:
    if action == "place":
        program_id, term_no = catalog.check_placement(db, program_id, term_no)
    done, skipped, credentials = 0, [], []
    for user in db.scalars(select(User).where(User.id.in_(set(ids)))):
        reason = None
        if user.id == actor.id and action in ("disable", "reset_passwords"):
            reason = "user.cannot_change_self"
        elif action == "place" and user.role != "student":
            reason = "user.only_students_placed"
        if reason:
            skipped.append({"id": user.id, "name": user.name, "reason": reason})
            continue
        if action == "disable" and user.active:
            user.active, user.session_key = False, new_session_key()
        elif action == "enable":
            user.active = True
        elif action == "place":
            user.program_id, user.term_no = program_id, term_no
        elif action == "reset_passwords":
            plain = temp_password()
            user.password_hash, user.must_change_password, user.session_key = hash_password(plain), True, new_session_key()
            credentials.append({"name": user.name, "email": user.email, "password": plain})
        done += 1
    audit(db, actor.id, f"user.bulk_{action}", "", count=done)
    db.commit()
    return {"changed": done, "skipped": skipped, "credentials": credentials}


def import_csv(db: Session, actor: User, text: str, dry_run: bool) -> dict:
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    headers = {(h or "").strip().lower() for h in reader.fieldnames or []}
    if not {"name", "email"} <= headers:
        raise AppError("import.columns_missing", 400, columns="name, email")
    rows = list(reader)
    if len(rows) > 1000:
        raise AppError("import.too_many_rows", 400, max=1000)
    programs = {name.lower(): pid for pid, name in catalog.program_names(db).items()}
    existing = {u.email: u for u in db.scalars(select(User))}
    errors, credentials, created, updated, seen = [], [], 0, 0, set()
    for n, raw in enumerate(rows, start=2):
        r = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
        email, role = r.get("email", "").lower(), (r.get("role") or "student").lower()
        try:
            if "@" not in email or "." not in email.split("@")[-1]:
                raise AppError("user.email_invalid")
            if email in seen:
                raise AppError("import.duplicate_row")
            if role not in ROLES:
                raise AppError("user.role_invalid")
            if r.get("password") and len(r["password"]) < 8:
                raise AppError("user.password_short", min=8)
            pid = None
            if r.get("program"):
                pid = programs.get(r["program"].lower())
                if not pid:
                    raise AppError("import.program_unknown", program=r["program"][:60])
            term = int(r["term"]) if r.get("term", "").isdigit() else None
            if role == "student" and (pid or term):
                pid, term = catalog.check_placement(db, pid or (existing[email].program_id if email in existing else None), term)
        except AppError as e:
            errors.append({"row": n, "code": e.code, "params": e.params})
            continue
        seen.add(email)
        user = existing.get(email)
        if user:
            if r.get("name"):
                user.name = r["name"]
            if role and user.id != actor.id:
                user.role = role
            if pid:
                user.program_id = pid
            if term:
                user.term_no = term
            updated += 1
        else:
            plain = r.get("password") or temp_password()
            db.add(User(name=r.get("name") or email.split("@")[0], email=email, role=role, password_hash=hash_password(plain),
                        session_key=new_session_key(), must_change_password=True, program_id=pid if role == "student" else None,
                        term_no=term if role == "student" else None))
            if not r.get("password"):
                credentials.append({"name": r.get("name") or email, "email": email, "password": plain})
            created += 1
    if dry_run:
        db.rollback()
        return {"dry_run": True, "rows": len(rows), "created": created, "updated": updated, "errors": errors[:50], "error_count": len(errors), "credentials": []}
    audit(db, actor.id, "user.import", "", created=created, updated=updated)
    db.commit()
    return {"dry_run": False, "rows": len(rows), "created": created, "updated": updated, "errors": errors[:50], "error_count": len(errors), "credentials": credentials}
