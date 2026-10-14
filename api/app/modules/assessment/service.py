"""Quizzes of every kind, grading and strengths (R-ASM-*, R-LRN-1/3/7)."""
from __future__ import annotations

import random
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_or_404, utcnow
from app.core.errors import AppError
from app.modules.admin.service import audit
from app.modules.catalog import content, policy
from app.modules.catalog.models import Course, Topic, Unit
from app.modules.learning import service as learning
from app.modules.users.models import User

from .models import Attempt, Question, Quiz

STRONG, WEAK = 80, 60
QUICK_SIZE, FULL_SIZE, REVIEW_SIZE = 5, 10, 10


def iso(t):
    return t.isoformat() + "Z" if t else None


def max_questions(q: Quiz) -> int:
    return 100 if q.unit_id else 200  # R-ASM-1


# ---------- access ----------

def quiz_for(db: Session, user: User, quiz_id: int, edit: bool = False) -> tuple[Quiz, Course]:
    q = get_or_404(db, Quiz, quiz_id, "quiz")
    course = policy.course(db, user, q.course_id, edit=edit)
    if q.kind in ("practice", "review"):
        if q.learner_id != user.id:
            raise AppError("quiz.not_found", 404)  # a set belongs to the person who asked for it
        if q.topic_id:
            policy.topic(db, user, q.topic_id)
    elif not policy.can_edit(user, course):
        if not q.published:
            raise AppError("quiz.not_found", 404)
        if q.unit_id:
            policy.unit(db, user, q.unit_id)
    return q, course


def is_editor(user: User, course: Course, q: Quiz) -> bool:
    return q.kind == "test" and policy.can_edit(user, course)


# ---------- tests (written by staff) ----------

def create_test(db: Session, user: User, course: Course, data: dict) -> Quiz:
    unit_id = data.get("unit_id")
    if unit_id:
        u = get_or_404(db, Unit, unit_id, "unit")
        if u.course_id != course.id:
            raise AppError("unit.not_found", 404)
    title = (data.get("title") or "").strip()
    if not title:
        raise AppError("quiz.title_required")
    q = Quiz(kind="test", mode="full", course_id=course.id, unit_id=unit_id, title=title[:200], pass_percent=data.get("pass_percent", 60),
             reveal=data.get("reveal", False), published=data.get("published", False))
    db.add(q)
    db.flush()
    audit(db, user.id, "test.create", f"quiz:{q.id}")
    db.commit()
    return q


def update_test(db: Session, user: User, q: Quiz, data: dict) -> Quiz:
    if q.kind != "test":
        raise AppError("quiz.not_editable", 403)
    for k in ("title", "pass_percent", "reveal", "published"):
        if k in data and data[k] is not None:
            setattr(q, k, data[k].strip()[:200] if k == "title" else data[k])
    if "unit_id" in data:  # null = the whole course
        if data["unit_id"] is not None:
            unit = db.get(Unit, data["unit_id"])
            if not unit or unit.course_id != q.course_id:
                raise AppError("unit.not_found", 404)
        q.unit_id = data["unit_id"]
    if not q.title:
        raise AppError("quiz.title_required")
    audit(db, user.id, "test.update", f"quiz:{q.id}")
    db.commit()
    return q


def clean_question(db: Session, q: Quiz, x: dict, n: int) -> dict:
    """One question's stored values, or an error naming the question (R-ASM-1)."""
    opts = [{"text": (o.get("text") or "").strip(), "image": content.check_image_url(o.get("image", ""))} for o in x.get("options") or []]
    text, image = (x.get("text") or "").strip(), content.check_image_url(x.get("image", ""))
    if not text and not image:
        raise AppError("question.text_required", 400, number=n)
    if not 2 <= len(opts) <= 6 or not all(o["text"] or o["image"] for o in opts):
        raise AppError("question.options_invalid", 400, number=n)
    correct = x.get("correct")
    if not isinstance(correct, int) or not 0 <= correct < len(opts):
        raise AppError("question.correct_required", 400, number=n)
    topic_id = x.get("topic_id")
    if topic_id is not None:
        t = db.get(Topic, topic_id)
        unit = db.get(Unit, t.unit_id) if t else None
        if not t or unit.course_id != q.course_id or (q.unit_id and t.unit_id != q.unit_id):
            raise AppError("question.topic_outside", 400, number=n)
    return {"text": text, "image": image, "options": opts, "correct": correct, "explanation": (x.get("explanation") or "").strip(),
            "topic_id": topic_id, "area": (x.get("area") or "").strip()[:150]}


