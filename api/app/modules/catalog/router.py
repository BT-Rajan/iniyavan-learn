from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.db import get_db, get_or_404
from app.core.deps import admin, ready_user, staff
from app.core.errors import AppError
from app.modules.learning import service as learning
from app.modules.users.models import User

from . import content, policy, service
from .models import Course, Program, Term, Topic, Unit
from .schemas import (
    ArchiveIn,
    CopyIn,
    CourseIn,
    CoursePatch,
    OrderIn,
    ProgramIn,
    ProgramPatch,
    RolloverIn,
    SharesIn,
    TermIn,
    TermPatch,
    TitleIn,
    TopicIn,
    TopicPatch,
    UnitPatch,
)

router = APIRouter(prefix="/api", tags=["catalog"])


# programs and terms
@router.get("/programs")
def programs(_: User = Depends(staff), db: Session = Depends(get_db)):
    return service.programs_overview(db)


@router.post("/programs")
def create_program(body: ProgramIn, actor: User = Depends(admin), db: Session = Depends(get_db)):
    p = service.create_program(db, actor, body.name, body.pattern, body.terms)
    return next(x for x in service.programs_overview(db) if x["id"] == p.id)


@router.patch("/programs/{program_id}")
def update_program(program_id: int, body: ProgramPatch, actor: User = Depends(admin), db: Session = Depends(get_db)):
    service.update_program(db, actor, program_id, body.name, body.pattern)
    return next(x for x in service.programs_overview(db) if x["id"] == program_id)


@router.post("/programs/{program_id}/terms")
def add_term(program_id: int, body: TermIn, actor: User = Depends(admin), db: Session = Depends(get_db)):
    t = service.add_term(db, actor, program_id, body.number, body.name)
    return {"id": t.id, "number": t.number, "name": t.name}


@router.patch("/terms/{term_id}")
def update_term(term_id: int, body: TermPatch, actor: User = Depends(admin), db: Session = Depends(get_db)):
    t = service.update_term(db, actor, term_id, body.name, body.number)
    return {"id": t.id, "number": t.number, "name": t.name}


@router.post("/programs/{program_id}/rollover")
def rollover(program_id: int, body: RolloverIn, actor: User = Depends(admin), db: Session = Depends(get_db)):
    return service.rollover(db, actor, program_id, body.finishing, body.dry_run)


# browsing and courses
@router.get("/browse")
def browse(user: User = Depends(ready_user), db: Session = Depends(get_db)):
    return service.browse(db, user)


@router.post("/courses")
def create_course(body: CourseIn, actor: User = Depends(admin), db: Session = Depends(get_db)):
    return service.course_row(db, actor, service.create_catalog_course(db, actor, body.title, body.term_id, body.owner_id, body.description))


