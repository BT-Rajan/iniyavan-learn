"""Command line:
  python -m app.cli create-admin EMAIL NAME     first admin (asks for a password)
  python -m app.cli reset-password EMAIL        new password for anyone, e.g. a locked-out admin (asks for it)
  python -m app.cli list-admins                 who the admins are
  python -m app.cli demo                        a sample school for trying the app
"""
from __future__ import annotations

import getpass
import os
import sys

from sqlalchemy import select

from app import models  # noqa: F401
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.modules.auth.service import new_session_key
from app.modules.users.models import User

DEMO_PASSWORD = "demo-pass-1"


def create_admin(email: str, name: str, password: str | None = None) -> None:
    password = password or _ask_password()
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.email == email.lower())):
            sys.exit(f"{email} already has an account.")
        db.add(User(email=email.lower(), name=name, role="admin", password_hash=hash_password(password), session_key=new_session_key()))
        db.commit()
    print(f"Admin {email} created.")


def _ask_password() -> str:
    password = os.getenv("ADMIN_PASSWORD") or getpass.getpass("New password (8+ characters, typing is hidden): ")
    if len(password) < 8:
        sys.exit("The password needs at least 8 characters.")
    if not os.getenv("ADMIN_PASSWORD") and getpass.getpass("Type it again: ") != password:
        sys.exit("The two passwords don't match. Nothing was changed.")
    return password


def reset_password(email: str) -> None:
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email.lower()))
        if not user:
            sys.exit(f"No account with the email {email}. See the admins with: python -m app.cli list-admins")
        user.password_hash = hash_password(_ask_password())
        user.must_change_password, user.active = False, True
        user.session_key = new_session_key()  # signs out every old session
        db.commit()
    print(f"New password set for {email}. Sign in with it now.")


def list_admins() -> None:
    with SessionLocal() as db:
        admins = list(db.scalars(select(User).where(User.role == "admin").order_by(User.id)))
    for u in admins:
        print(f"{u.email}\t{u.name}\t{'active' if u.active else 'turned off'}")
    if not admins:
        print("No admins yet. Create one: python -m app.cli create-admin EMAIL NAME")


def _user(db, email, name, role, **kw) -> User:
    u = User(email=email, name=name, role=role, password_hash=hash_password(DEMO_PASSWORD), session_key=new_session_key(), **kw)
    db.add(u)
    db.flush()
    return u


def demo() -> None:
    """A small school through the same services the API uses, so every rule applies."""
    from app.modules.assessment import service as asm
    from app.modules.catalog import service as catalog
    from app.modules.catalog.models import Term

    with SessionLocal() as db:
        if db.scalar(select(User).where(User.email == "admin@demo.school")):
            sys.exit("The demo data is already there.")
        admin = _user(db, "admin@demo.school", "Asha Admin", "admin")
        fac = _user(db, "teacher@demo.school", "Tamil Teacher", "faculty")
        p = catalog.create_program(db, admin, "Green School", "grade", None)
        g8 = db.scalar(select(Term).where(Term.program_id == p.id, Term.number == 8))
        _user(db, "student@demo.school", "Sam Student", "student", program_id=p.id, term_no=8)
        _user(db, "student2@demo.school", "Priya Pupil", "student", program_id=p.id, term_no=8)
        course = catalog.create_catalog_course(db, admin, "Science", g8.id, fac.id, "Water, air and everyday chemistry.")
        water = catalog.create_unit(db, admin, course, "Water")
        topics = [
            ("Hard and soft water", "What makes water hard",
             "## Hard water\n\nWater is **hard** when it holds dissolved calcium and magnesium salts.\n\n"
             "| Kind | Cause | Removed by |\n|---|---|---|\n| Temporary | Bicarbonates | Boiling |\n| Permanent | Sulphates, chlorides | Washing soda, ion exchange |\n\n"
             "Hard water wastes soap: the salts react with soap to form scum instead of lather."),
            ("Boiling removes temporary hardness", "Why boiling works",
             "Boiling turns soluble calcium bicarbonate into insoluble calcium carbonate, which settles as scale.\n\n"
             "That is why kettles in hard-water areas collect a white crust."),
            ("Water treatment", "From river to tap",
             "Drinking water is treated in steps: **screening**, **sedimentation**, **filtration** and **chlorination**.\n\n"
             "Each step removes a different kind of impurity, from floating leaves to germs."),
        ]
        ids = []
        for title, summary, content in topics:
            t = catalog.create_topic(db, admin, water, course, {"title": title, "summary": summary, "content": content, "content_format": "markdown",
                                                        "question_pattern": "Explain with an example (5 marks).", "answer_guide": "Definition, cause, example.",
                                                        "sample_answer": "", "published": True, "due_at": None})
            ids.append(t.id)
        air = catalog.create_unit(db, admin, course, "Air")
        catalog.create_topic(db, admin, air, course, {"title": "What air is made of", "summary": "Nitrogen, oxygen and the rest",
                                              "content": "Air is a mixture: about 78% nitrogen, 21% oxygen and 1% other gases.", "content_format": "markdown",
                                              "question_pattern": "", "answer_guide": "", "sample_answer": "", "published": True, "due_at": None})
        quiz = asm.create_test(db, admin, course, {"title": "Water check", "unit_id": water.id, "pass_percent": 60, "reveal": True, "published": True})
        asm.replace_questions(db, admin, quiz, [
            {"text": "Which salts make water hard?", "image": "", "options": [{"text": "Calcium and magnesium", "image": ""}, {"text": "Sodium and potassium", "image": ""},
                                                                              {"text": "Iron and copper", "image": ""}], "correct": 0,
             "explanation": "Dissolved calcium and magnesium salts cause hardness.", "topic_id": ids[0], "area": ""},
            {"text": "Boiling removes which hardness?", "image": "", "options": [{"text": "Temporary", "image": ""}, {"text": "Permanent", "image": ""}], "correct": 0,
             "explanation": "Bicarbonates break down on boiling.", "topic_id": ids[1], "area": ""},
            {"text": "Which step kills germs?", "image": "", "options": [{"text": "Screening", "image": ""}, {"text": "Sedimentation", "image": ""},
                                                                     {"text": "Chlorination", "image": ""}], "correct": 2,
             "explanation": "Chlorine kills germs.", "topic_id": ids[2], "area": ""},
        ])
        db.commit()
    print(f"Demo ready. Sign in as admin@demo.school, teacher@demo.school or student@demo.school with password {DEMO_PASSWORD}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["create-admin"] and len(args) >= 3:
        create_admin(args[1], " ".join(args[2:]))
    elif args[:1] == ["reset-password"] and len(args) == 2:
        reset_password(args[1])
    elif args == ["list-admins"]:
        list_admins()
    elif args == ["demo"]:
        demo()
    else:
        sys.exit(__doc__)
