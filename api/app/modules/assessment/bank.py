"""The shared question bank (R-ASM-6): staff save questions and add copies to tests."""
from __future__ import annotations

import hashlib
import json

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.db import get_or_404
from app.core.errors import AppError
from app.modules.users.models import User

from .models import BankQuestion, Question, Quiz


def fingerprint(text: str, options: list[dict], correct: int) -> str:
    return hashlib.sha256(json.dumps([text.strip().lower(), [o.get("text", "").strip().lower() for o in options], correct]).encode()).hexdigest()


def clean_tags(t: str) -> str:
    return ", ".join(dict.fromkeys(w.strip().lower()[:30] for w in (t or "").split(",") if w.strip()))[:200]


def row(x: BankQuestion, user: User, owners: dict) -> dict:
    return {"id": x.id, "text": x.text, "options": x.options, "correct": x.correct, "explanation": x.explanation, "tags": [t for t in x.tags.split(", ") if t],
            "uses": x.uses, "owner": owners.get(x.owner_id, ""), "can_edit": user.role == "admin" or x.owner_id == user.id}


def search(db: Session, user: User, q: str, tag: str, mine: bool, limit: int, offset: int) -> dict:
    stmt = select(BankQuestion)
    if mine:
        stmt = stmt.where(BankQuestion.owner_id == user.id)
    if tag.strip():
        stmt = stmt.where(BankQuestion.tags.like(f"%{tag.strip().lower()}%"))
    for w in q.split()[:6]:
        stmt = stmt.where(or_(BankQuestion.text.like(f"%{w}%"), BankQuestion.tags.like(f"%{w.lower()}%")))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = list(db.scalars(stmt.order_by(BankQuestion.id.desc()).offset(max(offset, 0)).limit(min(max(limit, 1), 100))))
    owners = dict(db.execute(select(User.id, User.name).where(User.id.in_({x.owner_id for x in items if x.owner_id} or {0}))).all())
    tags = sorted({t for (v,) in db.execute(select(BankQuestion.tags)) for t in v.split(", ") if t})[:200]
    return {"total": total, "items": [row(x, user, owners) for x in items], "tags": tags}


def add(db: Session, user: User, text: str, options: list[dict], correct: int, explanation: str, tags: str) -> bool:
    fp = fingerprint(text, options, correct)
    if db.scalar(select(BankQuestion.id).where(BankQuestion.fingerprint == fp)):
        return False
    db.add(BankQuestion(owner_id=user.id, fingerprint=fp, text=text.strip(), options=options, correct=correct, explanation=explanation, tags=clean_tags(tags)))
    return True


def edit(db: Session, user: User, bid: int, data: dict) -> BankQuestion:
    x = get_or_404(db, BankQuestion, bid, "bank_question")
    if not (user.role == "admin" or x.owner_id == user.id):
        raise AppError("bank.not_yours", 403)
    for k in ("text", "options", "correct", "explanation"):
        if data.get(k) is not None:
            setattr(x, k, data[k])
    if data.get("tags") is not None:
        x.tags = clean_tags(data["tags"])
    x.fingerprint = fingerprint(x.text, x.options, x.correct)
    db.commit()
    return x


def remove(db: Session, user: User, bid: int) -> None:
    x = get_or_404(db, BankQuestion, bid, "bank_question")
    if not (user.role == "admin" or x.owner_id == user.id):
        raise AppError("bank.not_yours", 403)
    db.delete(x)
    db.commit()


def from_test(db: Session, user: User, q: Quiz, tags: str) -> dict:
    added = skipped = 0
    for x in db.scalars(select(Question).where(Question.quiz_id == q.id)):
        if any(o.get("image") for o in x.options) or x.image:
            skipped += 1
            continue
        if add(db, user, x.text, x.options, x.correct, x.explanation, tags):
            added += 1
        else:
            skipped += 1
    db.commit()
    return {"added": added, "skipped": skipped}


def into_test(db: Session, q: Quiz, ids: list[int], limit: int) -> int:
    have = db.scalar(select(func.count(Question.id)).where(Question.quiz_id == q.id)) or 0
    rows = {x.id: x for x in db.scalars(select(BankQuestion).where(BankQuestion.id.in_(ids or [0])))}
    if len(rows) != len(set(ids)):
        raise AppError("bank_question.not_found", 404)
    if have + len(ids) > limit:
        raise AppError("quiz.too_many_questions", 400, max=limit)
    for i, bid in enumerate(dict.fromkeys(ids)):
        x = rows[bid]
        x.uses += 1
        db.add(Question(quiz_id=q.id, position=have + i, text=x.text, options=x.options, correct=x.correct, explanation=x.explanation))  # a copy
    db.commit()
    return have + len(ids)
