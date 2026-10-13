"""The learning engine: one set of rules for every topic, catalog or personal (R-LRN-*)."""
from __future__ import annotations

import datetime as dt
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.modules.catalog import policy
from app.modules.catalog.models import Course, Topic, Unit
from app.modules.users.models import User

from .models import TopicProgress

REVIEW_DAYS = [1, 3, 7, 14, 30]  # R-LRN-3
PASS, MASTER, GOOD, POOR = 60, 90, 80, 60
DUE_SOON_DAYS = 3


def iso(t: dt.datetime | None) -> str | None:
    return t.isoformat() + "Z" if t else None


def tracks(user: User, course: Course) -> bool:
    """Progress is kept for students, and for anyone studying a personal course; staff browsing catalog courses leave no trace."""
    return user.role == "student" or course.kind == "personal"


def deadline_state(due: dt.datetime | None, completed: dt.datetime | None, now: dt.datetime) -> str | None:
    if not due:
        return None
    if completed:
        return "late" if completed > due else "on_time"
    if now > due:
        return "overdue"
    return "due_soon" if (due - now).days < DUE_SOON_DAYS else "upcoming"


def schedule_review(p: TopicProgress, ratio: float, now: dt.datetime) -> None:
    step = p.review_step or 0
    if ratio >= GOOD / 100:
        step = min(step + 1, len(REVIEW_DAYS))
    elif ratio < POOR / 100:
        step = 0
    p.review_step, p.review_due = step, now + dt.timedelta(days=REVIEW_DAYS[max(step - 1, 0)])


def progress_row(db: Session, user_id: int, topic_id: int) -> TopicProgress:
    p = db.scalar(select(TopicProgress).where(TopicProgress.user_id == user_id, TopicProgress.topic_id == topic_id))
    if not p:
        p = TopicProgress(user_id=user_id, topic_id=topic_id)
        db.add(p)
        db.flush()
    return p


def best_full_scores(db: Session, user_id: int, topic_ids: list[int]) -> dict[int, int]:
    """Best result of a full quiz on each topic (practice in full mode, written for that topic)."""
    from app.modules.assessment.models import Attempt, Quiz
    if not topic_ids:
        return {}
    rows = db.execute(select(Quiz.topic_id, func.max(Attempt.percent)).join(Attempt, Attempt.quiz_id == Quiz.id)
                      .where(Quiz.topic_id.in_(topic_ids), Quiz.kind == "practice", Quiz.mode == "full", Attempt.user_id == user_id).group_by(Quiz.topic_id))
    return {tid: p for tid, p in rows}


def stars(db: Session, user_id: int, topic_ids: list[int]) -> dict[int, int]:
    """R-LRN-2: 1 completed, 2 passed a quiz, 3 mastered."""
    if not topic_ids:
        return {}
    done = set(db.scalars(select(TopicProgress.topic_id).where(TopicProgress.user_id == user_id, TopicProgress.topic_id.in_(topic_ids),
                                                              TopicProgress.completed_at.isnot(None))))
    best = best_full_scores(db, user_id, topic_ids)
    return {t: 3 if best.get(t, 0) >= MASTER else 2 if best.get(t, 0) >= PASS else 1 if t in done else 0 for t in topic_ids}


def open_topic(db: Session, user: User, t: Topic) -> dict:
    course = db.get(Course, db.get(Unit, t.unit_id).course_id)
    now = utcnow()
    p = None
    if tracks(user, course):
        p = progress_row(db, user.id, t.id)
        p.last_opened_at = now
        db.commit()
    return {"tracked": p is not None, "status": "completed" if p and p.completed_at else "in_progress" if p else "not_started",
            "completed_at": iso(p.completed_at) if p else None, "deadline": deadline_state(t.due_at, p.completed_at if p else None, now),
            "stars": stars(db, user.id, [t.id]).get(t.id, 0), "review_due": iso(p.review_due) if p else None,
            "review_now": bool(p and p.review_due and p.review_due <= now)}


