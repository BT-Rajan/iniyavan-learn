from tests.conftest import Api, add_user


def code_of(r):
    return r.json()["error"]["code"]


def setup_school(admin):
    """Program 'Mech' (semesters), a course in Semester 1 and one in Semester 3, a faculty owner and a student in Semester 2."""
    p = admin.post("/api/programs", json={"name": "Mech", "pattern": "semester", "terms": 4}).json()
    t = {x["number"]: x["id"] for x in p["terms"]}
    fid = add_user("fac@x.com", "faculty")
    chem = admin.post("/api/courses", json={"title": "Chemistry", "term_id": t[1], "owner_id": fid}).json()
    adv = admin.post("/api/courses", json={"title": "Thermo", "term_id": t[3]}).json()
    add_user("stu@x.com", program_id=p["id"], term_no=2)
    return p, t, chem, adv, Api().login("fac@x.com"), Api().login("stu@x.com")


def test_program_patterns_terms_and_renaming(admin):
    p = admin.post("/api/programs", json={"name": "School", "pattern": "grade"}).json()
    assert [x["name"] for x in p["terms"]] == [f"Grade {n}" for n in range(1, 13)] and p["term_label"] == "Grade"
    y = admin.post("/api/programs", json={"name": "MBBS", "pattern": "year", "terms": 5}).json()
    assert len(y["terms"]) == 5
    assert code_of(admin.post("/api/programs", json={"name": "mbbs"})) == "program.name_taken"
    assert code_of(admin.post("/api/programs", json={"name": "Z", "pattern": "semester", "terms": 9})) == "program.terms_out_of_range"
    assert code_of(admin.patch(f"/api/programs/{p['id']}", json={"pattern": "semester"})) == "program.terms_do_not_fit"
    admin.patch(f"/api/terms/{y['terms'][0]['id']}", json={"name": "Foundation"})
    y2 = admin.patch(f"/api/programs/{y['id']}", json={"pattern": "grade"}).json()
    assert [x["name"] for x in y2["terms"]][:3] == ["Foundation", "Grade 2", "Grade 3"] and len(y2["terms"]) == 12  # a school gets all 12 grades
    assert code_of(admin.post(f"/api/programs/{y['id']}/terms", json={"number": 2})) == "term.number_taken"


def test_rollover_moves_students_up(admin):
    p = admin.post("/api/programs", json={"name": "Mech", "terms": 2}).json()
    a, b = add_user("a@x.com", program_id=p["id"], term_no=1), add_user("b@x.com", program_id=p["id"], term_no=2)
    dry = admin.post(f"/api/programs/{p['id']}/rollover", json={"dry_run": True}).json()
    assert (dry["moving"], dry["finishing"], dry["last_term"]) == (1, 1, 2)
    admin.post(f"/api/programs/{p['id']}/rollover", json={"dry_run": False, "finishing": "deactivate"})
    users = {u["email"]: u for u in admin.get("/api/users").json()["items"]}
    assert users["a@x.com"]["term_no"] == 2 and users["b@x.com"]["active"] is False and a and b


def test_students_see_their_program_up_to_their_term_and_shared_courses(admin):
    p, t, chem, adv, fac, stu = setup_school(admin)
    b = stu.get("/api/browse").json()
    assert [(g["term"], [c["title"] for c in g["courses"]]) for g in b["terms"]] == [("Semester 1", ["Chemistry"])]
    assert code_of(stu.get(f"/api/courses/{adv['id']}")) == "course.not_found"
    admin.put(f"/api/courses/{adv['id']}/shares", json={"term_ids": [t[2]]})
    b = stu.get("/api/browse").json()
    assert {(g["term"], c["title"], c["shared_from"]) for g in b["terms"] for c in g["courses"]} == {("Semester 1", "Chemistry", None), ("Semester 2", "Thermo", "Semester 3")}
    other = admin.post("/api/programs", json={"name": "Civil"}).json()
    admin.patch(f"/api/users/{stu.get('/api/auth/me').json()['id']}", json={"program_id": other["id"], "term_no": 1})
    assert stu.get("/api/browse").json()["terms"] == []


