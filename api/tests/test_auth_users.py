from app.core import mail
from app.core.config import settings
from tests.conftest import PW, Api, add_user


def code_of(r):
    return r.json()["error"]["code"]


def test_sign_in_cookie_session_and_errors_are_codes(anon):
    add_user("s@x.com")
    r = anon.post("/api/auth/login", json={"email": "S@x.com", "password": "nope"})
    assert r.status_code == 401 and code_of(r) == "auth.wrong_credentials"
    assert anon.get("/api/auth/me").status_code == 401
    r = anon.post("/api/auth/login", json={"email": "s@x.com", "password": PW})
    assert r.status_code == 200 and r.json()["role"] == "student" and "session" in anon.c.cookies
    assert anon.get("/api/auth/me").json()["email"] == "s@x.com"
    assert anon.post("/api/auth/logout").status_code == 204 and anon.get("/api/auth/me").status_code == 401
    bad = anon.post("/api/auth/login", json={"email": "not-an-email", "password": ""})
    assert bad.status_code == 422 and code_of(bad) == "validation.failed" and set(bad.json()["error"]["fields"]) == {"email", "password"}


def test_writes_need_the_fetch_header(anon):
    add_user("s@x.com")
    from fastapi.testclient import TestClient

    from app.main import app
    bare = TestClient(app)
    r = bare.post("/api/auth/login", json={"email": "s@x.com", "password": PW})
    assert r.status_code == 403 and code_of(r) == "auth.csrf"


def test_lockout_after_five_failures(anon):
    add_user("s@x.com")
    for _ in range(5):
        anon.post("/api/auth/login", json={"email": "s@x.com", "password": "wrong"})
    r = anon.post("/api/auth/login", json={"email": "s@x.com", "password": PW})
    assert r.status_code == 429 and code_of(r) == "auth.locked" and r.json()["error"]["params"] == {"minutes": 15}


def test_forced_password_change_and_session_rotation(anon):
    add_user("new@x.com", must_change=True)
    anon.login("new@x.com")
    assert code_of(anon.get("/api/home")) == "auth.password_change_required"
    other = Api().login("new@x.com")
    r = anon.post("/api/auth/password", json={"current": PW, "new": "brand-new-1"})
    assert r.status_code == 200 and r.json()["must_change_password"] is False
    assert anon.get("/api/home").status_code == 200
    assert other.get("/api/auth/me").status_code == 401  # the old session ended everywhere else


def test_password_reset_by_email(anon, monkeypatch):
    add_user("s@x.com")
    monkeypatch.setattr(settings.__class__, "mail_enabled", property(lambda self: True))
    monkeypatch.setattr("app.core.mail.smtplib.SMTP", None)
    monkeypatch.setattr(mail, "send", lambda to, subject, body: mail.outbox.append(body))
    mail.outbox.clear()
    assert anon.post("/api/auth/forgot", json={"email": "s@x.com"}).status_code == 204
    assert anon.post("/api/auth/forgot", json={"email": "nobody@x.com"}).status_code == 204  # same answer
    token = mail.outbox[-1].split("#")[1].strip()
    assert anon.post("/api/auth/reset", json={"token": token, "password": "another-1"}).status_code == 200
    assert code_of(anon.post("/api/auth/reset", json={"token": token, "password": "another-2"})) == "auth.reset_invalid"  # single use
    Api().login("s@x.com", "another-1")


def test_self_registration_with_code(admin, anon, monkeypatch):
    monkeypatch.setattr(settings.__class__, "mail_enabled", property(lambda self: True))
    monkeypatch.setattr(mail, "send", lambda to, subject, body: mail.outbox.append(body))
    assert code_of(anon.post("/api/auth/register", json={"name": "A", "email": "a@school.org", "password": "longenough"})) == "auth.registration_closed"
    from app.core.db import SessionLocal
    from app.modules.admin import service as cfg
    with SessionLocal() as s:
        cfg.put(s, "self_registration", "1")
        cfg.put(s, "allowed_domains", "school.org")
        s.commit()
    assert code_of(anon.post("/api/auth/register", json={"name": "A", "email": "a@gmail.com", "password": "longenough"})) == "auth.domain_not_allowed"
    assert anon.post("/api/auth/register", json={"name": "A", "email": "a@school.org", "password": "longenough"}).status_code == 204
    code = mail.outbox[-1].split("code is ")[1][:6]
    wrong = anon.post("/api/auth/register/verify", json={"email": "a@school.org", "code": "000000" if code != "000000" else "111111"})
    assert code_of(wrong) == "auth.code_wrong" and wrong.json()["error"]["params"]["left"] == 4
    me = anon.post("/api/auth/register/verify", json={"email": "a@school.org", "code": code}).json()
    assert me["self_registered"] is True and me["role"] == "student"
    assert anon.put("/api/auth/me/ai-key", json={"key": "sk-mine"}).json()["own_ai_key"] is True


