from __future__ import annotations

import datetime as dt

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow


class Material(Base):
    """What a course is being built from: the paragraphs of the uploaded material and the outline being worked on (R-PER-2/3)."""
    __tablename__ = "materials"
    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), unique=True)
    sources: Mapped[list] = mapped_column(JSON, default=list)  # [{"name", "kind", "paragraphs", "words"}]
    paragraphs: Mapped[list] = mapped_column(JSON, default=list)  # MySQL and MariaDB JSON hold up to 1 GB
    notes: Mapped[str] = mapped_column(Text, default="")
    outline: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # {"units": [{"title", "topics": [{"title", "summary", "start", "end"}]}]}
    sliced_by: Mapped[str] = mapped_column(String(10), default="")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