def replace_questions(db: Session, user: User, q: Quiz, items: list[dict]) -> list[int]:
    """The test's questions become `items`, in order. Items with the id of one of its questions update that question in place,
    so attempts stay linked to it; the others are added; questions left out are removed. Returns the ids in order."""
    if q.kind != "test":
        raise AppError("quiz.not_editable", 403)
    if len(items) > max_questions(q):
        raise AppError("quiz.too_many_questions", 400, max=max_questions(q))
    rows = [clean_question(db, q, x, n) for n, x in enumerate(items, 1)]
    existing = {x.id: x for x in questions_of(db, q)}
    kept: list[Question] = []
    for pos, (x, v) in enumerate(zip(items, rows, strict=True)):
        row = existing.pop(x.get("id"), None) if x.get("id") is not None else None
        if row is None:
            row = Question(quiz_id=q.id)
            db.add(row)
        for k, val in v.items():
            setattr(row, k, val)
        row.position = pos
        kept.append(row)
    for gone in existing.values():
        db.delete(gone)
    db.flush()
    audit(db, user.id, "test.questions", f"quiz:{q.id}", count=len(rows))
    db.commit()
    return [r.id for r in kept]


def questions_of(db: Session, q: Quiz) -> list[Question]:
    return list(db.scalars(select(Question).where(Question.quiz_id == q.id).order_by(Question.position, Question.id)))


def course_tests(db: Session, user: User, course: Course) -> list[dict]:
    edit = policy.can_edit(user, course)
    tests = db.scalars(select(Quiz).where(Quiz.course_id == course.id, Quiz.kind == "test").order_by(Quiz.unit_id.is_not(None), Quiz.id))
    tests = list(tests)
    ids = [q.id for q in tests] or [0]
    counts = dict(db.execute(select(Question.quiz_id, func.count(Question.id)).where(Question.quiz_id.in_(ids)).group_by(Question.quiz_id)).all())
    mine = db.execute(select(Attempt.quiz_id, func.max(Attempt.percent), func.max(Attempt.id)).where(Attempt.user_id == user.id, Attempt.quiz_id.in_(ids))
                      .group_by(Attempt.quiz_id)).all()
    best, latest = {a: b for a, b, _ in mine}, {a: c for a, _, c in mine}
    takers = dict(db.execute(select(Attempt.quiz_id, func.count(func.distinct(Attempt.user_id))).where(Attempt.quiz_id.in_(ids)).group_by(Attempt.quiz_id)).all()) if edit else {}
    return [{"id": q.id, "title": q.title, "unit_id": q.unit_id, "pass_percent": q.pass_percent, "published": q.published, "reveal": q.reveal,
             "questions": counts.get(q.id, 0), "best": best.get(q.id), "latest_attempt": latest.get(q.id), "students_taken": takers.get(q.id, 0)}
            for q in tests if edit or (q.published and counts.get(q.id))]


# ---------- the player ----------

def view(db: Session, user: User, q: Quiz, course: Course) -> dict:
    editor = is_editor(user, course, q)
    topics = {t.id: t.title for t in db.scalars(select(Topic).where(Topic.id.in_({x.topic_id for x in questions_of(db, q) if x.topic_id} or {0})))}
    mine = list(db.scalars(select(Attempt).where(Attempt.quiz_id == q.id, Attempt.user_id == user.id).order_by(Attempt.id)))
    topic = db.get(Topic, q.topic_id) if q.topic_id else None
    return {"id": q.id, "kind": q.kind, "mode": q.mode, "title": q.title or (topic.title if topic else course.title), "course_id": course.id, "course": course.title,
            "unit_id": q.unit_id, "topic_id": q.topic_id, "pass_percent": q.pass_percent, "reveal": q.reveal, "published": q.published, "can_edit": editor,
            "questions": [{"id": x.id, "text": x.text, "image": x.image, "options": x.options, "topic": topics.get(x.topic_id, "") if q.kind == "review" else None,
                           **({"correct": x.correct, "explanation": x.explanation, "topic_id": x.topic_id, "area": x.area} if editor else {})} for x in questions_of(db, q)],
            "attempts": len(mine), "best": max((a.percent for a in mine), default=None), "latest_attempt": mine[-1].id if mine else None}


