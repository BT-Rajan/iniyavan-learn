"""Database engine, session and the declarative base every model uses."""
from __future__ import annotations

import datetime as dt
from collections.abc import Iterator

from sqlalchemy import DateTime, MetaData, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from .config import settings

NAMING = {"ix": "ix_%(column_0_label)s", "uq": "uq_%(table_name)s_%(column_0_name)s", "ck": "ck_%(table_name)s_%(constraint_name)s",
          "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s", "pk": "pk_%(table_name)s"}


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.UTC).replace(tzinfo=None)  # stored as naive UTC everywhere


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


class Timestamped:
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)


def make_engine(url: str):
    if url.startswith("sqlite:///"):
        from pathlib import Path
        Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    eng = create_engine(url, pool_pre_ping=True, connect_args={"check_same_thread": False} if url.startswith("sqlite") else {})
    if url.startswith("sqlite"):
        @event.listens_for(eng, "connect")
        def _fk(conn, _):  # SQLite only enforces foreign keys (and cascades) when asked
            conn.execute("PRAGMA foreign_keys=ON")
    return eng


engine = make_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    with SessionLocal() as s:
        yield s


def get_or_404(db: Session, model, ident, what: str):
    """The row, or a 404 whose code names what was missing (e.g. course.not_found)."""
    from .errors import not_found
    row = db.get(model, ident) if ident is not None else None
    if row is None:
        raise not_found(what)
    return row
