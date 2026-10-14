import json
import re

import pytest

from app.core.db import SessionLocal
from app.modules.admin import service as cfg
from tests.conftest import Api, add_user

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 20


def code_of(r):
    return r.json()["error"]["code"]


class FakeAI:
    calls: list = []

    async def __call__(self, key, model, system, user_msg, max_tokens, timeout=90):
        FakeAI.calls.append((system[:25], user_msg))
        if "multiple-choice" in system:
            n = int(re.search(r"Write (\d+) questions", user_msg).group(1))
            qs = [{"text": f"Q{i}?", "options": ["right", "wrong", "other", "none"], "correct": 0, "explanation": "Because.",
                   "concept": "Ions" if i % 2 else "Salts"} for i in range(n)]
            return "```json\n" + json.dumps({"questions": qs + [{"text": "broken", "options": ["a"], "correct": 3}]}) + "\n```", 50
        return "An explanation.", 20


@pytest.fixture
def ai(monkeypatch):
    monkeypatch.setattr("app.modules.ai.service.complete", FakeAI())
    FakeAI.calls = []
    with SessionLocal() as s:
        cfg.put(s, "ai_key", "sk-institution")
        s.commit()


def school(admin):
    p = admin.post("/api/programs", json={"name": "Mech", "terms": 2}).json()
    fid = add_user("fac@x.com", "faculty")
    c = admin.post("/api/courses", json={"title": "Chemistry", "term_id": p["terms"][0]["id"], "owner_id": fid}).json()
    u = admin.post(f"/api/courses/{c['id']}/units", json={"title": "Water"}).json()
    t1 = admin.post(f"/api/units/{u['id']}/topics", json={"title": "Hardness", "content": "Calcium and magnesium salts make water hard."}).json()["id"]
    t2 = admin.post(f"/api/units/{u['id']}/topics", json={"title": "Boiling", "content": "Boiling removes temporary hardness."}).json()["id"]
    add_user("stu@x.com", program_id=p["id"], term_no=1)
    add_user("stu2@x.com", program_id=p["id"], term_no=1)
    return c, u, t1, t2, Api().login("fac@x.com"), Api().login("stu@x.com"), Api().login("stu2@x.com")


QS = [{"text": "Which ion?", "options": [{"text": "Ca2+"}, {"text": "Na+"}], "correct": 0, "explanation": "Calcium."},
      {"text": "Unit?", "options": [{"text": "ppm"}, {"text": "pH"}, {"text": "mol"}], "correct": 0, "area": "Units"}]


def test_tests_hide_answers_grade_on_the_server_and_show_strengths(admin):
    c, u, t1, t2, fac, stu, stu2 = school(admin)
    q = fac.post(f"/api/courses/{c['id']}/tests", json={"title": "Water test", "unit_id": u["id"], "published": True}).json()
    img = admin.post("/api/uploads", content=PNG).json()["url"]
    bad = [{**QS[0], "image": "https://evil.example/x.png"}]
    assert code_of(fac.put(f"/api/tests/{q['id']}/questions", json={"questions": bad})) == "upload.use_uploaded_image"
    assert code_of(fac.put(f"/api/tests/{q['id']}/questions", json={"questions": [{**QS[0], "correct": 5}]})) == "question.correct_required"
    qs = [{**QS[0], "topic_id": t1, "image": img, "options": [{"text": "", "image": img}, {"text": "Na+"}]}, QS[1]]
    assert fac.put(f"/api/tests/{q['id']}/questions", json={"questions": qs}).json()["count"] == 2
    view = stu.get(f"/api/quizzes/{q['id']}").json()
    assert "correct" not in view["questions"][0] and view["questions"][0]["options"][0]["image"] == img and view["can_edit"] is False
    r = stu.post(f"/api/quizzes/{q['id']}/attempts", json={"answers": [0, 1]}).json()
    assert (r["score"], r["percent"], r["passed"], r["reveal"]) == (1, 50, False, False) and "correct" not in r["results"][0]
    assert {a["title"]: a["status"] for a in r["areas"]} == {"Hardness": "strong", "Units": "needs_study"}
    assert code_of(stu.post(f"/api/quizzes/{q['id']}/check", json={"index": 0, "answer": 0})) == "quiz.answers_after_submit"
    fac.patch(f"/api/tests/{q['id']}", json={"reveal": True})
    r2 = stu.post(f"/api/quizzes/{q['id']}/attempts", json={"answers": [0, 0]}).json()
    assert r2["reveal"] is True and r2["results"][0]["correct"] == 0
    detail = stu.get(f"/api/attempts/{r['attempt_id']}").json()
    assert [(x["chosen"], x["ok"]) for x in detail["questions"]] == [(0, True), (1, False)] and detail["summary"]["strong"] == ["Hardness"]
    assert code_of(stu2.get(f"/api/attempts/{r['attempt_id']}")) == "attempt.not_found"
    assert stu.get(f"/api/topics/{t1}").json()["review_due"] is not None  # the test scheduled a review of the topic it covered


