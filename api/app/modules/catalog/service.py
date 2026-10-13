"""Programs, terms, courses, units and topics (R-PROG-*, R-CRS-*)."""
from __future__ import annotations

import datetime as dt
import re
from collections import defaultdict

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.db import get_or_404, utcnow
from app.core.errors import AppError
from app.modules.admin.service import audit
from app.modules.users.models import User

from . import content as content_rules
from . import policy
from .models import PATTERNS, Course, CourseShare, Program, Term, Topic, TopicVersion, Unit

VERSIONS_KEPT = 100


# ---------- programs and terms ----------

def program_names(db: Session) -> dict[int, str]:
    return dict(db.execute(select(Program.id, Program.name)).all())


def term_label(pattern: str) -> str:
    return PATTERNS.get(pattern, PATTERNS["semester"])[0]


def max_terms(pattern: str) -> int:
    return PATTERNS.get(pattern, PATTERNS["semester"])[1]


def check_placement(db: Session, program_id: int | None, term_no: int | None) -> tuple[int | None, int | None]:
    if not program_id:
        return None, None
    program = get_or_404(db, Program, program_id, "program")
    if term_no is not None and not 1 <= term_no <= max_terms(program.pattern):
        raise AppError("program.term_out_of_range", 400, max=max_terms(program.pattern), term=term_label(program.pattern))
    return program.id, term_no


def _unique_program_name(db: Session, name: str, keep: int | None = None) -> str:
    name = name.strip()
    if not name:
        raise AppError("program.name_required")
    if db.scalar(select(Program.id).where(func.lower(Program.name) == name.lower(), Program.id != (keep or 0))):
        raise AppError("program.name_taken", 409)
    return name


def create_program(db: Session, actor: User, name: str, pattern: str, terms: int | None) -> Program:
    if pattern not in PATTERNS:
        raise AppError("program.pattern_invalid")
    label, most, default = PATTERNS[pattern]
    count = default if terms is None else terms
    if not 0 <= count <= most:
        raise AppError("program.terms_out_of_range", 400, max=most)
    program = Program(name=_unique_program_name(db, name), pattern=pattern)
    db.add(program)
    db.flush()
    for n in range(1, count + 1):  # R-PROG-2
        db.add(Term(program_id=program.id, number=n, name=f"{label} {n}"))
    audit(db, actor.id, "program.create", f"program:{program.id}", terms=count)
    db.commit()
    return program


def update_program(db: Session, actor: User, program_id: int, name: str | None, pattern: str | None) -> Program:
    program = get_or_404(db, Program, program_id, "program")
    if name is not None:
        program.name = _unique_program_name(db, name, program.id)
    if pattern and pattern != program.pattern:
        if pattern not in PATTERNS:
            raise AppError("program.pattern_invalid")
        terms = list(db.scalars(select(Term).where(Term.program_id == program.id)))
        if any(t.number > max_terms(pattern) for t in terms):
            raise AppError("program.terms_do_not_fit", 400, max=max_terms(pattern))  # R-PROG-5
        old = term_label(program.pattern)
        for t in terms:
            if re.fullmatch(rf"{old} \d+", t.name):
                t.name = f"{term_label(pattern)} {t.number}"
        program.pattern = pattern
        if pattern == "grade":  # a school runs Grade 1 to 12
            have = {t.number for t in terms}
            for n in range(1, 13):
                if terms and n not in have:
                    db.add(Term(program_id=program.id, number=n, name=f"Grade {n}"))
    audit(db, actor.id, "program.update", f"program:{program.id}")
    db.commit()
    return program


def add_term(db: Session, actor: User, program_id: int, number: int, name: str) -> Term:
    program = get_or_404(db, Program, program_id, "program")
    if not 1 <= number <= max_terms(program.pattern):
        raise AppError("program.term_out_of_range", 400, max=max_terms(program.pattern), term=term_label(program.pattern))
    if db.scalar(select(Term.id).where(Term.program_id == program.id, Term.number == number)):
        raise AppError("term.number_taken", 409, number=number)
    term = Term(program_id=program.id, number=number, name=name.strip() or f"{term_label(program.pattern)} {number}")
    db.add(term)
    audit(db, actor.id, "term.create", f"program:{program.id}", number=number)
    db.commit()
    return term