def test_only_the_owner_and_admins_edit_and_drafts_stay_hidden(admin):
    p, t, chem, adv, fac, stu = setup_school(admin)
    unit = fac.post(f"/api/courses/{chem['id']}/units", json={"title": "Water"}).json()
    assert code_of(fac.post(f"/api/courses/{adv['id']}/units", json={"title": "x"})) == "course.not_editable"
    assert code_of(stu.post(f"/api/courses/{chem['id']}/units", json={"title": "x"})) == "course.not_editable"
    draft = fac.post(f"/api/units/{unit['id']}/topics", json={"title": "Hardness", "content": "Ca and Mg"}).json()["id"]  # faculty topics start as drafts
    live = admin.post(f"/api/units/{unit['id']}/topics", json={"title": "Boiling", "content": "x"}).json()["id"]
    seen = stu.get(f"/api/courses/{chem['id']}").json()
    assert [t_["title"] for u in seen["units"] for t_ in u["topics"]] == ["Boiling"] and seen["progress"]["topics"] == 1
    assert code_of(stu.get(f"/api/topics/{draft}")) == "topic.not_found"
    fac.patch(f"/api/topics/{draft}", json={"published": True})
    assert stu.get(f"/api/topics/{draft}").json()["status"] == "in_progress"  # opening it starts it
    fac.put(f"/api/units/{unit['id']}/topics/order", json={"ids": [live, draft]})
    assert [x["title"] for x in stu.get(f"/api/courses/{chem['id']}").json()["units"][0]["topics"]] == ["Boiling", "Hardness"]
    assert code_of(fac.put(f"/api/units/{unit['id']}/topics/order", json={"ids": [live]})) == "order.mismatch"
    t1 = stu.get(f"/api/topics/{live}").json()
    assert (t1["next"]["id"], t1["prev"], t1["position"], t1["total"]) == (draft, None, 1, 2)
    admin.patch(f"/api/courses/{chem['id']}", json={"owner_id": None})
    assert code_of(fac.patch(f"/api/topics/{live}", json={"title": "x"})) == "course.not_editable"
    assert code_of(fac.patch(f"/api/courses/{chem['id']}", json={"owner_id": 1})) == "course.not_editable"


def test_archive_hides_everything_under_it_and_restore_needs_the_parent(admin):
    p, t, chem, adv, fac, stu = setup_school(admin)
    u = admin.post(f"/api/courses/{chem['id']}/units", json={"title": "Water"}).json()
    tid = admin.post(f"/api/units/{u['id']}/topics", json={"title": "Hardness"}).json()["id"]
    admin.put(f"/api/topics/{tid}/archive", json={"archived": True})
    assert code_of(stu.get(f"/api/topics/{tid}")) == "topic.not_found" and admin.get(f"/api/topics/{tid}").json()["archived"] is True
    admin.put(f"/api/topics/{tid}/archive", json={"archived": False})
    admin.put(f"/api/programs/{p['id']}/archive", json={"archived": True})
    assert stu.get("/api/browse").json()["terms"] == [] and code_of(stu.get(f"/api/topics/{tid}")) == "course.not_found"
    admin.put(f"/api/courses/{chem['id']}/archive", json={"archived": True})
    assert code_of(admin.put(f"/api/courses/{chem['id']}/archive", json={"archived": False})) == "archive.parent_archived"
    admin.put(f"/api/programs/{p['id']}/archive", json={"archived": False})
    assert stu.get("/api/browse").json()["terms"] == []  # the course was archived on its own, so it stays archived
    admin.put(f"/api/courses/{chem['id']}/archive", json={"archived": False})
    assert stu.get(f"/api/topics/{tid}").status_code == 200


def test_versions_restore_copy_and_safe_html(admin):
    p, t, chem, adv, fac, stu = setup_school(admin)
    u = admin.post(f"/api/courses/{chem['id']}/units", json={"title": "Water"}).json()
    tid = admin.post(f"/api/units/{u['id']}/topics", json={"title": "Hardness", "content": "v1"}).json()["id"]
    admin.patch(f"/api/topics/{tid}", json={"content": "<p onclick='x()'>v2</p><script>steal()</script><img src=x onerror=y()>", "content_format": "html"})
    shown = admin.get(f"/api/topics/{tid}").json()
    assert shown["content_format"] == "html" and "script" not in shown["content"] and "onclick" not in shown["content"] and "onerror" not in shown["content"]
    vs = admin.get(f"/api/topics/{tid}/versions").json()
    assert len(vs) == 2 and vs[0]["current"]
    admin.post(f"/api/topics/{tid}/versions/{vs[1]['id']}/restore")
    back = admin.get(f"/api/topics/{tid}").json()
    assert (back["content"], back["content_format"]) == ("v1", "markdown")
    assert len(admin.get(f"/api/topics/{tid}/versions").json()) == 3
    u2 = admin.post(f"/api/courses/{adv['id']}/units", json={"title": "Copies"}).json()
    cp = admin.post(f"/api/topics/{tid}/copy", json={"unit_id": u2["id"]}).json()
    assert admin.get(f"/api/topics/{cp['id']}").json()["published"] is False
    cu = admin.post(f"/api/units/{u['id']}/copy", json={"course_id": adv["id"]}).json()
    assert cu["title"] == "Water"


