from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ProgramIn(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    pattern: Literal["semester", "year", "grade"] = "semester"
    terms: int | None = Field(default=None, ge=0, le=12)


class ProgramPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    pattern: Literal["semester", "year", "grade"] | None = None


class TermIn(BaseModel):
    number: int = Field(ge=1, le=12)
    name: str = Field(default="", max_length=150)


class TermPatch(BaseModel):
    name: str | None = Field(default=None, max_length=150)
    number: int | None = Field(default=None, ge=1, le=12)


class RolloverIn(BaseModel):
    finishing: Literal["keep", "deactivate"] = "keep"
    dry_run: bool = True


class ArchiveIn(BaseModel):
    archived: bool


class CourseIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    term_id: int
    owner_id: int | None = None
    description: str = Field(default="", max_length=4000)


class CoursePatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    owner_id: int | None = None
    term_id: int | None = None
    visibility: Literal["private", "program"] | None = None


class SharesIn(BaseModel):
    term_ids: list[int] = Field(max_length=200)


class TitleIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class UnitPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    course_id: int | None = None


class OrderIn(BaseModel):
    ids: list[int] = Field(max_length=2000)


class TopicIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(default="", max_length=300)
    content: str = Field(default="", max_length=5_000_000)
    content_format: Literal["markdown", "html"] = "markdown"
    question_pattern: str = Field(default="", max_length=20000)
    sample_answer: str = Field(default="", max_length=50000)
    answer_guide: str = Field(default="", max_length=20000)
    published: bool | None = None
    due_at: dt.datetime | None = None

    @field_validator("due_at")
    @classmethod
    def utc(cls, v: dt.datetime | None) -> dt.datetime | None:
        return v.astimezone(dt.UTC).replace(tzinfo=None) if v and v.tzinfo else v


class TopicPatch(TopicIn):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content_format: Literal["markdown", "html"] | None = None
    unit_id: int | None = None


class CopyIn(BaseModel):
    unit_id: int | None = None
    course_id: int | None = None
