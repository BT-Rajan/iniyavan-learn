from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, EmailStr, Field

Role = Literal["admin", "faculty", "student"]


class UserIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    role: Role = "student"
    password: str = Field(default="", max_length=200)
    program_id: int | None = None
    term_no: int | None = None


class UserPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    email: EmailStr | None = None
    role: Role | None = None
    active: bool | None = None
    program_id: int | None = None
    term_no: int | None = None


class BulkIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=500)
    action: Literal["disable", "enable", "place", "reset_passwords"]
    program_id: int | None = None
    term_no: int | None = None


class ImportIn(BaseModel):
    csv: str = Field(max_length=2_000_000)
    dry_run: bool = True
