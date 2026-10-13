from __future__ import annotations

import datetime as dt

from sqlalchemy import DateTime, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow


class TopicProgress(Base):
    """One row per learner and topic, made when they first open it (R-LRN-1), with its review schedule (R-LRN-3)."""
    __tablename__ = "topic_progress"
    __table_args__ = (UniqueConstraint("user_id", "topic_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id", ondelete="CASCADE"), index=True)
    opened_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    last_opened_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    completed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    review_due: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    review_step: Mapped[int] = mapped_column(Integer, default=0)
