from tests.conftest import Api, add_user
from tests.test_assessment import QS, FakeAI, ai, school  # noqa: F401

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 20


def code_of(r):
    return r.json()["error"]["code"]


def test_search_finds_only_what_you_may_open(admin, ai):  # noqa: F811
    c, u, t1, t2, fac, stu, stu2 = school(admin)
    draft = fac.post(f"/api/units/{u['id']}/topics", json={"title": "Softening", "content": "Ion exchange removes hardness."}).json()["id"]
    hits = stu.get("/api/search?q=hardness").json()["results"]
    assert [h["title"] for h in hits] == ["Hardness", "Boiling"] and "hardness" in hits[1]["snippet"].lower()  # a title match ranks first
    assert draft in [h["topic_id"] for h in fac.get("/api/search?q=hardness").json()["results"]]
    assert stu.get("/api/search?q=calcium magnesium").json()["results"][0]["topic_id"] == t1
    assert Api().login(add_user("out@x.com") and "out@x.com").get("/api/search?q=hardness").json()["results"] == []
    a = stu.get("/api/search/answer?q=osmosis").json()
    b = stu2.get("/api/search/answer?q=Osmosis").json()
    assert a["text"] == "An explanation." and (a["cached"], b["cached"]) == (False, True)


def test_course_and_student_reports(admin):
    c, u, t1, t2, fac, stu, stu2 = school(admin)
    q = fac.post(f"/api/courses/{c['id']}/tests", json={"title": "T1", "published": True}).json()
    fac.put(f"/api/tests/{q['id']}/questions", json={"questions": [{**QS[0], "topic_id": t1}, QS[1]]})
    stu.put(f"/api/topics/{t1}/completed", json={"completed": True})
    stu.post(f"/api/quizzes/{q['id']}/attempts", json={"answers": [0, 1]})
    r = fac.get(f"/api/reports/courses/{c['id']}").json()
    assert (r["topics"], r["summary"]["students"], r["summary"]["started"], r["summary"]["completion"]) == (2, 2, 1, 25)
    me = next(s for s in r["students"] if s["email"] == "stu@x.com")
    assert (me["completion"], me["final"]) == (50, 50) and [a["title"] for a in r["weak_areas"]] == ["Units"]
    assert "stu2@x.com" in fac.get(f"/api/reports/courses/{c['id']}?format=csv").text
    assert code_of(stu.get(f"/api/reports/courses/{c['id']}")) == "auth.forbidden"
    sid = stu.get("/api/auth/me").json()["id"]
    s = fac.get(f"/api/reports/students/{sid}").json()
    assert s["courses"][0]["completed"] == 1 and s["summary"] == {"strong": ["Hardness"], "needs_study": ["Units"]}
    assert code_of(fac.get(f"/api/reports/students/{fac.get('/api/auth/me').json()['id']}")) == "user.not_a_student"


def test_settings_branding_ai_key_prompts_and_audit(admin, anon):
    s = admin.get("/api/admin/settings").json()
    assert s["ai_key_set"] is False and s["prompts"]["explain"]["value"] == ""
    logo = admin.post("/api/uploads", content=PNG).json()["url"]
    assert code_of(admin.patch("/api/admin/settings", json={"logo": "https://x.example/a.png"})) == "upload.use_uploaded_image"
    assert code_of(admin.patch("/api/admin/settings", json={"ai_daily_limit": "0"})) == "settings.limit_out_of_range"
    s = admin.patch("/api/admin/settings", json={"app_name": "Green School", "logo": logo, "ai_key": "sk-secret", "self_registration": True,
                                                 "allowed_domains": " @School.org, x.edu ", "prompts": {"explain": "Be brief."}}).json()
    assert (s["ai_key_set"], s["allowed_domains"], s["self_registration"], s["prompts"]["explain"]["value"]) == (True, "school.org,x.edu", "1", "Be brief.")
    assert "sk-secret" not in str(s)
    assert anon.get("/api/auth/config").json()["app_name"] == "Green School"
    log = admin.get("/api/admin/audit?action=settings").json()["items"]
    assert log[0]["user"] == "Admin" and "sk-secret" not in str(log)
    add_user("f@x.com", "faculty")
    assert code_of(Api().login("f@x.com").get("/api/admin/settings")) == "auth.forbidden"