def test_admin_manages_users_but_not_themselves(admin):
    p = admin.post("/api/programs", json={"name": "B.E. Mech", "pattern": "semester"}).json()
    r = admin.post("/api/users", json={"name": "Asha", "email": "asha@x.com", "role": "student", "program_id": p["id"], "term_no": 3}).json()
    assert len(r["password"]) == 10 and r["program"] == "B.E. Mech" and r["must_change_password"] is True
    assert code_of(admin.post("/api/users", json={"name": "B", "email": "ASHA@x.com"})) == "user.email_taken"
    assert code_of(admin.post("/api/users", json={"name": "C", "email": "c@x.com", "program_id": p["id"], "term_no": 9})) == "program.term_out_of_range"
    me = admin.get("/api/auth/me").json()["id"]
    assert code_of(admin.patch(f"/api/users/{me}", json={"role": "student"})) == "user.cannot_change_self"
    student = Api().login("asha@x.com", r["password"])
    admin.patch(f"/api/users/{r['id']}", json={"active": False})
    assert student.get("/api/auth/me").status_code == 401  # signed out everywhere
    assert admin.get("/api/users?q=ash").json()["total"] == 1
    assert code_of(Api().post("/api/auth/login", json={"email": "asha@x.com", "password": r["password"]})) == "auth.disabled"


def test_bulk_and_csv_import(admin):
    p = admin.post("/api/programs", json={"name": "School", "pattern": "grade"}).json()
    ids = [admin.post("/api/users", json={"name": n, "email": f"{n}@x.com"}).json()["id"] for n in ("a", "b")]
    me = admin.get("/api/auth/me").json()["id"]
    r = admin.post("/api/users/bulk", json={"ids": ids + [me], "action": "place", "program_id": p["id"], "term_no": 10}).json()
    assert r["changed"] == 2 and r["skipped"][0]["reason"] == "user.only_students_placed"
    csv = "name,email,role,program,term\nC,c@x.com,student,School,12\nD,d@x.com,student,Nowhere,1\nE,bad,student,,\n"
    dry = admin.post("/api/users/import", json={"csv": csv, "dry_run": True}).json()
    assert (dry["created"], dry["error_count"]) == (1, 2) and {e["code"] for e in dry["errors"]} == {"import.program_unknown", "user.email_invalid"}
    real = admin.post("/api/users/import", json={"csv": csv, "dry_run": False}).json()
    assert real["created"] == 1 and real["credentials"][0]["email"] == "c@x.com"
    assert admin.get("/api/users?q=c@x.com").json()["items"][0]["term_no"] == 12


def test_students_cannot_reach_admin_routes():
    add_user("s@x.com")
    s = Api().login("s@x.com")
    assert code_of(s.get("/api/users")) == "auth.forbidden" and code_of(s.post("/api/programs", json={"name": "X"})) == "auth.forbidden"


def test_import_without_roles_keeps_staff_roles(admin):
    from tests.conftest import add_user as _add
    _add("prof@x.com", "faculty")
    r = admin.post("/api/users/import", json={"csv": "name,email\nProf,prof@x.com\nNew,new@x.com\n", "dry_run": False}).json()
    assert (r["created"], r["updated"]) == (1, 1)
    users = {u["email"]: u["role"] for u in admin.get("/api/users").json()["items"]}
    assert users["prof@x.com"] == "faculty" and users["new@x.com"] == "student"
