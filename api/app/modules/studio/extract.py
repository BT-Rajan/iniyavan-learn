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


def _on(rpr, tag: str) -> bool:
    el = rpr.find(W + tag) if rpr is not None else None
    return el is not None and el.get(W + "val", "true").lower() not in ("0", "false", "none")


def _word_md(p) -> str:
    """A paragraph's text with **bold** and *italic* kept, from its runs."""
    parts: list[tuple[str, bool, bool]] = []
    for r in p.iter(W + "r"):
        text = "".join((el.text or "") if el.tag == W + "t" else "\t" if el.tag == W + "tab" else "\n" if el.tag in (W + "br", W + "cr") else ""
                       for el in r)
        if text:
            rpr = r.find(W + "rPr")
            parts.append((text, _on(rpr, "b"), _on(rpr, "i")))
    merged: list[list] = []
    for text, b, i in parts:
        if merged and merged[-1][1:] == [b, i]:
            merged[-1][0] += text
        else:
            merged.append([text, b, i])
    out = []
    for text, b, i in merged:
        core = text.strip()
        if not core or not (b or i):
            out.append(text)
            continue
        mark = "**" if b else "*"
        lead, trail = text[: len(text) - len(text.lstrip())], text[len(text.rstrip()):]
        out.append(f"{lead}{mark}{core}{mark}{trail}")
    return "".join(out).strip()


def merge_lists(paras: list[str]) -> list[str]:
    """Consecutive list items become one paragraph (one Markdown list)."""
    item = re.compile(r"^(- |\d{1,2}\. |[a-hA-H]\. )")
    out: list[str] = []
    for p in paras:
        if item.match(p) and out and item.match(out[-1].split("\n")[-1]):
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
                out.append("- " + _word_md(el))
            else:
                md = _word_md(el)
                bold_line = md.startswith("**") and md.endswith("**") and md.count("**") == 2 and len(text) <= 90 and not re.search(r"[.,;]$", text)
                out.append("### " + text if bold_line else md)  # a short all-bold line is a heading in disguise
        elif el.tag == W + "tbl":
            rows = [[_word_text(c).replace("|", "\\|").replace("\n", " ") for c in r.findall(W + "tc")] for r in el.findall(W + "tr")]
            rows = [r for r in rows if any(r)]
            if rows:
                n = max(len(r) for r in rows)
                rows = [r + [""] * (n - len(r)) for r in rows]
                out.append("\n".join(["| " + " | ".join(rows[0]) + " |", "|" + "---|" * n] + ["| " + " | ".join(r) + " |" for r in rows[1:]]))
    return merge_lists(out)


BULLET = re.compile(r"^([•●▪◦■□➢►\-–—*·]|\(cid:\d+\))\s*")  # (cid:N): a bullet drawn from a symbol font
NUMBERED = re.compile(r"^(\(?\d{1,2}[.)]|\(?[a-hA-H][.)])\s+")
BOLD = re.compile(r"bold|black|heavy|semibold|demi", re.I)
MAX_PDF_PAGES = 1500


def pdf(data: bytes) -> list[str]:
    """PDF to Markdown paragraphs, keeping what makes a page readable: headings (from font size and bold lines),
    bullet and numbered lists, bold words, and tables. Running headers, footers and page numbers are dropped,
    hyphenated line breaks are joined, and paragraphs are rebuilt from line spacing."""
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(data)) as doc:
            if len(doc.pages) > MAX_PDF_PAGES:
                raise AppError("studio.too_much_material", 413)
            pages = [_pdf_page(pg) for pg in doc.pages]
    except AppError:
        raise
    except Exception:  # noqa: BLE001  (broken or locked files raise many kinds of errors)
        return _pdf_plain(data)
    if sum(len(ln["text"]) for blocks in pages for ln in blocks if ln["kind"] == "line") < 40:
        raise AppError("studio.pdf_no_text", 400)  # scanned pages: no OCR
    return merge_lists(_assemble(_drop_running_lines(pages)))


