"""Tests from a CSV (R-ASM-2): a preview with row errors and the image files still to upload. Nothing is saved here."""
from __future__ import annotations

import csv
import io
import re
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.modules.catalog.content import IMAGE_URL
from app.modules.catalog.models import Topic, Unit

LETTERS = "abcdef"
ALIASES = {"question": ("question", "question_text", "q"), "correct": ("correct", "answer", "correct_answer", "key"),
           "explanation": ("explanation", "solution", "reason"), "topic": ("topic",), "area": ("area", "skill", "concept", "tag"),
           "unit": ("unit",), "image": ("question_image", "image", "q_image")}
for _l in LETTERS:
    ALIASES["opt_" + _l] = (_l, "option_" + _l, "answer_" + _l, "choice_" + _l)
    ALIASES["img_" + _l] = (_l + "_image", "option_" + _l + "_image", "image_" + _l)


def _key(h: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (h or "").strip().lower()).strip("_")


def _image(v: str) -> tuple[str, str]:
    v = (v or "").strip()
    if not v:
        return "", ""
    return (v, "") if IMAGE_URL.fullmatch(v) else ("", re.split(r"[\\/]", v)[-1][:200])


def rows_of(text: str) -> list[list[str]]:
    text = text.lstrip("﻿")
    if len(text) > 2_000_000:
        raise AppError("import.too_large", 413, max_mb=2)
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    return [r for r in csv.reader(io.StringIO(text), dialect) if any((c or "").strip() for c in r)]


def parse(db: Session, course_id: int, unit_id: int | None, text: str, limit: int) -> dict:
    rows = rows_of(text)
    if not rows:
        raise AppError("import.empty")
    head = [_key(h) for h in rows[0]]
    col = {name: next((i for i, h in enumerate(head) if h in keys), None) for name, keys in ALIASES.items()}
    col = {k: v for k, v in col.items() if v is not None}
    letters = [ch for ch in LETTERS if "opt_" + ch in col]
    if "question" not in col or "correct" not in col or len(letters) < 2:
        raise AppError("import.columns_missing", 400, columns="question, a, b, correct")
    if len(rows) - 1 > limit:
        raise AppError("quiz.too_many_questions", 400, max=limit)
    unit_ids = [unit_id] if unit_id else list(db.scalars(select(Unit.id).where(Unit.course_id == course_id)))
    units = {u.id: u for u in db.scalars(select(Unit).where(Unit.id.in_(unit_ids or [0])))}
    by_title = defaultdict(list)
    for t in db.scalars(select(Topic).where(Topic.unit_id.in_(list(units) or [0]))):
        by_title[t.title.strip().lower()].append(t)

    def cell(r, k):
        return (r[col[k]] if k in col and col[k] < len(r) else "").strip()

    questions, errors, warnings = [], [], []
    for n, r in enumerate(rows[1:], start=2):
        text_, (qimg, qname) = cell(r, "question"), _image(cell(r, "image"))
        opts = [(cell(r, "opt_" + ch), *_image(cell(r, "img_" + ch))) for ch in letters]
        while opts and not any(opts[-1]):
            opts.pop()
        if not text_ and not (qimg or qname):
            errors.append({"row": n, "code": "question.text_required", "params": {"number": n - 1}})
            continue
        if len(opts) < 2:
            errors.append({"row": n, "code": "question.options_invalid", "params": {"number": n - 1}})
            continue
        gap = next((LETTERS[i].upper() for i, o in enumerate(opts) if not any(o)), None)
        if gap:
            errors.append({"row": n, "code": "import.answer_empty", "params": {"letter": gap}})
            continue
        raw = cell(r, "correct")
        if re.fullmatch(r"[A-Fa-f]\s*[,;/&]\s*[A-Fa-f].*", raw):
            errors.append({"row": n, "code": "import.one_correct_only", "params": {}})
            continue
        k = LETTERS.index(raw.lower()) if re.fullmatch(r"[A-Fa-f]", raw) else int(raw) - 1 if re.fullmatch(r"[1-6]", raw) else \
            next((i for i, o in enumerate(opts) if o[0] and o[0].lower() == raw.lower()), -1)
        if not 0 <= k < len(opts):
            errors.append({"row": n, "code": "import.correct_invalid", "params": {"last": LETTERS[len(opts) - 1].upper()}})
            continue
        tname, uname, area, tid = cell(r, "topic"), cell(r, "unit").lower(), cell(r, "area")[:150], None
        if tname:
            hits = [t for t in by_title.get(tname.lower(), []) if not uname or units[t.unit_id].title.strip().lower() == uname]
            if len(hits) > 1:
                warnings.append({"row": n, "code": "import.topic_ambiguous", "params": {"topic": tname}})
            if hits:
                tid = hits[0].id
            else:
                warnings.append({"row": n, "code": "import.topic_unknown", "params": {"topic": tname}})
                area = area or tname[:150]
        questions.append({"row": n, "text": text_, "image": qimg, "image_name": qname, "correct": k, "explanation": cell(r, "explanation"),
                          "topic_id": tid, "area": area, "options": [{"text": o[0], "image": o[1], "image_name": o[2]} for o in opts]})
    names = sorted({x["image_name"] for x in questions if x["image_name"]} | {o["image_name"] for x in questions for o in x["options"] if o["image_name"]}, key=str.lower)
    return {"questions": questions, "errors": errors[:200], "error_count": len(errors), "warnings": warnings[:200], "images_needed": names}
