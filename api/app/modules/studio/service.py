"""Building a course from material: sources, slicing, the outline, applying it (R-PER-1..5)."""
from __future__ import annotations

import re

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.modules.admin.service import audit
from app.modules.ai import service as ai
from app.modules.catalog.models import Course, Topic, Unit
from app.modules.users.models import User

from .models import Material

MAX_FILE, MAX_CHARS = 20 * 1024 * 1024, 1_500_000
SLICE_BUDGET = 110_000  # characters sent to the AI; longer material is sent as the start of each paragraph


def material(db: Session, course: Course) -> Material:
    m = db.scalar(select(Material).where(Material.course_id == course.id))
    if not m:
        m = Material(course_id=course.id, sources=[], paragraphs=[])
        db.add(m)
        db.flush()
    return m


def add(db: Session, course: Course, name: str, kind: str, paras: list[str]) -> dict:
    m = material(db, course)
    paras = [p for p in paras if p.strip()]
    if not paras:
        raise AppError("studio.no_text_found", 400, name=name[:80])
    if sum(len(p) for p in m.paragraphs) + sum(len(p) for p in paras) > MAX_CHARS:
        raise AppError("studio.too_much_material", 413)
    src = {"name": name[:200] or "material", "kind": kind, "paragraphs": len(paras), "words": sum(len(p.split()) for p in paras)}
    m.paragraphs, m.sources, m.outline = m.paragraphs + paras, m.sources + [src], None  # new material means a new slice
    db.commit()
    return src


def remove_source(db: Session, course: Course, index: int) -> None:
    m = material(db, course)
    if not 0 <= index < len(m.sources):
        raise AppError("studio.source_not_found", 404)
    start = sum(s["paragraphs"] for s in m.sources[:index])
    paras = list(m.paragraphs)
    del paras[start:start + m.sources[index]["paragraphs"]]
    m.paragraphs, m.sources, m.outline = paras, [s for i, s in enumerate(m.sources) if i != index], None
    db.commit()


SKIP_HEADING = re.compile(
    r"^(table of contents|contents|index|subject index|copyright|acknowledge?ments?|about the (authors?|book|publisher|editors?)|dedication|"
    r"bibliography|references|works cited|further reading|preface|foreword|title page|also by .*|colophon|list of (figures|tables|illustrations)|"
    r"notes on contributors|permissions|credits|answers? to (selected )?exercises)$", re.I)
FRONT_LINE = re.compile(r"©|\(c\)\s*\d{4}|all rights reserved|\bisbn\b|printed (in|and bound)|first (published|edition)|published (by|in)|"
                        r"library of congress|cataloging|cataloguing|no part of this (book|publication)", re.I)
REF_LINE = re.compile(r"(\.{3,}|…{2,}|\s{3,})\s*\d{1,4}\s*$|^[^.!?]{1,80}[ ,]\d{1,4}(,\s*\d{1,4})*\s*$")


def _heading(p: str) -> tuple[int, str]:
    m = re.match(r"^(#{1,6})\s+(.*)", p)
    return (len(m.group(1)), m.group(2).strip()) if m else (0, "")


def non_learning(paras: list[str]) -> set[int]:
    """Paragraphs (1-based) that are not learning material: cover and title page, copyright, contents, preface,
    acknowledgements, index, bibliography and the like. Careful by design — when unsure, a paragraph is kept."""
    n, skip = len(paras), set()
    i = 0
    while i < n:
        level, title = _heading(paras[i])
        bare = re.sub(r"^((chapter|part|section|appendix)\s+)?([\d]+|[IVXLC]+)?[.:)\-–]?\s+", "", title)
        if level and SKIP_HEADING.match(bare or title):
            j = i + 1
            while j < n and not (0 < _heading(paras[j])[0] <= level):
                j += 1
            skip.update(range(i + 1, j + 1))
            i = j
            continue
        i += 1
    for k, p in enumerate(paras, 1):
        if FRONT_LINE.search(p) and len(p.split()) < 60:
            skip.add(k)
    run: list[int] = []  # contents and index pages: runs of short lines ending in page numbers
    for k, p in enumerate(paras + [""], 1):
        lines = [ln for ln in p.split("\n") if ln.strip()]
        if lines and not _heading(p)[0] and sum(bool(REF_LINE.search(ln.strip())) for ln in lines) >= 0.6 * len(lines):
            run.append(k)
            continue
        if len(run) >= 3 or any(re.search(r"\.{3,}|…{2,}", paras[r - 1]) for r in run):
            skip.update(run)
        run = []
    # The title page: short lines before the first real paragraph, if the front matter after them was found.
    body = next((k for k, p in enumerate(paras, 1) if k not in skip and not _heading(p)[0] and (len(p.split()) >= 25 or p.startswith(("- ", "|")))), None)
    if body:
        k = body - 1
        while k >= 1 and k not in skip and (_heading(paras[k - 1])[0] or len(paras[k - 1].split()) < 25):
            k -= 1
        if k >= 1 and k in skip:
            skip.update(r for r in range(1, k) if len(paras[r - 1].split()) < 25)
    return skip