def check(db: Session, q: Quiz, index: int, answer: int) -> dict:
    """Quick checks and reviews show the answer right after each question."""
    if q.mode != "quick":
        raise AppError("quiz.answers_after_submit", 400)
    qs = questions_of(db, q)
    if not 0 <= index < len(qs) or not 0 <= answer < len(qs[index].options):
        raise AppError("quiz.answer_invalid", 400)
    x = qs[index]
    return {"ok": answer == x.correct, "correct": x.correct, "explanation": x.explanation}


def flag(db: Session, q: Quiz, question_id: int) -> None:
    x = get_or_404(db, Question, question_id, "question")
    if x.quiz_id != q.id:
        raise AppError("question.not_found", 404)
    x.flagged = True
    db.commit()


# ---------- grading ----------

def grade(db: Session, user: User, q: Quiz, course: Course, answers: list[int | None]) -> dict:
    qs = questions_of(db, q)
    if not qs:
        raise AppError("quiz.empty", 400)
    if len(answers) != len(qs):
        raise AppError("quiz.answer_every_question", 400)
    if any(a is not None and not 0 <= a < len(x.options) for a, x in zip(answers, qs, strict=True)):
        raise AppError("quiz.answer_invalid", 400)
    tracked = learning.tracks(user, course)
    points_before = learning.points(db, user.id) if tracked else 0
    stars_before = learning.stars(db, user.id, [q.topic_id]).get(q.topic_id, 0) if q.topic_id and tracked else 0
    detail = [{"question_id": x.id, "chosen": a, "ok": a == x.correct} for a, x in zip(answers, qs, strict=True)]
    score = sum(d["ok"] for d in detail)
    pct = round(100 * score / len(qs))
    attempt = Attempt(quiz_id=q.id, user_id=user.id, answers=detail, score=score, total=len(qs), percent=pct)
    db.add(attempt)
    completed_now, now = False, utcnow()
    if tracked:
        per = defaultdict(lambda: [0, 0])  # topic -> [right, asked]; each topic moves on its own review schedule
        for x, d in zip(qs, detail, strict=True):
            tid = x.topic_id or q.topic_id
            if tid:
                per[tid][0] += d["ok"]
                per[tid][1] += 1
        for tid, (ok, n) in per.items():
            p = learning.progress_row(db, user.id, tid)
            learning.schedule_review(p, ok / n, now)
            good = (q.mode == "quick" and pct >= 80) or (q.mode == "full" and pct >= learning.PASS)
            if q.kind == "practice" and tid == q.topic_id and not p.completed_at and good:
                p.completed_at, completed_now = now, True  # R-LRN-1
    db.commit()
    reveal = is_editor(user, course, q) or q.reveal or q.kind != "test"
    results = [{"question_id": x.id, "chosen": d["chosen"], "ok": d["ok"], **({"correct": x.correct, "explanation": x.explanation} if reveal else {})}
               for x, d in zip(qs, detail, strict=True)]
    areas = strengths(db, [(q, qs, detail)], staff=user.role != "student")
    out = {"attempt_id": attempt.id, "score": score, "total": len(qs), "percent": pct, "passed": pct >= q.pass_percent, "pass_percent": q.pass_percent,
           "reveal": reveal, "results": results, "areas": areas, "completed_now": completed_now}
    if tracked:
        points_after = learning.points(db, user.id)
        lv0, lv1 = learning.level_of(points_before), learning.level_of(points_after)
        out["reward"] = {"points": points_after - points_before, "level": lv1["level"], "level_up": lv1["level"] > lv0["level"],
                         "stars_before": stars_before, "stars_after": learning.stars(db, user.id, [q.topic_id]).get(q.topic_id, 0) if q.topic_id else 0}
        dues = [p.review_due for p in db.scalars(select(learning.TopicProgress).where(learning.TopicProgress.user_id == user.id,
                learning.TopicProgress.topic_id.in_([x.topic_id or q.topic_id for x in qs if x.topic_id or q.topic_id] or [0]))) if p.review_due]
        out["next_review"] = iso(min(dues)) if dues else None
    return out


def status_of(pct: int) -> str:
    return "strong" if pct >= STRONG else "needs_study" if pct < WEAK else "getting_there"


