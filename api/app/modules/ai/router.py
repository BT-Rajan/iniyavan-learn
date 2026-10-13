from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import ready_user
from app.modules.catalog import content, policy
from app.modules.users.models import User

from . import service

router = APIRouter(prefix="/api", tags=["ai"])


@router.get("/ai/status")
def status(user: User = Depends(ready_user), db: Session = Depends(get_db)):
    return service.status(db, user)


@router.get("/topics/{topic_id}/explain")
async def explain(topic_id: int, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    t, u, c = policy.topic(db, user, topic_id)
    body = content.to_text(t.content, t.content_format)
    return await service.cached(db, user, "explain", [t.title, body], f"Course: {c.title}\nUnit: {u.title}\nTopic: {t.title}\n\nMaterial:\n{body[:60000]}")


@router.get("/topics/{topic_id}/model-answer")
async def model_answer(topic_id: int, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    t, u, c = policy.topic(db, user, topic_id)
    body = content.to_text(t.content, t.content_format)
    msg = (f"Course: {c.title}\nTopic: {t.title}\n\nMaterial:\n{body[:50000]}\n\nQuestion pattern:\n{t.question_pattern}\n\n"
           f"Answer guideline:\n{t.answer_guide}\n\nSample answer:\n{t.sample_answer}")
    return await service.cached(db, user, "answer", [t.title, body, t.question_pattern, t.answer_guide, t.sample_answer], msg)
