from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import ready_user
from app.modules.users.models import User

from . import service

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
def search(q: str = Query(min_length=1, max_length=200), user: User = Depends(ready_user), db: Session = Depends(get_db)):
    return service.search(db, user, q)


@router.get("/answer")
async def answer(q: str = Query(min_length=2, max_length=300), user: User = Depends(ready_user), db: Session = Depends(get_db)):
    return await service.answer(db, user, q)
