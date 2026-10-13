"""R-REP-1: a course's class picture and one student's picture, on screen or as CSV."""
from __future__ import annotations

import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_or_404, utcnow
from app.core.errors import AppError
from app.modules.assessment import service as asm
from app.modules.assessment.models import Quiz
from app.modules.assessment.results import csv_response, gradebook, stats
from app.modules.catalog import policy
from app.modules.catalog.models import Course, Topic, Unit
from app.modules.learning import service as learning
from app.modules.learning.models import TopicProgress
from app.modules.users.models import User


def _live_topics(db: Session, course: Course) -> list[int]:
    return list(db.scalars(select(Topic.id).join(Unit, Unit.id == Topic.unit_id).where(
        Unit.course_id == course.id, Unit.archived_at.is_(None), Topic.archived_at.is_(None), Topic.published.is_(True))))


def _test_ids(db: Session, course: Course) -> list[int]:
    return list(db.scalars(select(Quiz.id).where(Quiz.course_id == course.id, Quiz.kind == "test", Quiz.published.is_(True))))


def course_report(db: Session, course: Course, as_csv: bool = False):
    topics = _live_topics(db, course)
    book = gradebook(db, course)
    finals = {r["user_id"]: r for r in book["students"]}
    ids = list(finals)
    done = dict(db.execute(select(TopicProgress.user_id, func.count(TopicProgress.id)).where(
        TopicProgress.user_id.in_(ids or [0]), TopicProgress.topic_id.in_(topics or [0]), TopicProgress.completed_at.isnot(None)).group_by(TopicProgress.user_id)).all())
    seen = dict(db.execute(select(TopicProgress.user_id, func.max(TopicProgress.last_opened_at)).where(
        TopicProgress.user_id.in_(ids or [0]), TopicProgress.topic_id.in_(topics or [0])).group_by(TopicProgress.user_id)).all())
    rows = [{"user_id": r["user_id"], "name": r["name"], "email": r["email"], "completed": done.get(r["user_id"], 0),
             "completion": round(100 * done.get(r["user_id"], 0) / len(topics)) if topics else 0, "tests_taken": r["taken"], "final": r["final"],
             "last_active": seen[r["user_id"]].isoformat() + "Z" if seen.get(r["user_id"]) else None} for r in book["students"]]
    batches = [(q, qs, d) for _, q, qs, d in asm.latest_batches(db, ids, _test_ids(db, course))]
    areas = asm.strengths(db, batches, staff=True)
    if as_csv:
        return csv_response(f"course-{course.id}.csv", ["name", "email", "topics_completed", "completion_percent", "tests_taken", "final_percent", "last_active"],
                            [[r["name"], r["email"], r["completed"], r["completion"], r["tests_taken"], r["final"], r["last_active"]] for r in rows])
    started = sum(1 for r in rows if r["last_active"])
    return {"course": {"id": course.id, "title": course.title}, "topics": len(topics), "students": rows,
            "summary": {"students": len(rows), "started": started, "completion": stats([r["completion"] for r in rows])["average"],
                        "final": book["summary"]}, "weak_areas": [a for a in areas if a["status"] != "strong"][:10]}


def student_report(db: Session, staff: User, student: User) -> dict:
    """Every catalog course the student can see that this staff member can edit (admins: all of them)."""
    courses = [c for c in policy.visible_courses(db, student) if c.kind == "catalog" and policy.can_edit(staff, c)]
    out = []
    for c in courses:
        topics = _live_topics(db, c)
        done = db.scalar(select(func.count(TopicProgress.id)).where(TopicProgress.user_id == student.id, TopicProgress.topic_id.in_(topics or [0]),
                                                                    TopicProgress.completed_at.isnot(None))) or 0
        row = next((r for r in gradebook(db, c)["students"] if r["user_id"] == student.id), None)
        out.append({"id": c.id, "title": c.title, "topics": len(topics), "completed": done, "completion": round(100 * done / len(topics)) if topics else 0,
                    "tests_taken": row["taken"] if row else 0, "final": row["final"] if row else None})
    tests = [q for c in courses for q in _test_ids(db, c)]
    areas = asm.strengths(db, [(q, qs, d) for _, q, qs, d in asm.latest_batches(db, [student.id], tests)], staff=True)
    today = utcnow().date()
    days = learning.study_days(db, student.id, today - dt.timedelta(days=400))
    return {"student": {"id": student.id, "name": student.name, "email": student.email, "last_seen": student.last_seen_at.isoformat() + "Z" if student.last_seen_at else None},
            "courses": out, "areas": areas, "summary": asm.summary_line(areas), "streak": learning.streak(days, today),
            "level": learning.level_of(learning.points(db, student.id))}


def student_for(db: Session, staff: User, user_id: int) -> User:
    s = get_or_404(db, User, user_id, "user")
    if s.role != "student":
        raise AppError("user.not_a_student", 400)
    return s