def strengths(db: Session, batches: list[tuple[Quiz, list[Question], list[dict]]], staff: bool = False) -> list[dict]:
    """R-LRN-7: answers grouped by topic, else by area label, else by unit, else 'general'."""
    qmap = {x.id: x for _, qs, _ in batches for x in qs}
    topic_ids = {x.topic_id for x in qmap.values() if x.topic_id} | {q.topic_id for q, _, _ in batches if q.topic_id}
    topics = {t.id: t for t in db.scalars(select(Topic).where(Topic.id.in_(topic_ids or {0})))}
    units = {u.id: u for u in db.scalars(select(Unit).where(Unit.id.in_({t.unit_id for t in topics.values()} | {q.unit_id for q, _, _ in batches if q.unit_id} or {0})))}
    acc: dict[tuple, dict] = {}
    for q, _, detail in batches:
        for d in detail:
            x = qmap.get(d["question_id"])
            if not x:
                continue
            t = topics.get(x.topic_id or q.topic_id or 0)
            if t and not t.published and not staff:
                t = None
            if t:
                key, title, unit = ("t", t.id), t.title, units.get(t.unit_id)
            elif x.area:
                key, title, unit = ("a", x.area.lower()), x.area, None
            elif q.unit_id:
                unit = units.get(q.unit_id)
                key, title = ("u", q.unit_id), unit.title if unit else ""
            else:
                key, title, unit = ("g", q.id), "", None
            a = acc.setdefault(key, {"topic_id": t.id if t else None, "title": title, "unit": unit.title if unit else "", "general": key[0] == "g",
                                     "correct": 0, "total": 0})
            a["correct"] += d["ok"]
            a["total"] += 1
    out = [{**a, "percent": round(100 * a["correct"] / a["total"])} for a in acc.values()]
    for a in out:
        a["status"] = status_of(a["percent"])
    return sorted(out, key=lambda a: (a["percent"], a["title"]))


def latest_batches(db: Session, user_ids: list[int], quiz_ids: list[int]) -> list[tuple[int, Quiz, list[Question], list[dict]]]:
    """Each person's newest attempt of each quiz (a retake replaces the earlier result)."""
    if not user_ids or not quiz_ids:
        return []
    ids = [i for (i,) in db.execute(select(func.max(Attempt.id)).where(Attempt.user_id.in_(user_ids), Attempt.quiz_id.in_(quiz_ids)).group_by(Attempt.user_id, Attempt.quiz_id))]
    attempts = list(db.scalars(select(Attempt).where(Attempt.id.in_(ids or [0]))))
    quizzes = {q.id: q for q in db.scalars(select(Quiz).where(Quiz.id.in_({a.quiz_id for a in attempts} or {0})))}
    qs = defaultdict(list)
    for x in db.scalars(select(Question).where(Question.quiz_id.in_(set(quizzes) or {0}))):
        qs[x.quiz_id].append(x)
    return [(a.user_id, quizzes[a.quiz_id], qs[a.quiz_id], a.answers) for a in attempts]


def summary_line(areas: list[dict]) -> dict:
    """What the learner is good at and what to revisit, as data the web app phrases in the user's language."""
    good = [a["title"] for a in sorted(areas, key=lambda a: -a["percent"]) if a["status"] == "strong" and a["title"]][:3]
    weak = [a["title"] for a in areas if a["status"] == "needs_study" and a["title"]][:3]
    return {"strong": good, "needs_study": weak}


# ---------- attempts ----------

def attempt_detail(db: Session, user: User, attempt_id: int) -> dict:
    a = get_or_404(db, Attempt, attempt_id, "attempt")
    q = get_or_404(db, Quiz, a.quiz_id, "quiz")
    course = db.get(Course, q.course_id)
    staff_view = q.kind == "test" and policy.can_edit(user, course)
    if a.user_id != user.id and not staff_view:
        raise AppError("attempt.not_found", 404)
    reveal = staff_view or q.reveal or q.kind != "test"
    qmap = {x.id: x for x in questions_of(db, q)}
    topics = {t.id: t.title for t in db.scalars(select(Topic).where(Topic.id.in_({x.topic_id for x in qmap.values() if x.topic_id} or {0})))}
    items, gone = [], 0
    for d in a.answers:
        x = qmap.get(d["question_id"])
        if not x:
            gone += 1
            continue
        items.append({"id": x.id, "text": x.text, "image": x.image, "options": x.options, "chosen": d["chosen"], "ok": d["ok"],
                      "topic": topics.get(x.topic_id, x.area), **({"correct": x.correct, "explanation": x.explanation} if reveal else {})})
    owner = db.get(User, a.user_id)
    areas = strengths(db, [(q, list(qmap.values()), a.answers)], staff=user.role != "student")
    return {"id": a.id, "quiz_id": q.id, "title": q.title, "kind": q.kind, "user": owner.name if owner else "", "user_id": a.user_id, "at": iso(a.at),
            "score": a.score, "total": a.total, "percent": a.percent, "passed": a.percent >= q.pass_percent, "pass_percent": q.pass_percent,
            "reveal": reveal, "questions": items, "changed": gone, "areas": areas, "summary": summary_line(areas)}