def set_completed(db: Session, user: User, t: Topic, on: bool) -> dict:
    p = progress_row(db, user.id, t.id)
    p.completed_at = (p.completed_at or utcnow()) if on else None
    db.commit()
    return {"status": "completed" if on else "in_progress", "completed_at": iso(p.completed_at), "stars": stars(db, user.id, [t.id]).get(t.id, 0),
            "deadline": deadline_state(t.due_at, p.completed_at, utcnow())}


def decorate_course(db: Session, user: User, course: Course, units: list[dict]) -> dict:
    """Adds each topic's status, stars and review state to a course outline, and the course's own numbers."""
    ids = [t["id"] for u in units for t in u["topics"]]
    if not tracks(user, course):
        return {"progress": None}
    rows = {p.topic_id: p for p in db.scalars(select(TopicProgress).where(TopicProgress.user_id == user.id, TopicProgress.topic_id.in_(ids or [0])))}
    st, now = stars(db, user.id, ids), utcnow()
    for u in units:
        for t in u["topics"]:
            p = rows.get(t["id"])
            due = dt.datetime.fromisoformat(t["due_at"].rstrip("Z")) if t["due_at"] else None
            t.update(status="completed" if p and p.completed_at else "in_progress" if p else "not_started", stars=st.get(t["id"], 0),
                     review_now=bool(p and p.review_due and p.review_due <= now), deadline=deadline_state(due, p.completed_at if p else None, now))
    topics = [t for u in units for t in u["topics"] if t["published"] and not t["archived"]]
    done = sum(t["status"] == "completed" for t in topics)
    nxt = next((t for t in topics if t["status"] != "completed"), None)
    return {"progress": {"topics": len(topics), "completed": done, "mastery": round(100 * sum(t["stars"] for t in topics) / (3 * len(topics))) if topics else 0,
                         "reviews_due": sum(t["review_now"] for t in topics), "next": {"id": nxt["id"], "title": nxt["title"]} if nxt else None}}


# ---------- points, levels, streak ----------

def points(db: Session, user_id: int) -> int:
    """R-LRN-4, derived from what the learner did (ARCHITECTURE rule 5)."""
    from app.modules.assessment.models import Attempt, Quiz
    done = db.scalar(select(func.count(TopicProgress.id)).where(TopicProgress.user_id == user_id, TopicProgress.completed_at.isnot(None))) or 0
    right = db.scalar(select(func.coalesce(func.sum(Attempt.score), 0)).where(Attempt.user_id == user_id)) or 0
    best = [p for _, p in db.execute(select(Quiz.topic_id, func.max(Attempt.percent)).join(Attempt, Attempt.quiz_id == Quiz.id)
                                     .where(Attempt.user_id == user_id, Quiz.kind == "practice", Quiz.mode == "full").group_by(Quiz.topic_id))]
    reviews = db.scalar(select(func.count(Attempt.id)).join(Quiz, Quiz.id == Attempt.quiz_id).where(Attempt.user_id == user_id, Quiz.kind == "review")) or 0
    return 10 * done + int(right) + 20 * sum(p >= PASS for p in best) + 30 * sum(p >= MASTER for p in best) + 5 * reviews


def level_of(total: int) -> dict:
    n = 1
    while 50 * (n + 1) * n <= total:
        n += 1
    lo, hi = 50 * n * (n - 1), 50 * (n + 1) * n
    return {"points": total, "level": n, "into": total - lo, "span": hi - lo}


def study_days(db: Session, user_id: int, since: dt.date) -> set[dt.date]:
    from app.modules.assessment.models import Attempt
    start = dt.datetime.combine(since, dt.time())
    days = {t.date() for (t,) in db.execute(select(TopicProgress.last_opened_at).where(TopicProgress.user_id == user_id, TopicProgress.last_opened_at >= start))}
    days |= {t.date() for (t,) in db.execute(select(TopicProgress.opened_at).where(TopicProgress.user_id == user_id, TopicProgress.opened_at >= start))}
    days |= {t.date() for (t,) in db.execute(select(Attempt.at).where(Attempt.user_id == user_id, Attempt.at >= start))}
    return days