def update_term(db: Session, actor: User, term_id: int, name: str | None, number: int | None) -> Term:
    term = get_or_404(db, Term, term_id, "term")
    program = db.get(Program, term.program_id)
    if number is not None and number != term.number:
        if not 1 <= number <= max_terms(program.pattern):
            raise AppError("program.term_out_of_range", 400, max=max_terms(program.pattern), term=term_label(program.pattern))
        if db.scalar(select(Term.id).where(Term.program_id == program.id, Term.number == number)):
            raise AppError("term.number_taken", 409, number=number)
        term.number = number
    if name is not None and name.strip():
        term.name = name.strip()[:150]
    audit(db, actor.id, "term.update", f"term:{term.id}")
    db.commit()
    return term


def rollover(db: Session, actor: User, program_id: int, finishing: str, dry_run: bool) -> dict:
    """Start of a new term: every active student moves up one; those in the last term stay or are deactivated (R-PROG-6)."""
    program = get_or_404(db, Program, program_id, "program")
    numbers = [n for (n,) in db.execute(select(Term.number).where(Term.program_id == program.id))]
    last = max(numbers) if numbers else max_terms(program.pattern)
    students = list(db.scalars(select(User).where(User.program_id == program.id, User.role == "student", User.active.is_(True)).order_by(User.name)))
    moving = [s for s in students if s.term_no and s.term_no < last]
    staying = [s for s in students if s.term_no and s.term_no >= last]
    unplaced = [s for s in students if not s.term_no]
    if not dry_run:
        for s in moving:
            s.term_no += 1
        if finishing == "deactivate":
            from app.modules.auth.service import new_session_key
            for s in staying:
                s.active, s.session_key = False, new_session_key()
        audit(db, actor.id, "program.rollover", f"program:{program.id}", moved=len(moving), finishing=finishing)
        db.commit()
    names = lambda people: [p.name for p in people[:20]]  # noqa: E731
    return {"dry_run": dry_run, "last_term": last, "term": term_label(program.pattern), "moving": len(moving), "finishing": len(staying),
            "unplaced": len(unplaced), "finishing_names": names(staying), "unplaced_names": names(unplaced)}


def programs_overview(db: Session) -> list[dict]:
    terms = defaultdict(list)
    for t in db.scalars(select(Term).order_by(Term.number)):
        terms[t.program_id].append(t)
    courses = defaultdict(int)
    for tid, n in db.execute(select(Course.term_id, func.count(Course.id)).where(Course.kind == "catalog").group_by(Course.term_id)):
        courses[tid] = n
    students = dict(db.execute(select(User.program_id, func.count(User.id)).where(User.role == "student", User.active.is_(True)).group_by(User.program_id)).all())
    return [{"id": p.id, "name": p.name, "pattern": p.pattern, "term_label": term_label(p.pattern), "archived": bool(p.archived_at),
             "students": students.get(p.id, 0), "terms": [{"id": t.id, "number": t.number, "name": t.name, "archived": bool(t.archived_at), "courses": courses[t.id]} for t in terms[p.id]]}
            for p in db.scalars(select(Program).order_by(Program.name))]


# ---------- courses ----------

def owner_name(db: Session, course: Course) -> str:
    owner = db.get(User, course.owner_id) if course.owner_id else None
    return owner.name if owner else ""


def _check_owner(db: Session, owner_id: int | None) -> int | None:
    if not owner_id:
        return None
    owner = db.get(User, owner_id)
    if not owner or owner.role != "faculty" or not owner.active:
        raise AppError("course.owner_must_be_faculty", 400)
    return owner.id


def create_catalog_course(db: Session, actor: User, title: str, term_id: int, owner_id: int | None, description: str = "") -> Course:
    term = get_or_404(db, Term, term_id, "term")
    course = Course(kind="catalog", title=_title(title, "course"), term_id=term.id, owner_id=_check_owner(db, owner_id), description=description)
    db.add(course)
    db.flush()
    audit(db, actor.id, "course.create", f"course:{course.id}")
    db.commit()
    return course


def create_personal_course(db: Session, actor: User, title: str) -> Course:
    if db.scalar(select(func.count(Course.id)).where(Course.kind == "personal", Course.owner_id == actor.id)) >= 50:
        raise AppError("course.personal_limit", 400, max=50)  # R-PER-1
    course = Course(kind="personal", title=_title(title, "course"), owner_id=actor.id, status="setup")
    db.add(course)
    db.commit()
    return course