def test_images_are_checked_by_their_bytes(admin, anon):
    png = b"\x89PNG\r\n\x1a\n" + b"\0" * 20
    url = admin.post("/api/uploads", content=png).json()["url"]
    assert anon.get(url).status_code == 200 and anon.get(url).headers["content-type"] == "image/png"
    assert code_of(admin.post("/api/uploads", content=b"<svg onload=x>")) == "upload.not_an_image"
    assert code_of(anon.get("/api/uploads/../../etc/passwd")) in ("upload.not_found", "http.not_found")


def test_deleting_a_course_removes_everything_under_it(admin):
    p, t, chem, adv, fac, stu = setup_school(admin)
    u = admin.post(f"/api/courses/{chem['id']}/units", json={"title": "Water"}).json()
    tid = admin.post(f"/api/units/{u['id']}/topics", json={"title": "Hardness"}).json()["id"]
    stu.get(f"/api/topics/{tid}")
    assert code_of(fac.delete(f"/api/courses/{chem['id']}")) == "auth.forbidden"
    assert admin.delete(f"/api/courses/{chem['id']}").status_code == 204
    from sqlalchemy import func, select

    from app.core.db import SessionLocal
    from app.modules.catalog.models import Topic
    from app.modules.learning.models import TopicProgress
    with SessionLocal() as s:
        assert s.scalar(select(func.count(Topic.id))) == 0 and s.scalar(select(func.count(TopicProgress.id))) == 0


def test_personal_courses_are_private_unless_shared_with_classmates(admin):
    p = admin.post("/api/programs", json={"name": "Mech"}).json()
    add_user("me@x.com", program_id=p["id"], term_no=1)
    add_user("mate@x.com", program_id=p["id"], term_no=1)
    add_user("other@x.com")
    me, mate, other = Api().login("me@x.com"), Api().login("mate@x.com"), Api().login("other@x.com")
    from app.core.db import SessionLocal
    from app.modules.catalog import service
    from app.modules.users.models import User
    with SessionLocal() as s:
        c = service.create_personal_course(s, s.get(User, me.get("/api/auth/me").json()["id"]), "My notes")
        c.status = "ready"
        s.commit()
        cid = c.id
    assert me.get(f"/api/courses/{cid}").json()["can_edit"] is True
    assert code_of(mate.get(f"/api/courses/{cid}")) == "course.not_found"
    me.patch(f"/api/courses/{cid}", json={"visibility": "program"})
    assert [c["title"] for c in mate.get("/api/browse").json()["personal"]] == ["My notes"] and code_of(other.get(f"/api/courses/{cid}")) == "course.not_found"
    assert code_of(mate.patch(f"/api/courses/{cid}", json={"title": "Mine"})) == "course.not_editable"
    assert code_of(other.patch("/api/courses/999", json={"title": "x"})) == "course.not_found"


def test_autosaved_edits_make_one_version_per_sitting(admin):
    p, t, chem, adv, fac, stu = setup_school(admin)
    u = admin.post(f"/api/courses/{chem['id']}/units", json={"title": "Water"}).json()
    tid = admin.post(f"/api/units/{u['id']}/topics", json={"title": "Hardness", "content": "a"}).json()["id"]
    for text in ("ab", "abc", "abcd"):
        admin.patch(f"/api/topics/{tid}", json={"content": text})
    vs = admin.get(f"/api/topics/{tid}/versions").json()
    assert [v["note"] for v in vs] == ["edited", "created"]
    assert admin.get(f"/api/topics/{tid}/versions/{vs[0]['id']}").json()["content"] == "abcd"
