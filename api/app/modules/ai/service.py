"""The AI gateway (ARCHITECTURE rule 4): keys, limits, caching and prompts for every AI call (R-AI-*).

The provider is any OpenAI-compatible chat API (DeepSeek by default). Tests replace `complete`.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import os
import re

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import utcnow
from app.core.errors import AppError
from app.core.security import unseal
from app.modules.admin import service as cfg
from app.modules.users.models import User

from .models import AICache, AIUsage

log = logging.getLogger("ai")

# How every answer a student reads should sound: like a good teacher talking to a 15-year-old.
VOICE = ("Write for a 15-year-old. Use short, crisp sentences: one idea per sentence, about 15 words at most. Use simple, everyday words. "
         "When a subject term is needed, keep it, and explain it in plain words the first time. No filler, no long introductions, no showing off. ")

PROMPTS = {
    "explain": (VOICE + "You are a warm, clear tutor. Explain the topic so it clicks: start with the big idea in one or two sentences, then go step by step, "
                "give one example or everyday comparison, and end with three short recap bullets. Stay faithful to the material and never contradict it. "
                "Write in the same language as the material. Use Markdown; put comparisons in a table with every row on its own line."),
    "answer": (VOICE + "You are an exam coach. Write a model answer to the topic's typical question that follows the given answer guideline and question "
               "pattern exactly (structure, length, keywords) — keep every keyword the guideline asks for, but say everything around it simply. Mirror the "
               "structure of the sample answer when one is given. Write in the material's language. Use Markdown."),
    "questions": (VOICE + "You write multiple-choice questions that check a student understood one topic of their study material. Keep each question and "
                  "option short and plainly worded; test understanding, not tricky wording. Use only facts in the material; never "
                  "invent facts. Each question has 4 options (2 for true/false), exactly one correct, plausible wrong options, a one- or two-sentence explanation "
                  "that points to the material, and a 'concept': the 2-5 word name of the idea it tests. Write in the material's language. Reply with JSON only: "
                  '{"questions":[{"text":"...","options":["...","...","...","..."],"correct":0,"explanation":"...","concept":"..."}]}'),
    "slice": ("You turn study material into a course. The material is a numbered list of paragraphs like [12] text. Group it into units and split each unit "
              "into topics. Each topic is the smallest logical component that can be learnt on its own: one concept, rule, definition group, worked example or "
              "story, usually 1 to 6 paragraphs. Keep the material's order. Topics cover the paragraphs in order without gaps or overlaps: give each topic the "
              "number of its first paragraph. Give every unit and topic a short, plain title in the material's language and every topic a one-line summary "
              "in simple words a 15-year-old understands. Follow the "
              'author\'s instructions when given. Reply with JSON only: {"units":[{"title":"...","topics":[{"title":"...","summary":"...","start":1}]}]}'),
    "search": (VOICE + "You are the search helper of a study app. The student searched for something the app's notes do not cover well. Answer as a clear, accurate "
               "tutor: a one-line definition, the core idea simply, one example, three recap bullets. Use Markdown. If it is not about studies, say briefly that "
               "you can only help with study topics."),
}


def prompt(db: Session, kind: str) -> str:
    return cfg.get(db, f"prompt_{kind}").strip() or PROMPTS[kind]  # R-AI-4


def institution_key(db: Session) -> str:
    return cfg.get(db, "ai_key") or os.getenv("AI_API_KEY", "")


def key_for(db: Session, user: User) -> tuple[str, bool]:
    """(key, is_own_key). Self-registered students bring their own key and never use the institution's (R-AI-1)."""
    if user.self_registered:
        return unseal(user.ai_key_sealed), True
    return institution_key(db), False


def daily_limit(db: Session) -> int:
    value = cfg.get(db, "ai_daily_limit")
    return int(value) if value.isdigit() else settings.ai_daily_limit


def used_today(db: Session, user: User) -> int:
    since = utcnow() - dt.timedelta(hours=24)
    return db.scalar(select(func.count(AIUsage.id)).where(AIUsage.user_id == user.id, AIUsage.own_key.is_(False), AIUsage.at >= since)) or 0


def status(db: Session, user: User) -> dict:
    key, own = key_for(db, user)
    limited = user.role == "student" and not own
    return {"available": bool(key), "own_key": own, "needs_own_key": user.self_registered and not key,
            "left": max(0, daily_limit(db) - used_today(db, user)) if limited else None, "limit": daily_limit(db) if limited else None}