def test_results_gradebook_and_csv(admin):
    c, u, t1, t2, fac, stu, stu2 = school(admin)
    q = fac.post(f"/api/courses/{c['id']}/tests", json={"title": "T1", "published": True}).json()
    fac.put(f"/api/tests/{q['id']}/questions", json={"questions": QS})
    stu.post(f"/api/quizzes/{q['id']}/attempts", json={"answers": [0, 0]})
    stu.post(f"/api/quizzes/{q['id']}/attempts", json={"answers": [1, 1]})  # best stays 100, latest 0
    res = fac.get(f"/api/tests/{q['id']}/results").json()
    s = res["summary"]
    assert (s["students"], s["took"], s["not_taken"], s["passed"], s["average"]) == (2, 1, 1, 1, 100)
    assert res["students"][0]["latest"] == 0 and res["questions"][0]["picks"] == [0, 1]  # analysis uses the latest attempt
    assert code_of(stu.get(f"/api/tests/{q['id']}/results")) == "course.not_editable"
    csv = fac.get(f"/api/tests/{q['id']}/results?format=csv").text
    assert csv.splitlines()[0].lstrip("﻿").startswith("name,email") and "stu2@x.com" in csv
    gb = fac.get(f"/api/courses/{c['id']}/gradebook").json()
    assert [r["final"] for r in gb["students"]] == [100, None]


def test_csv_preview_reads_answers_topics_and_image_names(admin):
    c, u, t1, t2, fac, stu, stu2 = school(admin)
    text = ("question,a,b,c,correct,topic,area,question_image,a_image\n"
            "Which ion?,Na+,Ca2+,K+,B,Hardness,,,\n"
            "Pick it,,y,,A,Nope,,pic.png,left.png\n"
            "Text key?,ppm,pH,,ppm,,Units,,\n"
            "Two?,x,y,,\"A, B\",,,,\n"
            "Gap,x,,z,A,,,,\n")
    r = fac.post(f"/api/courses/{c['id']}/tests/parse-csv", json={"csv": text}).json()
    assert len(r["questions"]) == 3 and [e["code"] for e in r["errors"]] == ["import.one_correct_only", "import.answer_empty"]
    q1, q2, q3 = r["questions"]
    assert (q1["correct"], q1["topic_id"]) == (1, t1) and (q2["image_name"], q2["options"][0]["image_name"], q2["area"]) == ("pic.png", "left.png", "Nope")
    assert q3["correct"] == 0 and r["images_needed"] == ["left.png", "pic.png"] and r["warnings"][0]["code"] == "import.topic_unknown"