def update_course(db: Session, actor: User, course: Course, patch: dict) -> Course:
    if "title" in patch and patch["title"] is not None:
        course.title = _title(patch["title"], "course")
    if "description" in patch and patch["description"] is not None:
        course.description = patch["description"][:4000]
    if course.kind == "catalog":
        if "owner_id" in patch:
            if actor.role != "admin":
                raise AppError("auth.forbidden", 403)
            course.owner_id = _check_owner(db, patch["owner_id"])  # content and progress untouched (R-CRS-2)
        if patch.get("term_id") and patch["term_id"] != course.term_id:
            if actor.role != "admin":
                raise AppError("auth.forbidden", 403)
            course.term_id = get_or_404(db, Term, patch["term_id"], "term").id
            db.execute(delete(CourseShare).where(CourseShare.course_id == course.id, CourseShare.term_id == course.term_id))
    elif "visibility" in patch and patch["visibility"]:
        if patch["visibility"] not in ("private", "program"):
            raise AppError("course.visibility_invalid")
        if patch["visibility"] == "program" and not (db.get(User, course.owner_id) or actor).program_id:
            raise AppError("course.no_classmates", 400)
        course.visibility = patch["visibility"]
    audit(db, actor.id, "course.update", f"course:{course.id}", fields=sorted(patch))
    db.commit()
    return course


def set_shares(db: Session, actor: User, course: Course, term_ids: list[int]) -> list[int]:
    if course.kind != "catalog":
        raise AppError("course.not_catalog")
    wanted = {t for t in term_ids if t != course.term_id}
    if len(list(db.scalars(select(Term.id).where(Term.id.in_(wanted or {0}))))) != len(wanted):
        raise AppError("term.not_found", 404)
    db.execute(delete(CourseShare).where(CourseShare.course_id == course.id))
    for t in wanted:
        db.add(CourseShare(course_id=course.id, term_id=t))
    audit(db, actor.id, "course.share", f"course:{course.id}", terms=sorted(wanted))
    db.commit()
    return sorted(wanted)


def course_row(db: Session, user: User, c: Course) -> dict:
    return {"id": c.id, "kind": c.kind, "title": c.title, "description": c.description, "term_id": c.term_id, "owner_id": c.owner_id,
            "owner": owner_name(db, c), "visibility": c.visibility, "status": c.status, "archived": bool(c.archived_at),
            "can_edit": policy.can_edit(user, c), "mine": c.owner_id == user.id,
            "shared_terms": [t for (t,) in db.execute(select(CourseShare.term_id).where(CourseShare.course_id == c.id))] if c.kind == "catalog" else []}


def outline(db: Session, user: User, c: Course) -> list[dict]:
    """Units and topics in order; drafts and archived items only for editors."""
    edit = policy.can_edit(user, c)
    units = list(db.scalars(select(Unit).where(Unit.course_id == c.id).order_by(Unit.position, Unit.id)))
    by_unit = defaultdict(list)
    for t in db.scalars(select(Topic).where(Topic.unit_id.in_([u.id for u in units] or [0])).order_by(Topic.position, Topic.id)):
        by_unit[t.unit_id].append(t)
    out = []
    for u in units:
        if u.archived_at and not edit:
            continue
        topics = [t for t in by_unit[u.id] if edit or (t.published and not t.archived_at)]
        out.append({"id": u.id, "title": u.title, "archived": bool(u.archived_at), "topics": [
            {"id": t.id, "title": t.title, "summary": t.summary, "published": t.published, "archived": bool(t.archived_at),
             "due_at": t.due_at.isoformat() + "Z" if t.due_at else None} for t in topics]})
    return out


def _term_name(db: Session, term_id: int | None) -> str:
    t = db.get(Term, term_id) if term_id else None
    return t.name if t else ""


def browse(db: Session, user: User) -> dict:
    """What a person can open: catalog courses grouped by program and term, and personal courses (theirs, and shared by classmates)."""
    courses = policy.visible_courses(db, user)
    catalog = [c for c in courses if c.kind == "catalog"]
    term_ids = {c.term_id for c in catalog} | {s for c in catalog for s in db.scalars(select(CourseShare.term_id).where(CourseShare.course_id == c.id))}
    terms = {t.id: t for t in db.scalars(select(Term).where(Term.id.in_(term_ids or {0})))}
    if user.role == "student":
        terms = {i: t for i, t in terms.items() if policy.term_open_to(user, t)}
    programs = {p.id: p for p in db.scalars(select(Program).where(Program.id.in_({t.program_id for t in terms.values()} or {0})))}
    grouped: dict[int, dict] = {}
    for c in catalog:
        places = [c.term_id] + [s for s in db.scalars(select(CourseShare.term_id).where(CourseShare.course_id == c.id))]
        for tid in places:
            t = terms.get(tid)
            if not t:
                continue
            g = grouped.setdefault(t.id, {"term_id": t.id, "term": t.name, "number": t.number, "program_id": t.program_id,
                                          "program": programs[t.program_id].name, "current": user.term_no == t.number and user.program_id == t.program_id, "courses": []})
            g["courses"].append(course_row(db, user, c) | {"shared_from": None if tid == c.term_id else _term_name(db, c.term_id)})
    personal = [course_row(db, user, c) for c in courses if c.kind == "personal"]
    return {"terms": sorted(grouped.values(), key=lambda g: (g["program"], g["number"])), "personal": personal}