def _pdf_page(page) -> list[dict]:
    """The page's lines and tables, top to bottom. Each line knows its size, boldness, position and its text with **bold** words."""
    h = float(page.height)
    blocks: list[dict] = []
    tables = []
    try:
        for t in page.find_tables():
            rows = [[re.sub(r"\s+", " ", (c or "")).strip().replace("|", "\\|") for c in r] for r in t.extract()]
            rows = [r for r in rows if any(r)]
            if len(rows) >= 2 and max(len(r) for r in rows) >= 2:
                tables.append(t.bbox)
                n = max(len(r) for r in rows)
                rows = [r + [""] * (n - len(r)) for r in rows]
                md = "\n".join(["| " + " | ".join(rows[0]) + " |", "|" + "---|" * n] + ["| " + " | ".join(r) + " |" for r in rows[1:]])
                blocks.append({"kind": "table", "text": md, "top": float(t.bbox[1]), "bottom": float(t.bbox[3])})
    except Exception:  # noqa: BLE001  (table finding is a bonus; never lose the text over it)
        tables = []

    def outside(obj) -> bool:
        cx, cy = (obj["x0"] + obj["x1"]) / 2, (obj["top"] + obj["bottom"]) / 2
        return not any(x0 <= cx <= x1 and t0 <= cy <= t1 for x0, t0, x1, t1 in tables)

    words = (page.filter(outside) if tables else page).extract_words(extra_attrs=["fontname", "size"], use_text_flow=True, keep_blank_chars=False)
    line: list[dict] = []
    for w in words + [None]:
        if line and (w is None or abs(w["top"] - line[-1]["top"]) > max(2.0, 0.4 * line[-1]["size"]) or w["x0"] < line[-1]["x0"] - 1):
            bold = [bool(BOLD.search(x["fontname"])) for x in line]
            parts, i = [], 0
            while i < len(line):
                j = i
                while j < len(line) and bold[j] == bold[i]:
                    j += 1
                chunk = " ".join(x["text"] for x in line[i:j])
                parts.append(f"**{chunk}**" if bold[i] and not all(bold) else chunk)
                i = j
            sizes = sorted(x["size"] for x in line)
            blocks.append({"kind": "line", "text": " ".join(x["text"] for x in line), "md": " ".join(parts), "size": round(sizes[len(sizes) // 2], 1),
                           "bold": all(bold), "x0": line[0]["x0"], "top": line[0]["top"], "bottom": max(x["bottom"] for x in line), "h": h})
            line = []
        if w is not None:
            line.append(w)
    return sorted(blocks, key=lambda b: b["top"]) if tables else blocks


def _drop_running_lines(pages: list[list[dict]]) -> list[list[dict]]:
    """Running headers/footers repeat near the top or bottom of many pages; page numbers stand alone in the margins."""
    def key(b):
        return re.sub(r"\d+", "#", b["text"].lower()).strip()

    def margin(b):
        return b["top"] < 0.1 * b["h"] or b["bottom"] > 0.9 * b["h"]

    counts: dict[str, int] = {}
    for blocks in pages:
        for k in {key(b) for b in blocks if b["kind"] == "line" and margin(b)}:
            counts[k] = counts.get(k, 0) + 1
    many = max(3, len(pages) // 3)
    out = []
    for blocks in pages:
        out.append([b for b in blocks if b["kind"] != "line" or not margin(b)
                    or not (counts.get(key(b), 0) >= many or re.fullmatch(r"(page\s*)?[\divxlc]+(\s*(of|/)\s*\d+)?", b["text"].strip(), re.I))])
    return out


def _assemble(pages: list[list[dict]]) -> list[str]:
    lines = [b for blocks in pages for b in blocks if b["kind"] == "line"]
    if not lines:
        return []
    weights: dict[float, int] = {}
    for b in lines:
        weights[b["size"]] = weights.get(b["size"], 0) + len(b["text"])
    body = max(weights, key=weights.get)
    big = sorted({b["size"] for b in lines if b["size"] >= body * 1.15 and len(b["text"]) <= 120}, reverse=True)[:3]

    def heading(b) -> int:
        if len(b["text"]) > 120 or re.search(r"[.,;:]$", b["text"]) and not b["text"].endswith(":"):
            return 0
        if b["size"] in big:
            return big.index(b["size"]) + 1
        if b["bold"] and len(b["text"]) <= 90 and b["size"] >= body * 0.95:
            return min(len(big) + 1, 3)
        return 0

    out: list[str] = []
    cur, prev = "", None
    for blocks in pages:
        for b in blocks:
            if b["kind"] == "table":
                if cur:
                    out.append(cur)
                cur, prev = "", None
                out.append(b["text"])
                continue
            level = heading(b)
            if level:
                if cur:
                    out.append(cur)
                if out and out[-1].startswith("#" * level + " ") and prev is not None and prev.get("heading") == level and b["top"] - prev["bottom"] < b["size"]:
                    out[-1] += " " + b["text"]  # a heading that wrapped onto two lines
                else:
                    out.append("#" * level + " " + b["text"])
                cur, prev = "", {**b, "heading": level}
                continue
            text, starts_item = b["md"], False
            if BULLET.match(b["text"]) and len(b["text"]) > 2:
                text, starts_item = "- " + BULLET.sub("", text, count=1), True
            elif NUMBERED.match(b["text"]):
                text, starts_item = NUMBERED.sub(lambda m: re.sub(r"[()]", "", m.group(1)).rstrip(")").rstrip(".") + ". ", text, count=1), True
            new_page = prev is not None and b["top"] < prev["top"]
            gap = (b["top"] - prev["bottom"]) if prev is not None and not new_page else 0
            new_para = (prev is None or prev.get("heading") or starts_item or gap > max(3.0, 0.6 * b["size"])
                        or (b["x0"] > prev["x0"] + 8 and re.search(r"[.!?:]$", cur or "") and not cur.startswith("- "))
                        or (new_page and not (b["text"][:1].islower() or re.search(r"[-,;]$", cur or ""))))
            if new_para:
                if cur:
                    out.append(cur)
                cur = text
            elif re.search(r"[A-Za-z]-$", cur) and b["text"][:1].islower():
                cur = cur[:-1] + text  # hyphenated at the line end
            else:
                cur = f"{cur} {text}"
            prev = b
    if cur:
        out.append(cur)
    return [re.sub(r"\(cid:\d+\)", "", re.sub(r"\*\*\s*\*\*", " ", p)).strip() for p in out if p.strip()]


def _pdf_plain(data: bytes) -> list[str]:
    """Fallback for PDFs the layout reader can't open: plain text, paragraphs guessed from lines."""
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
        if cur and re.search(r"[.!?:]$", cur) and (ln[:1].isupper() or ln[:1].isdigit() or ln[:1] in "-•*"):
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
