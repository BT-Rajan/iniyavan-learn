from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import admin, staff
from app.modules.catalog import service as catalog

from . import service
from .models import User
from .schemas import BulkIn, ImportIn, UserIn, UserPatch

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("")
def list_users(q: str = "", role: str = "", program_id: int | None = None, term_no: int | None = None, limit: int = 50, offset: int = 0,
               _: User = Depends(admin), db: Session = Depends(get_db)):
    return service.search(db, q, role, program_id, term_no, limit, offset)


@router.get("/faculty")
def faculty(_: User = Depends(staff), db: Session = Depends(get_db)):  # for picking a course owner
    return [{"id": u.id, "name": u.name, "email": u.email} for u in db.scalars(select(User).where(User.role == "faculty", User.active.is_(True)).order_by(User.name))]


@router.post("")
def create_user(body: UserIn, actor: User = Depends(admin), db: Session = Depends(get_db)):
    user, plain = service.create(db, actor, body.name, body.email, body.role, body.password, body.program_id, body.term_no)
    return {**service.row(user, catalog.program_names(db)), "password": plain if not body.password else None}


@router.patch("/{user_id}")
def update_user(user_id: int, body: UserPatch, actor: User = Depends(admin), db: Session = Depends(get_db)):
    return service.row(service.update(db, actor, user_id, body.model_dump(exclude_unset=True)), catalog.program_names(db))


@router.post("/{user_id}/reset-password")
def reset_password(user_id: int, actor: User = Depends(admin), db: Session = Depends(get_db)):
    return {"password": service.reset_password(db, actor, user_id)}


@router.post("/bulk")
def bulk(body: BulkIn, actor: User = Depends(admin), db: Session = Depends(get_db)):
    return service.bulk(db, actor, body.ids, body.action, body.program_id, body.term_no)


@router.post("/import")
def import_users(body: ImportIn, actor: User = Depends(admin), db: Session = Depends(get_db)):
    return service.import_csv(db, actor, body.csv, body.dry_run)