def streak(days: set[dt.date], today: dt.date) -> int:
    d = today if today in days else today - dt.timedelta(days=1)  # not having studied yet today doesn't break it
    n = 0
    while d in days:
        n += 1
        d -= dt.timedelta(days=1)
    return n


def home(db: Session, user: User) -> dict:
    """R-LRN-6: one next step, then the numbers that show progress."""
    now = utcnow()
    today = now.date()
    courses = [c for c in policy.visible_courses(db, user) if c.status == "ready" and not c.archived_at and tracks(user, c)]
    cmap = {c.id: c for c in courses}
    units = {u.id: u for u in db.scalars(select(Unit).where(Unit.course_id.in_(list(cmap) or [0]), Unit.archived_at.is_(None)))}
    topics = list(db.scalars(select(Topic).where(Topic.unit_id.in_(list(units) or [0]), Topic.published.is_(True), Topic.archived_at.is_(None))
                             .order_by(Topic.position, Topic.id)))
    course_of = {t.id: units[t.unit_id].course_id for t in topics}
    prog = {p.topic_id: p for p in db.scalars(select(TopicProgress).where(TopicProgress.user_id == user.id, TopicProgress.topic_id.in_(list(course_of) or [0])))}
    overdue = [{"topic_id": t.id, "title": t.title, "course_id": course_of[t.id], "course": cmap[course_of[t.id]].title, "due_at": iso(t.due_at)}
               for t in topics if t.due_at and t.due_at < now and not (prog.get(t.id) and prog[t.id].completed_at)]
    soon = [{"topic_id": t.id, "title": t.title, "course_id": course_of[t.id], "course": cmap[course_of[t.id]].title, "due_at": iso(t.due_at)}
            for t in topics if t.due_at and now <= t.due_at < now + dt.timedelta(days=DUE_SOON_DAYS) and not (prog.get(t.id) and prog[t.id].completed_at)]
    due_by = defaultdict(int)
    for tid, p in prog.items():
        if p.review_due and p.review_due <= now:
            due_by[course_of[tid]] += 1
    order = {u.id: (u.position, u.id) for u in units.values()}
    nxt = None
    recent = sorted(prog.values(), key=lambda p: p.last_opened_at, reverse=True)
    ordered_courses = list(dict.fromkeys([course_of[p.topic_id] for p in recent] + list(cmap)))
    for cid in ordered_courses:
        ts = sorted([t for t in topics if course_of[t.id] == cid], key=lambda t: (order[t.unit_id], t.position, t.id))
        t = next((t for t in ts if not (prog.get(t.id) and prog[t.id].completed_at)), None)
        if t:
            done = sum(1 for x in ts if prog.get(x.id) and prog[x.id].completed_at)
            nxt = {"topic_id": t.id, "title": t.title, "course_id": cid, "course": cmap[cid].title, "done": done, "topics": len(ts)}
            break
    days = study_days(db, user.id, today - dt.timedelta(days=400))
    week = [{"date": (today - dt.timedelta(days=i)).isoformat(), "active": (today - dt.timedelta(days=i)) in days, "today": i == 0} for i in range(6, -1, -1)]
    return {"next": nxt, "overdue": overdue[:10], "due_soon": soon[:10], "reviews": [{"course_id": cid, "course": cmap[cid].title, "due": n} for cid, n in due_by.items()],
            "reviews_due": sum(due_by.values()), "streak": streak(days, today), "studied_today": today in days, "week": week,
            "level": level_of(points(db, user.id)), "courses": len(courses),
            "completed_week": sum(1 for p in prog.values() if p.completed_at and p.completed_at.date() > today - dt.timedelta(days=7))}
