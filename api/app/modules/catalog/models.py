from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, Timestamped, utcnow

LongText = Text().with_variant(mysql.LONGTEXT(), "mysql")
PATTERNS = {"semester": ("Semester", 8, 8), "year": ("Year", 8, 4), "grade": ("Grade", 12, 12)}  # label, most terms, default terms (R-PROG-1/2)


class Program(Timestamped, Base):
    __tablename__ = "programs"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), unique=True)
    pattern: Mapped[str] = mapped_column(String(10), default="semester")
    archived_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


class Term(Base):
    __tablename__ = "terms"
    __table_args__ = (UniqueConstraint("program_id", "number"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    program_id: Mapped[int] = mapped_column(ForeignKey("programs.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(150))
    archived_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


class Course(Timestamped, Base):
    """kind=catalog: staff-made, has a home term, an owner who edits it, can be shared into other terms.
    kind=personal: a student's own, built from their material; owner is the student; visibility private|program."""
    __tablename__ = "courses"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(10), default="catalog")
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    term_id: Mapped[int | None] = mapped_column(ForeignKey("terms.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    visibility: Mapped[str] = mapped_column(String(10), default="private")
    status: Mapped[str] = mapped_column(String(10), default="ready")  # personal courses are 'setup' until their outline is applied
    archived_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class CourseShare(Base):
    __tablename__ = "course_shares"
    __table_args__ = (UniqueConstraint("course_id", "term_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    term_id: Mapped[int] = mapped_column(ForeignKey("terms.id", ondelete="CASCADE"), index=True)


class Unit(Base):
    __tablename__ = "units"
    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    position: Mapped[int] = mapped_column(Integer, default=0)
    archived_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


class Topic(Base):
    __tablename__ = "topics"
    id: Mapped[int] = mapped_column(primary_key=True)
    unit_id: Mapped[int] = mapped_column(ForeignKey("units.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str] = mapped_column(String(300), default="")
    content: Mapped[str] = mapped_column(LongText, default="")
    content_format: Mapped[str] = mapped_column(String(10), default="markdown")
    question_pattern: Mapped[str] = mapped_column(Text, default="")
    sample_answer: Mapped[str] = mapped_column(Text, default="")
    answer_guide: Mapped[str] = mapped_column(Text, default="")
    published: Mapped[bool] = mapped_column(Boolean, default=True)
    due_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    archived_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class TopicVersion(Base):
    __tablename__ = "topic_versions"
    id: Mapped[int] = mapped_column(primary_key=True)
    topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(LongText, default="")
    content_format: Mapped[str] = mapped_column(String(10), default="markdown")
    question_pattern: Mapped[str] = mapped_column(Text, default="")
    sample_answer: Mapped[str] = mapped_column(Text, default="")
    answer_guide: Mapped[str] = mapped_column(Text, default="")
    saved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    saved_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    note: Mapped[str] = mapped_column(String(200), default="")
