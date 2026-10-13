from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import staff
from app.core.errors import AppError
from app.modules.catalog import policy
from app.modules.users.models import User

from . import service

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/courses/{course_id}")
def course_report(course_id: int, format: str = "json", user: User = Depends(staff), db: Session = Depends(get_db)):
    c = policy.course(db, user, course_id, edit=True)
    if c.kind != "catalog":
        raise AppError("report.catalog_only", 400)
    return service.course_report(db, c, as_csv=format == "csv")


@router.get("/students/{user_id}")
def student_report(user_id: int, user: User = Depends(staff), db: Session = Depends(get_db)):
    return service.student_report(db, user, service.student_for(db, user, user_id))
