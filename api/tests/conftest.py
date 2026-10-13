import os
import tempfile

_tmp = tempfile.mkdtemp()
os.environ.update(SECRET_KEY="t" * 40, DATABASE_URL=f"sqlite:///{_tmp}/test.db", UPLOAD_DIR=f"{_tmp}/uploads", PASSWORD_ROUNDS="16")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.db import Base, SessionLocal, engine  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.main import app  # noqa: E402
from app.modules.auth.service import new_session_key  # noqa: E402
from app.modules.users.models import User  # noqa: E402

PW = "password1"


class Api:
    """A signed-in browser: keeps its own session cookie and sends the header writes need."""

    def __init__(self):
        self.c = TestClient(app, headers={"X-Requested-With": "fetch"})

    def login(self, email, password=PW):
        r = self.c.post("/api/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200, r.text
        return self

    def __getattr__(self, name):  # api.get(...), api.post(...)
        return getattr(self.c, name)


def add_user(email, role="student", must_change=False, **kw):
    with SessionLocal() as s:
        u = User(email=email, name=kw.pop("name", email.split("@")[0].title()), role=role, password_hash=hash_password(PW),
                 session_key=new_session_key(), must_change_password=must_change, **kw)
        s.add(u)
        s.commit()
        return u.id


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture
def admin():
    add_user("admin@x.com", "admin")
    return Api().login("admin@x.com")


@pytest.fixture
def faculty():
    add_user("fac@x.com", "faculty")
    return Api().login("fac@x.com")


@pytest.fixture
def anon():
    return Api()
