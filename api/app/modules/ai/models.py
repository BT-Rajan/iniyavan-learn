from __future__ import annotations

import datetime as dt

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow
from app.modules.catalog.models import LongText


class AICache(Base):
    """A saved AI answer shared by everyone who asks the same thing (R-AI-2); the key covers the input and the prompt."""
    __tablename__ = "ai_cache"
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True)
    kind: Mapped[str] = mapped_column(String(20))
    text: Mapped[str] = mapped_column(LongText)
    hits: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)


class AIUsage(Base):
    __tablename__ = "ai_usage"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    own_key: Mapped[bool] = mapped_column(default=False)
    at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, index=True)