# ---------- units ----------

def _title(value: str, what: str, limit: int = 200) -> str:
    value = (value or "").strip()
    if not value:
        raise AppError(f"{what}.title_required")
    if len(value) > limit:
        raise AppError(f"{what}.title_too_long", 400, max=limit)
    return value


def _next_position(db: Session, model, **where) -> int:
    col = model.position
    stmt = select(func.coalesce(func.max(col), -1))
    for k, v in where.items():
        stmt = stmt.where(getattr(model, k) == v)
    return (db.scalar(stmt) or 0) + 1


def create_unit(db: Session, actor: User, course: Course, title: str) -> Unit:
    unit = Unit(course_id=course.id, title=_title(title, "unit"), position=_next_position(db, Unit, course_id=course.id))
    db.add(unit)
    db.flush()
    audit(db, actor.id, "unit.create", f"unit:{unit.id}")
    db.commit()
    return unit


def reorder(db: Session, model, parent_field: str, parent_id: int, ids: list[int]) -> None:
    rows = {r.id: r for r in db.scalars(select(model).where(getattr(model, parent_field) == parent_id))}
    if set(ids) != set(rows):
        raise AppError("order.mismatch", 400)
    for pos, i in enumerate(ids):
        rows[i].position = pos
    db.commit()


# ---------- topics ----------

VFIELDS = ("title", "content", "content_format", "question_pattern", "sample_answer", "answer_guide")


def topic_state(t: Topic) -> dict:
    return {k: getattr(t, k) or "" for k in VFIELDS}


VERSION_MERGE_MINUTES = 10


def record_version(db: Session, t: Topic, before: dict | None, user_id: int, note: str) -> None:
    now = topic_state(t)
    if before is not None and before == now:
        return
    db.flush()
    last = db.scalar(select(TopicVersion).where(TopicVersion.topic_id == t.id).order_by(TopicVersion.id.desc()).limit(1))
    if note == "edited" and last and last.note == "edited" and last.saved_by == user_id and last.saved_at > utcnow() - dt.timedelta(minutes=VERSION_MERGE_MINUTES):
        for k, v in now.items():  # autosave: one person's run of edits is one version, not one per keystroke pause
            setattr(last, k, v)
        last.saved_at = utcnow()
        return
    db.add(TopicVersion(topic_id=t.id, saved_by=user_id, note=note[:200], **now))
    db.flush()
    old = list(db.scalars(select(TopicVersion.id).where(TopicVersion.topic_id == t.id).order_by(TopicVersion.id.desc()).offset(VERSIONS_KEPT)))
    if old:
        db.execute(delete(TopicVersion).where(TopicVersion.id.in_(old)))


def create_topic(db: Session, actor: User, unit: Unit, course: Course, data: dict) -> Topic:
    fmt = data.get("content_format") or "markdown"
    t = Topic(unit_id=unit.id, title=_title(data.get("title", ""), "topic"), content=content_rules.stored(data.get("content", ""), fmt), content_format=fmt,
              summary=(data.get("summary") or "")[:300], question_pattern=data.get("question_pattern") or "", sample_answer=data.get("sample_answer") or "",
              answer_guide=data.get("answer_guide") or "", published=data.get("published", course.kind == "personal" or actor.role == "admin"),
              due_at=data.get("due_at"), position=_next_position(db, Topic, unit_id=unit.id))
    db.add(t)
    db.flush()
    record_version(db, t, None, actor.id, "created")
    audit(db, actor.id, "topic.create", f"topic:{t.id}")
    db.commit()
    return t


def update_topic(db: Session, actor: User, t: Topic, course: Course, data: dict) -> Topic:
    before = topic_state(t)
    if "title" in data and data["title"] is not None:
        t.title = _title(data["title"], "topic")
    fmt = data.get("content_format") or t.content_format
    if "content_format" in data or "content" in data:
        t.content_format = fmt
        t.content = content_rules.stored(data.get("content", t.content), fmt)
    for k in ("summary", "question_pattern", "sample_answer", "answer_guide"):
        if k in data and data[k] is not None:
            setattr(t, k, data[k][:300] if k == "summary" else data[k])
    if "published" in data and data["published"] is not None:
        t.published = data["published"]
    if "due_at" in data:
        t.due_at = data["due_at"]
    if data.get("unit_id") and data["unit_id"] != t.unit_id:
        target = get_or_404(db, Unit, data["unit_id"], "unit")
        if target.course_id != course.id and actor.role != "admin":
            raise AppError("topic.move_within_course", 403)
        t.unit_id, t.position = target.id, _next_position(db, Topic, unit_id=target.id)
    record_version(db, t, before, actor.id, "edited")
    audit(db, actor.id, "topic.update", f"topic:{t.id}")
    db.commit()
    return t