def test_practice_on_any_topic_rewards_and_auto_completes(admin, ai):
    c, u, t1, t2, fac, stu, stu2 = school(admin)
    q = stu.post(f"/api/topics/{t1}/practice", json={"mode": "full"}).json()
    assert q["kind"] == "practice" and len(q["questions"]) == 10 and "correct" not in q["questions"][0]
    assert "Calcium and magnesium" in FakeAI.calls[-1][1]
    r = stu.post(f"/api/quizzes/{q['id']}/attempts", json={"answers": [0] * 10}).json()
    # completed by the quiz (10) + 10 right + passed (20) + mastered (30)
    assert r["completed_now"] and r["reward"] == {"points": 70, "level": 1, "level_up": False, "stars_before": 0, "stars_after": 3}
    assert r["results"][0]["correct"] == 0  # practice always shows the key
    m = stu.post(f"/api/topics/{t2}/practice", json={"mode": "quick"}).json()
    assert len(m["questions"]) == 5 and "Q0?" not in FakeAI.calls[-1][1]  # different topic, no earlier questions to avoid
    assert stu.post(f"/api/quizzes/{m['id']}/check", json={"index": 0, "answer": 1}).json() == {"ok": False, "correct": 0, "explanation": "Because."}
    assert code_of(stu2.get(f"/api/quizzes/{m['id']}")) == "quiz.not_found"  # a set belongs to whoever asked
    stu.post(f"/api/topics/{t1}/practice", json={"mode": "quick"})
    assert "Q0?" in FakeAI.calls[-1][1]  # asked to differ from the earlier set
    course = stu.get(f"/api/courses/{c['id']}").json()
    assert [t["stars"] for t in course["units"][0]["topics"]] == [3, 0] and course["progress"]["mastery"] == 50


def test_spaced_review_uses_own_questions_and_skips_reported_ones(admin, ai):
    c, u, t1, t2, fac, stu, stu2 = school(admin)
    q = stu.post(f"/api/topics/{t1}/practice", json={"mode": "quick"}).json()
    for k in range(4):
        stu.post(f"/api/quizzes/{q['id']}/questions/{q['questions'][k]['id']}/flag")
    stu.post(f"/api/quizzes/{q['id']}/attempts", json={"answers": [1] * 5})  # poor: comes back tomorrow
    assert code_of(stu.post(f"/api/courses/{c['id']}/review")) == "review.nothing_due"
    from app.modules.learning.models import TopicProgress
    with SessionLocal() as s:
        for p in s.query(TopicProgress).all():
            p.review_due = p.review_due.replace(year=p.review_due.year - 1)
        s.commit()
    home = stu.get("/api/home").json()
    assert home["reviews_due"] == 1 and home["reviews"][0]["course_id"] == c["id"]
    calls = len(FakeAI.calls)
    rv = stu.post(f"/api/courses/{c['id']}/review").json()
    assert len(FakeAI.calls) == calls and rv["kind"] == "review" and rv["mode"] == "quick" and [x["text"] for x in rv["questions"]] == ["Q4?"]
    r = stu.post(f"/api/quizzes/{rv['id']}/attempts", json={"answers": [0]}).json()
    assert r["reward"]["points"] == 1 + 5 and r["next_review"]


def test_ai_keys_limits_and_cached_explanations(admin, ai, monkeypatch):
    c, u, t1, t2, fac, stu, stu2 = school(admin)
    assert stu.get(f"/api/topics/{t1}/explain").json() == {"text": "An explanation.", "cached": False}
    assert stu2.get(f"/api/topics/{t1}/explain").json()["cached"] is True  # shared by everyone
    with SessionLocal() as s:
        cfg.put(s, "ai_daily_limit", "2")
        s.commit()
    st = stu.get("/api/ai/status").json()
    assert (st["available"], st["left"], st["limit"]) == (True, 1, 2)
    stu.post(f"/api/topics/{t1}/practice", json={"mode": "quick"})
    assert code_of(stu.post(f"/api/topics/{t1}/practice", json={"mode": "quick"})) == "ai.limit_reached"
    assert fac.get("/api/ai/status").json()["left"] is None  # staff are not limited

    async def broken(*a, **k):
        import httpx
        raise httpx.HTTPStatusError("x", request=httpx.Request("POST", "http://x"), response=httpx.Response(401))
    monkeypatch.setattr("app.modules.ai.service.complete", broken)
    r = stu2.get(f"/api/topics/{t2}/explain")
    assert r.status_code == 502 and code_of(r) == "ai.provider_error" and "401" not in r.text
    with SessionLocal() as s:
        cfg.put(s, "ai_key", "")
        s.commit()
    assert code_of(stu2.get(f"/api/topics/{t1}/explain")) == "ai.unavailable"  # no key: even saved answers are off


