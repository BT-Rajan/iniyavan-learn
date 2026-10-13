"""Material files to paragraphs of Markdown (R-PER-1)."""
from __future__ import annotations

import io
import re
import xml.etree.ElementTree as ET
import zipfile

from app.core.errors import AppError

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _word_text(p) -> str:
    out = []
    for el in p.iter():
        if el.tag == W + "t":
            out.append(el.text or "")
        elif el.tag == W + "tab":
            out.append("\t")
        elif el.tag in (W + "br", W + "cr"):
            out.append("\n")
    return "".join(out).strip()


def merge_lists(paras: list[str]) -> list[str]:
    out: list[str] = []
    for p in paras:
        if p.startswith("- ") and out and out[-1].startswith("- "):
            out[-1] += "\n" + p
        else:
            out.append(p)
    return out


def docx(data: bytes) -> list[str]:
    try:
        root = ET.fromstring(zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError):
        raise AppError("studio.word_unreadable", 400) from None
    body = root.find(W + "body")
    out: list[str] = []
    for el in list(body) if body is not None else []:
        if el.tag == W + "p":
            text = _word_text(el)
            if not text:
                continue
            st = el.find(f"{W}pPr/{W}pStyle")
            style = (st.get(W + "val") if st is not None else "") or ""
            heading = re.match(r"(?i)heading\s*([1-6])$", style)
            if heading or re.match(r"(?i)^title$", style):
                out.append("#" * (int(heading.group(1)) if heading else 1) + " " + text.replace("\n", " "))
            elif el.find(f"{W}pPr/{W}numPr") is not None or re.match(r"(?i)list", style):
                out.append("- " + text)
            else:
                out.append(text)
        elif el.tag == W + "tbl":
            rows = [[_word_text(c).replace("|", "\\|").replace("\n", " ") for c in r.findall(W + "tc")] for r in el.findall(W + "tr")]
            rows = [r for r in rows if any(r)]
            if rows:
                n = max(len(r) for r in rows)
                rows = [r + [""] * (n - len(r)) for r in rows]
                out.append("\n".join(["| " + " | ".join(rows[0]) + " |", "|" + "---|" * n] + ["| " + " | ".join(r) + " |" for r in rows[1:]]))
    return merge_lists(out)


def pdf(data: bytes) -> list[str]:
    from pypdf import PdfReader
    try:
        pages = [pg.extract_text() or "" for pg in PdfReader(io.BytesIO(data)).pages]
    except Exception:  # noqa: BLE001  (pypdf raises many types for broken or locked files)
        raise AppError("studio.pdf_unreadable", 400) from None
    if len("".join(pages).strip()) < 40:
        raise AppError("studio.pdf_no_text", 400)  # scanned pages: no OCR
    out, cur = [], ""
    for line in "\n".join(pages).split("\n"):
        ln = line.strip()
        if not ln:
            if cur:
                out.append(cur)
                cur = ""
            continue
        heading = len(ln) < 70 and not re.search(r"[.,;:]$", ln) and (ln.isupper() or re.match(r"^(\d+(\.\d+)*\.?|chapter|unit|lesson|section)\s", ln, re.I))
        if heading:
            if cur:
                out.append(cur)
            out.append("## " + ln)
            cur = ""
        elif cur and re.search(r"[.!?:]$", cur) and (ln[:1].isupper() or ln[:1].isdigit() or ln[:1] in "-•*"):
            out.append(cur)
            cur = ln
        else:
            cur = f"{cur} {ln}".strip()
    if cur:
        out.append(cur)
    return merge_lists([re.sub(r"^[•*]\s*", "- ", p) for p in out])


def text(value: str) -> list[str]:
    return merge_lists([p.strip() for p in re.split(r"\n\s*\n", (value or "").replace("\r\n", "\n").lstrip("\ufeff")) if p.strip()])


def from_file(name: str, data: bytes) -> tuple[str, list[str]]:
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if data[:4] == b"%PDF" or ext == "pdf":
        return "pdf", pdf(data)
    if ext == "doc":
        raise AppError("studio.old_word", 400)
    if data[:2] == b"PK" or ext == "docx":
        return "docx", docx(data)
    if ext in ("txt", "md", "markdown", "text", ""):
        try:
            return "text", text(data.decode("utf-8"))
        except UnicodeDecodeError:
            return "text", text(data.decode("latin-1"))
    raise AppError("studio.file_type", 400)