def trim(outline: dict | None, skip: set[int], paras: list[str]) -> dict | None:
    """Topics lose non-learning paragraphs at their edges; topics made only of them go. A topic that is only headings
    (a chapter title right before its first section) joins the topic after it."""
    if not outline:
        return outline
    flat = []
    for ui, u in enumerate(outline["units"]):
        for t in u["topics"]:
            start, end = t["start"], t["end"]
            while start <= end and start in skip:
                start += 1
            while end >= start and end in skip:
                end -= 1
            if start <= end:
                flat.append([ui, {**t, "start": start, "end": end}])
    kept: list[list] = []
    carry = None
    for ui, t in flat:
        if carry is not None and carry["end"] + 1 == t["start"]:
            t["start"] = carry["start"]
        carry = None
        if all(_heading(paras[k - 1])[0] for k in range(t["start"], t["end"] + 1)):
            carry = t
            continue
        kept.append([ui, t])
    units: list[dict] = []
    for ui, t in kept:
        if not units or units[-1]["_ui"] != ui:
            units.append({"_ui": ui, "title": outline["units"][ui]["title"], "topics": []})
        units[-1]["topics"].append(t)
    for u in units:
        u.pop("_ui")
    return {"units": units} if units else None


def numbered(paras: list[str], budget: int = SLICE_BUDGET, likely_skip: set[int] | None = None) -> str:
    total = sum(len(p) for p in paras)
    cap = None if total <= budget else max(80, budget // max(1, len(paras)))
    likely_skip = likely_skip or set()

    def show(i: int, p: str) -> str:
        if i in likely_skip:  # probably cover, contents, index…: a glimpse is enough to decide, and saves room for the lessons
            return p[:60] + (" …" if len(p) > 60 else "")
        return p if cap is None or len(p) <= cap else p[:cap] + " …"
    return "\n".join(f"[{i}] " + show(i, p) for i, p in enumerate(paras, 1))


def normalise(raw: dict | None, n: int) -> dict | None:
    """Any outline -> units of topics over paragraphs 1..n, in order, never overlapping. A topic runs to its "end" when given,
    else until the next topic starts. Paragraphs no topic covers (cover, contents, index…) are left out of the course."""
    flat = []
    for ui, unit in enumerate((raw or {}).get("units") or []):
        if not isinstance(unit, dict):
            continue
        for t in unit.get("topics") or []:
            try:
                start = int(t.get("start", t.get("from")))
            except (TypeError, ValueError, AttributeError):
                continue
            try:
                end = int(t.get("end", t.get("to")))
            except (TypeError, ValueError):
                end = None
            if 1 <= start <= n:
                flat.append((start, end, ui, str(unit.get("title") or "").strip()[:200], str(t.get("title") or "").strip()[:200], str(t.get("summary") or "").strip()[:300]))
    flat.sort(key=lambda x: (x[0], x[2]))
    uniq, seen = [], set()
    for x in flat:
        if x[0] not in seen:
            seen.add(x[0])
            uniq.append(x)
    if not uniq:
        return None
    units: list[dict] = []
    for k, (start, end, ui, ut, tt, sm) in enumerate(uniq):
        limit = uniq[k + 1][0] - 1 if k + 1 < len(uniq) else n
        end = limit if end is None or not start <= end <= limit else end
        if not units or units[-1]["_ui"] != ui:
            units.append({"_ui": ui, "title": ut or f"Part {len(units) + 1}", "topics": []})
        units[-1]["topics"].append({"title": tt or f"Topic {k + 1}", "summary": sm, "start": start, "end": end})
    for u in units:
        u.pop("_ui")
    return {"units": units[:80]}


def by_headings(paras: list[str]) -> dict:
    """Without AI: every heading starts a topic; the first heading level that repeats starts units; no headings -> ~350 words a topic."""
    skip = non_learning(paras)
    levels = [len(m.group(1)) if (m := re.match(r"^(#{1,6})\s", p)) and i not in skip else 0 for i, p in enumerate(paras, 1)]
    if not any(levels):
        topics, cur, words = [], None, 0
        for i, p in enumerate(paras, 1):
            if cur is None or words >= 350:
                cur = {"title": p.split("\n")[0][:60] + ("…" if len(p) > 60 else ""), "summary": "", "start": i}
                topics.append(cur)
                words = 0
            words += len(p.split())
        return trim(normalise({"units": [{"title": "", "topics": topics}]}, len(paras)), skip, paras)
    used = sorted({lv for lv in levels if lv})
    top = next((lv for lv in used if levels.count(lv) > 1), used[0])
    raw: dict = {"units": []}
    for i, (p, lv) in enumerate(zip(paras, levels, strict=True), 1):
        title = p.lstrip("#").strip()[:200]
        if (lv and lv <= top) or not raw["units"]:
            raw["units"].append({"title": title if lv else "", "topics": []})
        if lv or i == 1:
            raw["units"][-1]["topics"].append({"title": title if lv else "", "start": i})
    return trim(normalise(raw, len(paras)), skip, paras)


async def slice_material(db: Session, user: User, course: Course, method: str, notes: str) -> dict:
    m = material(db, course)
    if not m.paragraphs:
        raise AppError("studio.no_material", 400)
    m.notes = notes.strip()[:4000]
    if method == "headings":
        outline, by = by_headings(m.paragraphs), "headings"
    else:
        skip = non_learning(m.paragraphs)
        msg = f"Course: {course.title}" + (f"\n\nThe author's instructions:\n{m.notes}" if m.notes else "") + \
              f"\n\nThe material has {len(m.paragraphs)} paragraphs:\n\n" + numbered(m.paragraphs, likely_skip=skip)
        outline, by = trim(normalise(ai.read_json(await ai.ask(db, user, "slice", msg, max_tokens=8000)), len(m.paragraphs)), skip, m.paragraphs), "ai"
        if not outline:
            raise AppError("ai.bad_answer", 502)
    m.outline, m.sliced_by = outline, by
    db.commit()
    return view(m)


def save_outline(db: Session, course: Course, units: list[dict]) -> dict:
    """The outline after the author renamed, merged, split or removed topics: in order, no overlaps; removed topics leave their paragraphs out."""
    m = material(db, course)
    n, last, out = len(m.paragraphs), 0, []
    for u in units:
        topics = []
        for t in u.get("topics") or []:
            try:
                start, end = int(t["start"]), int(t["end"])
            except (KeyError, TypeError, ValueError):
                raise AppError("studio.outline_invalid", 400) from None
            if not last < start <= end <= n:
                raise AppError("studio.outline_order", 400)
            last = end
            topics.append({"title": (str(t.get("title") or "").strip() or "—")[:200], "summary": str(t.get("summary") or "")[:300], "start": start, "end": end})
        if topics:
            out.append({"title": (str(u.get("title") or "").strip() or "—")[:200], "topics": topics})
    if not out:
        raise AppError("studio.outline_empty", 400)
    m.outline = {"units": out}
    db.commit()
    return view(m)


def plain(paras: list[str]) -> str:
    return re.sub(r"\s+", " ", re.sub(r"^#{1,6}\s+|\|?\s*:?-{3,}:?\s*\|?|[|*_`>]", " ", "\n".join(paras), flags=re.M)).strip()


def view(m: Material) -> dict:
    outline = None
    if m.outline:
        outline = {"units": [{"title": u["title"], "topics": [{**t, "words": sum(len(p.split()) for p in m.paragraphs[t["start"] - 1:t["end"]]),
                                                                "excerpt": plain(m.paragraphs[t["start"] - 1:t["end"]])[:280]} for t in u["topics"]]} for u in m.outline["units"]]}
    return {"sources": m.sources, "paragraphs": len(m.paragraphs), "words": sum(s["words"] for s in m.sources), "notes": m.notes, "outline": outline,
            "sliced_by": m.sliced_by, "left_out": left_out(m)}


def left_out(m: Material) -> list[dict]:
    """The stretches of material no topic covers, so the author can see what was skipped and add any of it back."""
    if not m.outline:
        return []
    covered = {i for u in m.outline["units"] for t in u["topics"] for i in range(t["start"], t["end"] + 1)}
    out, k, n = [], 1, len(m.paragraphs)
    while k <= n:
        if k in covered:
            k += 1
            continue
        j = k
        while j + 1 <= n and j + 1 not in covered:
            j += 1
        first = re.sub(r"^#{1,6}\s+", "", m.paragraphs[k - 1]).split("\n")[0]
        out.append({"start": k, "end": j, "first": first[:120], "excerpt": plain(m.paragraphs[k - 1:j])[:200]})
        k = j + 1
    return out[:100]


def paragraphs(db: Session, course: Course, start: int, end: int) -> list[str]:
    m = material(db, course)
    if not 1 <= start <= end <= len(m.paragraphs):
        raise AppError("studio.range_invalid", 400)
    return m.paragraphs[start - 1:end]


def apply(db: Session, user: User, course: Course, replace: bool) -> int:
    m = material(db, course)
    if not m.outline:
        raise AppError("studio.no_outline", 400)
    has = db.scalar(select(Unit.id).where(Unit.course_id == course.id))
    if has and not replace:
        raise AppError("studio.would_replace", 409)  # R-PER-3: replacing is asked for
    if has:
        db.execute(delete(Unit).where(Unit.course_id == course.id))
    count = 0
    published = course.kind == "personal"  # staff imports arrive as drafts (R-PER-5)
    for ui, u in enumerate(m.outline["units"]):
        unit = Unit(course_id=course.id, title=u["title"], position=ui)
        db.add(unit)
        db.flush()
        for ti, t in enumerate(u["topics"]):
            db.add(Topic(unit_id=unit.id, title=t["title"], summary=t.get("summary", ""), position=ti, published=published,
                         content="\n\n".join(m.paragraphs[t["start"] - 1:t["end"]])))
            count += 1
    course.status = "ready"
    audit(db, user.id, "studio.apply", f"course:{course.id}", topics=count)
    db.commit()
    return count