async def complete(key: str, model: str, system: str, user_msg: str, max_tokens: int, timeout: float = 90) -> tuple[str, int]:
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(f"{settings.ai_base_url.rstrip('/')}/chat/completions", headers={"Authorization": f"Bearer {key}"},
                              json={"model": model, "max_tokens": max_tokens, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user_msg}]})
    r.raise_for_status()
    data = r.json()
    text = data["choices"][0]["message"]["content"]
    if not text:
        raise ValueError("empty answer")
    return text, int(data.get("usage", {}).get("total_tokens", 0))


async def ask(db: Session, user: User, kind: str, user_msg: str, max_tokens: int = 4000, system: str | None = None) -> str:
    key, own = key_for(db, user)
    if not key:
        raise AppError("ai.needs_own_key" if user.self_registered else "ai.unavailable", 503)
    if user.role == "student" and not own and used_today(db, user) >= daily_limit(db):
        raise AppError("ai.limit_reached", 429, limit=daily_limit(db))  # R-AI-3
    model = cfg.get(db, "ai_model") or settings.ai_model
    try:
        text, tokens = await complete(key, model, system or prompt(db, kind), user_msg, max_tokens)
    except httpx.HTTPStatusError as e:
        log.warning("AI provider answered %s", e.response.status_code)
        raise AppError("ai.key_refused" if own else "ai.provider_error", 502) from None  # R-AI-5: no provider detail
    except Exception as e:  # noqa: BLE001
        log.warning("AI call failed: %s", type(e).__name__)
        raise AppError("ai.provider_error", 502) from None
    db.add(AIUsage(user_id=user.id, kind=kind, tokens=tokens, own_key=own))
    db.commit()
    return text


async def cached(db: Session, user: User, kind: str, parts: list[str], user_msg: str, max_tokens: int = 4000) -> dict:
    """R-AI-2: one answer per input and prompt, shared by everyone. A key is still required, so turning AI off turns saved answers off too."""
    key, _ = key_for(db, user)
    if not key:
        raise AppError("ai.needs_own_key" if user.self_registered else "ai.unavailable", 503)
    h = hashlib.sha256("\x1f".join([kind, prompt(db, kind), *parts]).encode()).hexdigest()
    hit = db.scalar(select(AICache).where(AICache.key == h))
    if hit:
        hit.hits += 1
        db.commit()
        return {"text": hit.text, "cached": True}
    text = await ask(db, user, kind, user_msg, max_tokens)
    db.add(AICache(key=h, kind=kind, text=text))
    db.commit()
    return {"text": text, "cached": False}


def read_json(text: str) -> dict:
    """The first JSON object in a reply, even wrapped in a code fence or prose."""
    t = re.sub(r"^\s*```(?:json)?|```\s*$", "", (text or "").strip(), flags=re.I | re.M).strip()
    for candidate in (t, t[t.find("{"): t.rfind("}") + 1] if "{" in t else ""):
        try:
            value = json.loads(candidate)
            if isinstance(value, dict):
                return value
        except ValueError:
            pass
    raise AppError("ai.bad_answer", 502)


def clean_questions(raw: dict, want: int) -> list[dict]:
    out = []
    for q in raw.get("questions") or []:
        if not isinstance(q, dict):
            continue
        opts = [str(o).strip() for o in q.get("options") or [] if str(o).strip()]
        try:
            k = int(q.get("correct"))
        except (TypeError, ValueError):
            continue
        text = str(q.get("text") or "").strip()
        if text and 2 <= len(opts) <= 6 and 0 <= k < len(opts) and len({o.lower() for o in opts}) == len(opts):
            out.append({"text": text[:1000], "options": [o[:400] for o in opts], "correct": k, "explanation": str(q.get("explanation") or "").strip()[:1000],
                        "concept": str(q.get("concept") or "").strip()[:80]})
    return out[:want]


async def write_questions(db: Session, user: User, title: str, material: str, n: int, mixed: bool, earlier: list[str]) -> list[dict]:
    if not material.strip():
        raise AppError("practice.no_material", 400)
    msg = f"Topic: {title}\n\nMaterial:\n{material[:60000]}\n\nWrite {n} questions" + (", mostly 4-option questions and a few true/false" if mixed else "") + "."
    if earlier:
        msg += "\nAsk about different points than these earlier questions:\n" + "\n".join("- " + t for t in earlier[:15])
    qs = clean_questions(read_json(await ask(db, user, "questions", msg, max_tokens=6000)), n)
    if len(qs) < max(2, n // 2):
        raise AppError("ai.bad_answer", 502)
    return qs
