from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.db import get_db
from app.core.deps import ready_user
from app.core.errors import AppError
from app.modules.ai import service as ai
from app.modules.catalog import policy
from app.modules.catalog import service as catalog
from app.modules.users.models import User

from . import extract, service

router = APIRouter(prefix="/api/studio", tags=["studio"])


class NewIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class TextIn(BaseModel):
    text: str = Field(min_length=1, max_length=1_500_000)
    name: str = Field(default="", max_length=200)


class SliceIn(BaseModel):
    method: Literal["ai", "headings"] = "ai"
    notes: str = Field(default="", max_length=4000)


class OutlineIn(BaseModel):
    units: list[dict] = Field(max_length=200)


class ApplyIn(BaseModel):
    replace: bool = False


def _course(db: Session, user: User, course_id: int):
    return policy.course(db, user, course_id, edit=True)


@router.post("")
def new_course(body: NewIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    c = catalog.create_personal_course(db, user, body.title)
    service.material(db, c)
    db.commit()
    return {"course_id": c.id}


@router.get("/{course_id}")
def get_material(course_id: int, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    c = _course(db, user, course_id)
    return {"course_id": c.id, "title": c.title, "kind": c.kind, "status": c.status, **service.view(service.material(db, c)), "ai": ai.status(db, user)}


@router.post("/{course_id}/files")
async def add_file(course_id: int, request: Request, name: str = "", user: User = Depends(ready_user), db: Session = Depends(get_db)):
    c = _course(db, user, course_id)
    if int(request.headers.get("content-length") or 0) > service.MAX_FILE:
        raise AppError("upload.too_large", 413, max_mb=20)
    data = await request.body()
    if len(data) > service.MAX_FILE:
        raise AppError("upload.too_large", 413, max_mb=20)
    kind, paras = await run_in_threadpool(extract.from_file, name or "file", data)
    return service.add(db, c, name or "file", kind, paras)


@router.post("/{course_id}/text")
def add_text(course_id: int, body: TextIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    return service.add(db, _course(db, user, course_id), body.name.strip(), "text", extract.text(body.text))


@router.delete("/{course_id}/sources/{index}", status_code=204)
def remove_source(course_id: int, index: int, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    service.remove_source(db, _course(db, user, course_id), index)


@router.post("/{course_id}/slice")
async def slice_it(course_id: int, body: SliceIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    return await service.slice_material(db, user, _course(db, user, course_id), body.method, body.notes)


@router.put("/{course_id}/outline")
def save_outline(course_id: int, body: OutlineIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    return service.save_outline(db, _course(db, user, course_id), body.units)


@router.get("/{course_id}/paragraphs")
def paragraphs(course_id: int, start: int, end: int, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    return {"paragraphs": service.paragraphs(db, _course(db, user, course_id), start, end)}


@router.post("/{course_id}/apply")
def apply(course_id: int, body: ApplyIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    return {"topics": service.apply(db, user, _course(db, user, course_id), body.replace)}
