"""Settings read once from the environment (and a .env file next to the project, if present)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _load_dotenv() -> None:
    env = ROOT / ".env"
    if not env.is_file():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


def _int(name: str, default: int) -> int:
    return int(os.getenv(name) or default)


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", f"sqlite:///{ROOT / 'data' / 'app.db'}")
    secret_key: str = os.getenv("SECRET_KEY", "")
    app_url: str = os.getenv("APP_URL", "http://localhost:8000")
    upload_dir: Path = Path(os.getenv("UPLOAD_DIR") or ROOT / "data" / "uploads")
    session_days: int = _int("SESSION_DAYS", 7)
    secure_cookies: bool = os.getenv("SECURE_COOKIES", "0") == "1"
    password_rounds: int = _int("PASSWORD_ROUNDS", 2**14)  # scrypt cost (n); lowered in tests
    smtp_host: str = os.getenv("SMTP_HOST", "")
    smtp_port: int = _int("SMTP_PORT", 587)
    smtp_user: str = os.getenv("SMTP_USER", "")
    smtp_password: str = os.getenv("SMTP_PASSWORD", "")
    smtp_from: str = os.getenv("SMTP_FROM", "")
    ai_base_url: str = os.getenv("AI_BASE_URL", "https://api.deepseek.com")
    ai_model: str = os.getenv("AI_MODEL", "deepseek-chat")
    ai_daily_limit: int = _int("AI_DAILY_LIMIT", 40)
    web_dist: Path = field(default_factory=lambda: ROOT / "web" / "dist")

    @property
    def mail_enabled(self) -> bool:
        return bool(self.smtp_host and self.smtp_from)


settings = Settings()
