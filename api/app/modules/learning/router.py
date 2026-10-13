from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import ready_user
from app.modules.catalog import policy
from app.modules.users.models import User

from . import service

router = APIRouter(prefix="/api", tags=["learning"])


class CompletedIn(BaseModel):
    completed: bool


@router.get("/home")
def home(user: User = Depends(ready_user), db: Session = Depends(get_db)):
    return service.home(db, user)


@router.put("/topics/{topic_id}/completed")
def completed(topic_id: int, body: CompletedIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    t, _, _ = policy.topic(db, user, topic_id)
    return service.set_completed(db, user, t, body.completed)