def attempts_of(db: Session, user: User, q: Quiz, course: Course, who: int | None) -> dict:
    target = who or user.id
    if target != user.id and not is_editor(user, course, q):
        raise AppError("auth.forbidden", 403)
    rows = db.scalars(select(Attempt).where(Attempt.quiz_id == q.id, Attempt.user_id == target).order_by(Attempt.id.desc()).limit(100))
    return {"items": [{"id": a.id, "at": iso(a.at), "score": a.score, "total": a.total, "percent": a.percent, "passed": a.percent >= q.pass_percent} for a in rows]}


# ---------- practice and review ----------

def save_practice(db: Session, user: User, topic: Topic, course: Course, mode: str, items: list[dict]) -> Quiz:
    q = Quiz(kind="practice", mode=mode, course_id=course.id, topic_id=topic.id, learner_id=user.id, title=topic.title, pass_percent=learning.PASS)
    db.add(q)
    db.flush()
    for pos, x in enumerate(items):
        db.add(Question(quiz_id=q.id, position=pos, text=x["text"], options=[{"text": o, "image": ""} for o in x["options"]], correct=x["correct"],
                        explanation=x.get("explanation", ""), topic_id=topic.id, area=x.get("concept", "")[:150]))
    db.commit()
    return q


def earlier_question_texts(db: Session, user: User, topic_id: int, limit: int = 15) -> list[str]:
    quiz_ids = select(Quiz.id).where(Quiz.topic_id == topic_id, Quiz.learner_id == user.id, Quiz.kind == "practice")
    return [t for (t,) in db.execute(select(Question.text).where(Question.quiz_id.in_(quiz_ids)).order_by(Question.id.desc()).limit(limit))]


def build_review(db: Session, user: User, course: Course) -> Quiz:
    """R-LRN-3: the learner's own earlier questions on topics due in this course, two per topic, ten at most. No AI."""
    now = utcnow()
    unit_ids = select(Unit.id).where(Unit.course_id == course.id)
    due = list(db.execute(select(learning.TopicProgress.topic_id).join(Topic, Topic.id == learning.TopicProgress.topic_id)
                          .where(learning.TopicProgress.user_id == user.id, learning.TopicProgress.review_due <= now, Topic.unit_id.in_(unit_ids))
                          .order_by(learning.TopicProgress.review_due)).scalars())
    if not due:
        raise AppError("review.nothing_due", 400)
    mine = select(Quiz.id).where(Quiz.learner_id == user.id, Quiz.kind == "practice")
    attempted = select(Attempt.quiz_id).where(Attempt.user_id == user.id)
    picked: list[Question] = []
    for tid in due:
        pool = list(db.scalars(select(Question).where(Question.topic_id == tid, Question.flagged.is_(False),
                                                     (Question.quiz_id.in_(mine)) | (Question.quiz_id.in_(attempted)))))
        picked += random.sample(pool, min(2, len(pool)))
        if len(picked) >= REVIEW_SIZE:
            break
    if not picked:
        raise AppError("review.no_questions", 400)
    random.shuffle(picked)
    q = Quiz(kind="review", mode="quick", course_id=course.id, learner_id=user.id, title=course.title, pass_percent=learning.PASS)
    db.add(q)
    db.flush()
    for pos, x in enumerate(picked[:REVIEW_SIZE]):
        db.add(Question(quiz_id=q.id, position=pos, text=x.text, image=x.image, options=x.options, correct=x.correct, explanation=x.explanation,
                        topic_id=x.topic_id, area=x.area))
    db.commit()
    return q
