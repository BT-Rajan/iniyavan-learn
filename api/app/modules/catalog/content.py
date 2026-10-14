"""Topic content and images: safe by construction (ARCHITECTURE rule 3)."""
from __future__ import annotations

import html
import os
import re
import secrets

import nh3

from app.core.config import settings
from app.core.errors import AppError

FORMATS = ("markdown", "html")
TAGS = {"p", "br", "hr", "div", "span", "section", "article", "header", "footer", "aside", "figure", "figcaption", "blockquote", "pre", "code",
        "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "del", "ins", "mark", "small", "sub", "sup", "abbr", "cite", "q",
        "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col", "a", "img",
        "details", "summary", "ruby", "rt", "rp", "bdi", "bdo"}
ATTRS = {"*": {"dir", "lang", "title"}, "a": {"href"}, "img": {"src", "alt", "width", "height"}, "td": {"colspan", "rowspan"},
         "th": {"colspan", "rowspan", "scope"}, "ol": {"start", "type", "reversed"}, "li": {"value"}, "col": {"span"}, "colgroup": {"span"}}
IMAGE_URL = re.compile(r"/api/uploads/[0-9a-f]{32}\.(png|jpg|gif|webp)")
MAX_IMAGE = 3 * 1024 * 1024
MIME = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}


def clean_html(raw: str) -> str:
    """The safe part of an HTML document's body: no scripts, styles, event handlers, forms, frames or javascript: links."""
    body = re.search(r"<body[^>]*>(.*)</body>", raw or "", re.S | re.I)
    return nh3.clean(body.group(1) if body else raw or "", tags=TAGS, attributes=ATTRS, url_schemes={"http", "https", "mailto"},
                     link_rel="noopener noreferrer").strip()


def to_text(content: str, fmt: str) -> str:
    """Plain words of a topic, for search snippets and AI prompts."""
    if fmt == "html":
        content = re.sub(r"<(br|/p|/li|/tr|/h\d|/div)[^>]*>", "\n", content or "")
        content = html.unescape(re.sub(r"<[^>]+>", " ", content))
    else:
        content = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", content or "")
        content = re.sub(r"^\s*\|?(\s*:?-+:?\s*\|?)+\s*$", "", content, flags=re.M)  # table rule rows
        content = re.sub(r"[#*_`>|~]|\$+", " ", content)
    return re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n", content)).strip()


def stored(content: str, fmt: str) -> str:
    if fmt not in FORMATS:
        raise AppError("topic.format_invalid", 400)
    return clean_html(content) if fmt == "html" else content


def shown(content: str, fmt: str) -> str:
    return clean_html(content) if fmt == "html" else content  # cleaned again on the way out, whatever path saved it


def sniff(data: bytes) -> str | None:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def save_image(data: bytes) -> str:
    if len(data) > MAX_IMAGE:
        raise AppError("upload.too_large", 413, max_mb=3)
    ext = sniff(data)
    if not ext:
        raise AppError("upload.not_an_image", 400)
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    name = f"{secrets.token_hex(16)}.{ext}"
    (settings.upload_dir / name).write_bytes(data)
    return f"/api/uploads/{name}"


def image_path(name: str) -> tuple[str, str] | None:
    m = re.fullmatch(r"[0-9a-f]{32}\.(png|jpg|gif|webp)", name)
    path = os.path.join(settings.upload_dir, name)
    return (path, MIME[m.group(1)]) if m and os.path.isfile(path) else None


def check_image_url(value: str) -> str:
    value = (value or "").strip()
    if value and not IMAGE_URL.fullmatch(value):
        raise AppError("upload.use_uploaded_image", 400)
    return value