@router.get("/courses/{course_id}")
def get_course(course_id: int, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    c = policy.course(db, user, course_id)
    units = service.outline(db, user, c)
    return {**service.course_row(db, user, c), "units": units, **learning.decorate_course(db, user, c, units)}


@router.patch("/courses/{course_id}")
def update_course(course_id: int, body: CoursePatch, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    c = policy.course(db, user, course_id, edit=True)
    return service.course_row(db, user, service.update_course(db, user, c, body.model_dump(exclude_unset=True)))


@router.put("/courses/{course_id}/shares")
def set_shares(course_id: int, body: SharesIn, actor: User = Depends(admin), db: Session = Depends(get_db)):
    return {"term_ids": service.set_shares(db, actor, get_or_404(db, Course, course_id, "course"), body.term_ids)}


# units
@router.post("/courses/{course_id}/units")
def create_unit(course_id: int, body: TitleIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    u = service.create_unit(db, user, policy.course(db, user, course_id, edit=True), body.title)
    return {"id": u.id, "title": u.title, "topics": [], "archived": False}


@router.patch("/units/{unit_id}")
def update_unit(unit_id: int, body: UnitPatch, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    u, _ = policy.unit(db, user, unit_id, edit=True)
    if body.title:
        u.title = body.title.strip()
    if body.course_id and body.course_id != u.course_id:
        if user.role != "admin":
            raise AppError("auth.forbidden", 403)
        u.course_id = policy.course(db, user, body.course_id, edit=True).id
    db.commit()
    return {"id": u.id, "title": u.title, "course_id": u.course_id}


@router.put("/courses/{course_id}/units/order", status_code=204)
def order_units(course_id: int, body: OrderIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    service.reorder(db, Unit, "course_id", policy.course(db, user, course_id, edit=True).id, body.ids)


@router.post("/units/{unit_id}/copy")
def copy_unit(unit_id: int, body: CopyIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    u, src = policy.unit(db, user, unit_id)
    target = policy.course(db, user, body.course_id or 0, edit=True)
    nu = service.copy_unit(db, user, u, target, include_drafts=policy.can_edit(user, src))
    return {"id": nu.id, "title": nu.title, "course_id": target.id}


# topics
@router.post("/units/{unit_id}/topics")
def create_topic(unit_id: int, body: TopicIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    u, c = policy.unit(db, user, unit_id, edit=True)
    data = body.model_dump()
    if data["published"] is None:
        data.pop("published")
    return {"id": service.create_topic(db, user, u, c, data).id}


@router.get("/topics/{topic_id}")
def get_topic(topic_id: int, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    t, u, c = policy.topic(db, user, topic_id)
    edit = policy.can_edit(user, c)
    out = {"id": t.id, "title": t.title, "summary": t.summary, "content": content.shown(t.content, t.content_format), "content_format": t.content_format,
           "question_pattern": t.question_pattern, "sample_answer": t.sample_answer, "answer_guide": t.answer_guide, "published": t.published,
           "archived": bool(t.archived_at), "due_at": t.due_at.isoformat() + "Z" if t.due_at else None, "unit_id": u.id, "unit": u.title,
           "course_id": c.id, "course": c.title, "course_kind": c.kind, "can_edit": edit}
    flat = [x for unit in service.outline(db, user, c) for x in unit["topics"]]
    i = next((k for k, x in enumerate(flat) if x["id"] == t.id), None)
    out["prev"] = {"id": flat[i - 1]["id"], "title": flat[i - 1]["title"]} if i else None
    out["next"] = {"id": flat[i + 1]["id"], "title": flat[i + 1]["title"]} if i is not None and i + 1 < len(flat) else None
    out["position"], out["total"] = (i + 1 if i is not None else None), len(flat)
    return out | learning.open_topic(db, user, t)


@router.patch("/topics/{topic_id}")
def update_topic(topic_id: int, body: TopicPatch, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    t, _, c = policy.topic(db, user, topic_id, edit=True)
    t = service.update_topic(db, user, t, c, body.model_dump(exclude_unset=True))
    return {"id": t.id, "updated_at": t.updated_at.isoformat() + "Z"}


@router.put("/units/{unit_id}/topics/order", status_code=204)
def order_topics(unit_id: int, body: OrderIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    u, _ = policy.unit(db, user, unit_id, edit=True)
    service.reorder(db, Topic, "unit_id", u.id, body.ids)


@router.get("/topics/{topic_id}/versions")
def topic_versions(topic_id: int, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    t, _, _ = policy.topic(db, user, topic_id, edit=True)
    return service.versions(db, t)


@router.get("/topics/{topic_id}/versions/{version_id}")
def topic_version(topic_id: int, version_id: int, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    from .models import TopicVersion
    t, _, _ = policy.topic(db, user, topic_id, edit=True)
    v = get_or_404(db, TopicVersion, version_id, "version")
    if v.topic_id != t.id:
        raise AppError("version.not_found", 404)
    return {k: getattr(v, k) for k in service.VFIELDS} | {"id": v.id, "saved_at": v.saved_at.isoformat() + "Z", "current": service.topic_state(t)}


@router.post("/topics/{topic_id}/versions/{version_id}/restore", status_code=204)
def restore_version(topic_id: int, version_id: int, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    t, _, _ = policy.topic(db, user, topic_id, edit=True)
    service.restore_version(db, user, t, version_id)


@router.post("/topics/{topic_id}/copy")
def copy_topic(topic_id: int, body: CopyIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    t, _, _ = policy.topic(db, user, topic_id)
    target, _ = policy.unit(db, user, body.unit_id or 0, edit=True)
    n = service.copy_topic(db, user, t, target)
    return {"id": n.id, "title": n.title, "unit_id": target.id}


# archive and delete (one shape for every level)
def _load(db: Session, user: User, kind: str, rid: int, *, for_delete: bool = False):
    if kind in ("program", "term"):
        if user.role != "admin":
            raise AppError("auth.forbidden", 403)
        return get_or_404(db, Program if kind == "program" else Term, rid, kind)
    if kind == "course":
        c = policy.course(db, user, rid, edit=True)
        if for_delete and c.kind == "catalog" and user.role != "admin":
            raise AppError("auth.forbidden", 403)
        return c
    if kind == "unit":
        return policy.unit(db, user, rid, edit=True)[0]
    if kind == "topic":
        return policy.topic(db, user, rid, edit=True)[0]
    raise AppError("http.not_found", 404)


def _routes(kind: str, plural: str) -> None:
    def archive(rid: int, body: ArchiveIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
        service.set_archived(db, user, kind, _load(db, user, kind, rid), body.archived)

    def delete(rid: int, user: User = Depends(ready_user), db: Session = Depends(get_db)):
        service.remove(db, user, kind, _load(db, user, kind, rid, for_delete=True))

    router.add_api_route(f"/{plural}/{{rid}}/archive", archive, methods=["PUT"], status_code=204, name=f"archive_{kind}")
    router.add_api_route(f"/{plural}/{{rid}}", delete, methods=["DELETE"], status_code=204, name=f"delete_{kind}")


for _kind in ("program", "term", "course", "unit", "topic"):
    _routes(_kind, _kind + "s")


# images
@router.post("/uploads")
async def upload(request: Request, _: User = Depends(ready_user)):
    if int(request.headers.get("content-length") or 0) > content.MAX_IMAGE:
        raise AppError("upload.too_large", 413, max_mb=3)
    return {"url": content.save_image(await request.body())}


@router.get("/uploads/{name}")
def image(name: str):  # public on purpose: <img> can't send credentials; names are random
    found = content.image_path(name)
    if not found:
        raise AppError("upload.not_found", 404)
    return FileResponse(found[0], media_type=found[1], headers={"Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"})
