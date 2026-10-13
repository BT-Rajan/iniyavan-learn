"""Search across every topic a person can see, and an AI answer when the notes fall short."""
from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.ai import service as ai
from app.modules.catalog import policy
from app.modules.catalog.content import to_text
from app.modules.catalog.models import Course, Topic, Unit
from app.modules.users.models import User

LIMIT = 30


def _snippet(text: str, words: list[str], width: int = 160) -> str:
    low = text.lower()
    at = min((i for w in words if (i := low.find(w)) >= 0), default=0)
    start = max(0, at - width // 3)
    return ("…" if start else "") + text[start:start + width].strip() + ("…" if start + width < len(text) else "")


def search(db: Session, user: User, q: str) -> dict:
    words = [w for w in re.findall(r"\w+", q.lower()) if len(w) > 1][:8]
    if not words:
        return {"query": q, "results": []}
    courses = {c.id: c for c in policy.visible_courses(db, user)}
    if not courses:
        return {"query": q, "results": []}
    rows = db.execute(select(Topic, Unit).join(Unit, Unit.id == Topic.unit_id).where(Unit.course_id.in_(courses), Unit.archived_at.is_(None), Topic.archived_at.is_(None)))
    hits = []
    for t, u in rows:
        c: Course = courses[u.course_id]
        if not t.published and not policy.can_edit(user, c):
            continue
        title, body = t.title.lower(), to_text(t.content, t.content_format)
        low = body.lower()
        if not all(w in title or w in low for w in words):
            continue
        score = sum(5 * (w in title) + min(low.count(w), 5) for w in words)
        hits.append((score, {"topic_id": t.id, "title": t.title, "unit": u.title, "course_id": c.id, "course": c.title, "snippet": _snippet(body, words)}))
    hits.sort(key=lambda h: (-h[0], h[1]["title"].lower()))
    return {"query": q, "results": [h for _, h in hits[:LIMIT]]}


async def answer(db: Session, user: User, q: str) -> dict:
    return await ai.cached(db, user, "search", [q.strip().lower()], f"The student searched for: {q.strip()[:300]}", max_tokens=1500)