def versions(db: Session, t: Topic) -> list[dict]:
    names = dict(db.execute(select(User.id, User.name)).all())
    cur = topic_state(t)
    return [{"id": v.id, "saved_at": v.saved_at.isoformat() + "Z", "by": names.get(v.saved_by, ""), "note": v.note,
             "current": all((getattr(v, k) or "") == cur[k] for k in VFIELDS)}
            for v in db.scalars(select(TopicVersion).where(TopicVersion.topic_id == t.id).order_by(TopicVersion.id.desc()))]


def restore_version(db: Session, actor: User, t: Topic, version_id: int) -> Topic:
    v = get_or_404(db, TopicVersion, version_id, "version")
    if v.topic_id != t.id:
        raise AppError("version.not_found", 404)
    before = topic_state(t)
    for k in VFIELDS:
        setattr(t, k, getattr(v, k) or "")
    record_version(db, t, before, actor.id, "restored")  # R-CRS-6: putting one back is itself a new version
    db.commit()
    return t


def copy_topic(db: Session, actor: User, t: Topic, target: Unit) -> Topic:
    taken = {x.lower() for (x,) in db.execute(select(Topic.title).where(Topic.unit_id == target.id))}
    title = t.title if t.title.lower() not in taken else _free_name(taken, t.title)
    n = Topic(unit_id=target.id, title=title, summary=t.summary, content=t.content, content_format=t.content_format, question_pattern=t.question_pattern,
              sample_answer=t.sample_answer, answer_guide=t.answer_guide, published=False, position=_next_position(db, Topic, unit_id=target.id))
    db.add(n)
    db.flush()
    record_version(db, n, None, actor.id, f"copied from topic {t.id}")
    db.commit()
    return n


def copy_unit(db: Session, actor: User, u: Unit, target: Course, include_drafts: bool) -> Unit:
    taken = {x.lower() for (x,) in db.execute(select(Unit.title).where(Unit.course_id == target.id))}
    nu = Unit(course_id=target.id, title=u.title if u.title.lower() not in taken else _free_name(taken, u.title), position=_next_position(db, Unit, course_id=target.id))
    db.add(nu)
    db.flush()
    for t in db.scalars(select(Topic).where(Topic.unit_id == u.id).order_by(Topic.position, Topic.id)):
        if t.published or include_drafts:
            db.add(Topic(unit_id=nu.id, title=t.title, summary=t.summary, content=t.content, content_format=t.content_format, question_pattern=t.question_pattern,
                         sample_answer=t.sample_answer, answer_guide=t.answer_guide, published=False, position=t.position))
    db.commit()
    return nu


def _free_name(taken: set[str], name: str) -> str:
    n = 1
    while True:
        cand = f"{name} (copy{'' if n == 1 else ' ' + str(n)})"
        if cand.lower() not in taken:
            return cand
        n += 1


# ---------- archive and delete ----------

ARCHIVABLE = {"program": Program, "term": Term, "course": Course, "unit": Unit, "topic": Topic}


def parent_archived(db: Session, kind: str, row) -> bool:
    if kind == "term":
        return bool(db.get(Program, row.program_id).archived_at)
    if kind == "course" and row.term_id:
        t = db.get(Term, row.term_id)
        return bool(t.archived_at or db.get(Program, t.program_id).archived_at)
    if kind == "unit":
        return bool(db.get(Course, row.course_id).archived_at)
    if kind == "topic":
        return bool(db.get(Unit, row.unit_id).archived_at)
    return False


def set_archived(db: Session, actor: User, kind: str, row, on: bool) -> None:
    if not on and parent_archived(db, kind, row):
        raise AppError("archive.parent_archived", 400)  # R-CRS-5: restore the parent first
    row.archived_at = utcnow() if on else None
    audit(db, actor.id, f"{kind}.{'archive' if on else 'restore'}", f"{kind}:{row.id}")
    db.commit()


def remove(db: Session, actor: User, kind: str, row) -> None:
    db.delete(row)  # foreign keys cascade to everything under it
    audit(db, actor.id, f"{kind}.delete", f"{kind}:{row.id}")
    db.commit()
