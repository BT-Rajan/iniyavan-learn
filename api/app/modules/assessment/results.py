"""Results for staff: one test, and a course's gradebook (R-ASM-4, R-REP-1)."""
from __future__ import annotations

import csv
import io
from collections import defaultdict

from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.catalog import policy
from app.modules.catalog.models import Course, CourseShare, Term, Topic, Unit
from app.modules.users.models import User

from . import service
from .models import Attempt, Quiz


def csv_cell(v):
    v = "" if v is None else v
    return "'" + v if isinstance(v, str) and v[:1] and v[:1] in "=+-@\t\r" else v  # no spreadsheet formulas (R-REP-1)


def csv_response(name: str, header: list, rows: list) -> Response:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(header)
    for r in rows:
        w.writerow([csv_cell(c) for c in r])
    return Response("﻿" + out.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{name}"'})


def course_students(db: Session, course: Course) -> list[User]:
    if course.kind == "personal":
        return []
    terms = [course.term_id] + list(db.scalars(select(CourseShare.term_id).where(CourseShare.course_id == course.id)))
    rows = db.scalars(select(Term).where(Term.id.in_([t for t in terms if t] or [0])))
    out = {}
    for t in rows:
        for u in db.scalars(select(User).where(User.role == "student", User.active.is_(True), User.program_id == t.program_id)):
            if policy.term_open_to(u, t):
                out[u.id] = u
    return sorted(out.values(), key=lambda u: u.name.lower())


def stats(values: list[int]) -> dict:
    if not values:
        return {"average": None, "median": None, "highest": None, "lowest": None}
    v = sorted(values)
    m = len(v) // 2
    return {"average": round(sum(v) / len(v)), "median": v[m] if len(v) % 2 else round((v[m - 1] + v[m]) / 2), "highest": v[-1], "lowest": v[0]}


def test_results(db: Session, q: Quiz, course: Course, as_csv: bool = False):
    qs = service.questions_of(db, q)
    attempts = list(db.scalars(select(Attempt).where(Attempt.quiz_id == q.id).order_by(Attempt.id)))
    people = {u.id: u for u in db.scalars(select(User).where(User.id.in_({a.user_id for a in attempts} or {0}), User.role == "student"))}
    by = defaultdict(list)
    for a in attempts:
        if a.user_id in people:
            by[a.user_id].append(a)
    audience = course_students(db, course)
    latest = [(uid, q, qs, L[-1].answers) for uid, L in by.items()]
    students = []
    for uid, L in by.items():
        best = max(L, key=lambda a: (a.percent, a.id))
        areas = service.strengths(db, [(q, qs, L[-1].answers)], staff=True)
        students.append({"user_id": uid, "name": people[uid].name, "email": people[uid].email, "attempts": len(L), "best": best.percent,
                         "latest": L[-1].percent, "latest_attempt": L[-1].id, "passed": best.percent >= q.pass_percent, "last_at": service.iso(L[-1].at),
                         **service.summary_line(areas)})
    students.sort(key=lambda r: (-r["best"], r["name"].lower()))
    not_taken = [u for u in audience if u.id not in by]
    if as_csv:
        return csv_response(f"results-{q.id}.csv", ["name", "email", "attempts", "final_percent", "latest_percent", "passed", "last_attempt", "strong", "needs_study"],
                            [[r["name"], r["email"], r["attempts"], r["best"], r["latest"], "yes" if r["passed"] else "no", r["last_at"],
                              "; ".join(r["strong"]), "; ".join(r["needs_study"])] for r in students] + [[u.name, u.email, 0, "", "", "", "", "", ""] for u in not_taken])
    picks = {x.id: {"answered": 0, "blank": 0, "right": 0, "total": 0, "picks": [0] * len(x.options)} for x in qs}
    for _, _, _, detail in latest:
        for d in detail:
            p = picks.get(d["question_id"])
            if p is None:
                continue
            p["total"] += 1
            p["right"] += d["ok"]
            if d["chosen"] is None:
                p["blank"] += 1
            elif 0 <= d["chosen"] < len(p["picks"]):
                p["picks"][d["chosen"]] += 1
                p["answered"] += 1
    topics = {t.id: t.title for t in db.scalars(select(Topic).where(Topic.id.in_({x.topic_id for x in qs if x.topic_id} or {0})))}
    best = [r["best"] for r in students]
    spread = [0] * 10
    for v in best:
        spread[min(v // 10, 9)] += 1
    class_areas = defaultdict(lambda: {"correct": 0, "total": 0, "students": 0, "strong": 0, "getting_there": 0, "needs_study": 0})
    for _uid, _, _, detail in latest:
        for a in service.strengths(db, [(q, qs, detail)], staff=True):
            g = class_areas[(a["topic_id"], a["title"])]
            g.update(topic_id=a["topic_id"], title=a["title"], unit=a["unit"])
            g["correct"] += a["correct"]
            g["total"] += a["total"]
            g["students"] += 1
            g[a["status"]] += 1
    areas = sorted([{**g, "percent": round(100 * g["correct"] / g["total"])} for g in class_areas.values()], key=lambda g: g["percent"])
    return {"id": q.id, "title": q.title, "pass_percent": q.pass_percent, "published": q.published,
            "summary": {"students": len({u.id for u in audience} | set(by)), "took": len(by), "not_taken": len(not_taken), "attempts": sum(len(L) for L in by.values()),
                        "passed": sum(r["passed"] for r in students), "pass_rate": round(100 * sum(r["passed"] for r in students) / len(students)) if students else None,
                        **stats(best), "spread": spread},
            "students": students, "not_taken": [{"user_id": u.id, "name": u.name} for u in not_taken[:300]],
            "questions": [{"id": x.id, "position": i + 1, "text": x.text, "image": x.image, "options": x.options, "correct": x.correct,
                           "topic": topics.get(x.topic_id, x.area), **picks[x.id], "percent": round(100 * picks[x.id]["right"] / picks[x.id]["total"]) if picks[x.id]["total"] else None}
                          for i, x in enumerate(qs)],
            "areas": areas}


def gradebook(db: Session, course: Course, as_csv: bool = False):
    units = {u.id: u.title for u in db.scalars(select(Unit).where(Unit.course_id == course.id))}
    tests = list(db.scalars(select(Quiz).where(Quiz.course_id == course.id, Quiz.kind == "test", Quiz.published.is_(True)).order_by(Quiz.unit_id.is_not(None), Quiz.id)))
    tids = [t.id for t in tests]
    best = defaultdict(dict)
    for qid, uid, b in db.execute(select(Attempt.quiz_id, Attempt.user_id, func.max(Attempt.percent)).where(Attempt.quiz_id.in_(tids or [0])).group_by(Attempt.quiz_id, Attempt.user_id)):
        best[uid][qid] = b
    audience = course_students(db, course)
    extra = list(db.scalars(select(User).where(User.id.in_(set(best) - {u.id for u in audience} or {0}), User.role == "student")))
    rows = []
    for u in sorted(audience + extra, key=lambda u: u.name.lower()):
        got = best.get(u.id, {})
        taken = [got[t] for t in tids if t in got]
        rows.append({"user_id": u.id, "name": u.name, "email": u.email, "scores": [got.get(t) for t in tids], "taken": len(taken),
                     "final": round(sum(taken) / len(taken)) if taken else None})
    cols = [{"id": t.id, "title": t.title, "unit": units.get(t.unit_id, ""), "pass_percent": t.pass_percent,
             **stats([r["scores"][i] for r in rows if r["scores"][i] is not None])} for i, t in enumerate(tests)]
    if as_csv:
        return csv_response(f"gradebook-{course.id}.csv", ["name", "email"] + [t["title"] for t in cols] + ["tests_taken", "final_percent"],
                            [[r["name"], r["email"]] + ["" if v is None else v for v in r["scores"]] + [r["taken"], r["final"]] for r in rows])
    return {"course": course.title, "tests": cols, "students": rows, "summary": stats([r["final"] for r in rows if r["final"] is not None])}
