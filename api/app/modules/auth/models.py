from __future__ import annotations

import datetime as dt

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow


class LoginFailure(Base):
    __tablename__ = "login_failures"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(190), index=True)
    at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, index=True)


class PasswordReset(Base):
    __tablename__ = "password_resets"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime)
    used_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


class PendingRegistration(Base):
    __tablename__ = "pending_registrations"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(190), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    locale: Mapped[str] = mapped_column(String(10), default="en", server_default="en")
    code_hash: Mapped[str] = mapped_column(String(64))
    tries: Mapped[int] = mapped_column(Integer, default=0)
    sends: Mapped[int] = mapped_column(Integer, default=1)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime)
    sent_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
