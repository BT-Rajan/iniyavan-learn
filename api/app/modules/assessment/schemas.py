from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class TestIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    unit_id: int | None = None
    pass_percent: int = Field(default=60, ge=1, le=100)
    reveal: bool = False
    published: bool = False


class TestPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    pass_percent: int | None = Field(default=None, ge=1, le=100)
    reveal: bool | None = None
    published: bool | None = None


class OptionIn(BaseModel):
    text: str = Field(default="", max_length=2000)
    image: str = Field(default="", max_length=300)


class QuestionIn(BaseModel):
    text: str = Field(default="", max_length=5000)
    image: str = Field(default="", max_length=300)
    options: list[OptionIn] = Field(max_length=6)
    correct: int
    explanation: str = Field(default="", max_length=5000)
    topic_id: int | None = None
    area: str = Field(default="", max_length=150)


class QuestionsIn(BaseModel):
    questions: list[QuestionIn] = Field(max_length=200)


class CsvIn(BaseModel):
    csv: str = Field(max_length=2_000_000)
    unit_id: int | None = None


class AnswersIn(BaseModel):
    answers: list[int | None] = Field(max_length=200)


class CheckIn(BaseModel):
    index: int
    answer: int


class PracticeIn(BaseModel):
    mode: Literal["quick", "full"] = "quick"


class BankIn(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    options: list[OptionIn] = Field(min_length=2, max_length=6)
    correct: int
    explanation: str = Field(default="", max_length=5000)
    tags: str = Field(default="", max_length=200)


class BankPatch(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=5000)
    options: list[OptionIn] | None = Field(default=None, min_length=2, max_length=6)
    correct: int | None = None
    explanation: str | None = Field(default=None, max_length=5000)
    tags: str | None = Field(default=None, max_length=200)


class FromBankIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=200)


class ToBankIn(BaseModel):
    tags: str = Field(default="", max_length=200)