def test_question_bank(admin):
    c, u, t1, t2, fac, stu, stu2 = school(admin)
    assert fac.post("/api/bank", json={"text": "Q", "options": [{"text": "a"}, {"text": "b"}], "correct": 0, "tags": "Water, water"}).status_code == 200
    assert code_of(fac.post("/api/bank", json={"text": "q", "options": [{"text": "A"}, {"text": "B"}], "correct": 0})) == "bank.duplicate"
    items = fac.get("/api/bank").json()
    assert items["total"] == 1 and items["items"][0]["tags"] == ["water"]
    q = fac.post(f"/api/courses/{c['id']}/tests", json={"title": "T"}).json()
    assert fac.post(f"/api/tests/{q['id']}/from-bank", json={"ids": [items["items"][0]["id"]]}).json()["count"] == 1
    assert code_of(stu.get("/api/bank")) == "auth.forbidden"
    fac.put(f"/api/tests/{q['id']}/questions", json={"questions": QS})
    assert fac.post(f"/api/tests/{q['id']}/to-bank", json={"tags": "chem"}).json() == {"added": 2, "skipped": 0}


def test_editing_questions_keeps_past_attempts_linked(admin):
    c, u, t1, t2, fac, stu, stu2 = school(admin)
    q = fac.post(f"/api/courses/{c['id']}/tests", json={"title": "T", "published": True}).json()
    ids = fac.put(f"/api/tests/{q['id']}/questions", json={"questions": QS}).json()["ids"]
    a = stu.post(f"/api/quizzes/{q['id']}/attempts", json={"answers": [0, 0]}).json()
    edited = [{**QS[1], "id": ids[1], "text": "Which unit?"}, {**QS[0], "id": ids[0]}, {"text": "New?", "options": [{"text": "a"}, {"text": "b"}], "correct": 1}]
    new_ids = fac.put(f"/api/tests/{q['id']}/questions", json={"questions": edited}).json()["ids"]
    assert new_ids[:2] == [ids[1], ids[0]] and new_ids[2] not in ids
    detail = stu.get(f"/api/attempts/{a['attempt_id']}").json()
    assert {x["text"] for x in detail["questions"]} >= {"Which ion?", "Which unit?"}
    res = fac.get(f"/api/tests/{q['id']}/results").json()
    assert res["course_id"] == c["id"] and all("status" in x for x in res["areas"])
    row = next(x for x in fac.get(f"/api/courses/{c['id']}/tests").json() if x["id"] == q["id"])
    assert (row["questions"], row["students_taken"]) == (3, 1)
    mine = next(x for x in stu.get(f"/api/courses/{c['id']}/tests").json() if x["id"] == q["id"])
    assert mine["latest_attempt"] == a["attempt_id"]
    assert code_of(fac.patch(f"/api/tests/{q['id']}", json={"unit_id": 9999})) == "unit.not_found"
    assert fac.patch(f"/api/tests/{q['id']}", json={"unit_id": u["id"]}).status_code == 200


def test_ai_answers_are_asked_to_be_short_and_simple(admin, monkeypatch):
    c, u, t1, t2, fac, stu, stu2 = school(admin)
    systems = []

    async def fake(key, model, system, user_msg, max_tokens, timeout=90):
        systems.append(system)
        return "Short answer.", 5
    monkeypatch.setattr("app.modules.ai.service.complete", fake)
    with SessionLocal() as s:
        cfg.put(s, "ai_key", "sk-institution")
        s.commit()
    stu.get(f"/api/topics/{t1}/explain")
    stu.get("/api/search/answer?q=osmosis")
    assert len(systems) == 2 and all("15-year-old" in x and "short, crisp sentences" in x for x in systems)
