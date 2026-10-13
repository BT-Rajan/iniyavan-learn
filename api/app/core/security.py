"""Password hashing (scrypt, standard library) and signed session tokens."""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import secrets

import jwt

from .config import settings
from .db import utcnow


def _secret() -> str:
    if len(settings.secret_key) < 32:
        raise RuntimeError("SECRET_KEY must be set to at least 32 characters")
    return settings.secret_key


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    n = settings.password_rounds
    digest = hashlib.scrypt(password.encode(), salt=salt, n=n, r=8, p=1, dklen=32)
    return f"scrypt${n}${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, stored: str | None) -> bool:
    try:
        _, n, salt, digest = (stored or "").split("$")
        got = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=8, p=1, dklen=32)
        return hmac.compare_digest(got, base64.b64decode(digest))
    except (ValueError, TypeError):
        return False


def make_token(user_id: int, session_key: str) -> str:
    exp = utcnow() + dt.timedelta(days=settings.session_days)
    return jwt.encode({"sub": str(user_id), "k": session_key, "exp": exp}, _secret(), algorithm="HS256")


def read_token(token: str) -> tuple[int, str] | None:
    try:
        data = jwt.decode(token, _secret(), algorithms=["HS256"])
        return int(data["sub"]), str(data["k"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def random_code(digits: int = 6) -> str:
    return "".join(secrets.choice("0123456789") for _ in range(digits))


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _fernet():
    from cryptography.fernet import Fernet
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(("seal:" + _secret()).encode()).digest()))


def seal(value: str) -> str:
    """Encrypts a secret we must use later (a student's own AI key)."""
    return _fernet().encrypt(value.encode()).decode()


def unseal(token: str | None) -> str:
    if not token:
        return ""
    from cryptography.fernet import InvalidToken
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError):
        return ""
