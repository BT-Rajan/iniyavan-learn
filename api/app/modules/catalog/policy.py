"""The one access policy (ARCHITECTURE rule 1): who may see and who may edit a course, unit or topic."""
from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.modules.users.models import User

from .models import Course, CourseShare, Program, Term, Topic, Unit


def can_edit(user: User, course: Course) -> bool:
    if user.role == "admin":
        return True
    if course.kind == "personal":
        return course.owner_id == user.id
    return user.role == "faculty" and course.owner_id == user.id  # R-CRS-2


def course_terms(db: Session, course: Course) -> list[Term]:
    """The terms a catalog course shows in: its home and the terms it is shared into (R-CRS-1)."""
    ids = [course.term_id] if course.term_id else []
    ids += list(db.scalars(select(CourseShare.term_id).where(CourseShare.course_id == course.id)))
    return list(db.scalars(select(Term).where(Term.id.in_(ids or [0]))))


def term_off(db: Session, term: Term) -> bool:
    program = db.get(Program, term.program_id)
    return bool(term.archived_at or (program and program.archived_at))


def term_open_to(user: User, term: Term) -> bool:  # R-PROG-4: own program, up to and including their term
    return user.program_id == term.program_id and (user.term_no is None or term.number <= user.term_no)


def can_view(db: Session, user: User, course: Course) -> bool:
    if can_edit(user, course):
        return True
    if course.archived_at:
        return False
    if course.kind == "personal":
        if course.status != "ready" or course.visibility != "program" or not user.program_id:
            return False
        owner = db.get(User, course.owner_id) if course.owner_id else None
        return bool(owner and owner.program_id == user.program_id)  # R-PER-4
    if user.role in ("admin", "faculty"):
        return True
    return any(term_open_to(user, t) and not term_off(db, t) for t in course_terms(db, course))


def course(db: Session, user: User, course_id: int, edit: bool = False) -> Course:
    c = db.get(Course, course_id)
    if not c or not can_view(db, user, c):
        raise AppError("course.not_found", 404)
    if edit and not can_edit(user, c):
        raise AppError("course.not_editable", 403)
    return c


def unit(db: Session, user: User, unit_id: int, edit: bool = False) -> tuple[Unit, Course]:
    u = db.get(Unit, unit_id)
    if not u:
        raise AppError("unit.not_found", 404)
    c = course(db, user, u.course_id, edit)
    if u.archived_at and not can_edit(user, c):
        raise AppError("unit.not_found", 404)
    return u, c


def topic(db: Session, user: User, topic_id: int, edit: bool = False) -> tuple[Topic, Unit, Course]:
    t = db.get(Topic, topic_id)
    if not t:
        raise AppError("topic.not_found", 404)
    u, c = unit(db, user, t.unit_id, edit)
    if not can_edit(user, c) and (not t.published or t.archived_at):
        raise AppError("topic.not_found", 404)  # R-CRS-4/5
    return t, u, c


def visible_courses(db: Session, user: User) -> list[Course]:
    """Every course this person studies or edits: catalog courses of their placement, their own and shared personal courses."""
    out: list[Course] = []
    if user.role in ("admin", "faculty"):
        out = list(db.scalars(select(Course).where(Course.kind == "catalog")))
        out += list(db.scalars(select(Course).where(Course.kind == "personal", Course.owner_id == user.id)))
        return out
    if user.program_id:
        terms = [t for t in db.scalars(select(Term).where(Term.program_id == user.program_id)) if term_open_to(user, t) and not term_off(db, t)]
        tids = [t.id for t in terms] or [0]
        shared = select(CourseShare.course_id).where(CourseShare.term_id.in_(tids))
        out = list(db.scalars(select(Course).where(Course.kind == "catalog", Course.archived_at.is_(None), or_(Course.term_id.in_(tids), Course.id.in_(shared)))))
        mates = select(User.id).where(User.program_id == user.program_id, User.id != user.id)
        out += list(db.scalars(select(Course).where(Course.kind == "personal", Course.visibility == "program", Course.status == "ready",
                                                    Course.archived_at.is_(None), Course.owner_id.in_(mates))))
    out += list(db.scalars(select(Course).where(Course.kind == "personal", Course.owner_id == user.id)))
    return out
