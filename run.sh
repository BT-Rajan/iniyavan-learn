#!/usr/bin/env bash
# Installs, builds, migrates and (re)starts the app under pm2 — run it after every `git pull`.
# Usage: ./run.sh                     (uses ./venv, created if missing)
#        VENV=/apps/engtutor/venv APP=engtutor ./run.sh
# Settings live in .env next to this file (see .env.example). HOST and PORT there decide where it listens.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="${APP:-engtutor}"
VENV="${VENV:-$ROOT/venv}"
cd "$ROOT"

[ -f .env ] || { echo "Missing $ROOT/.env. Copy .env.example to .env and fill it in."; exit 1; }
if ! grep -Eq '^SECRET_KEY=.{32,}' .env || grep -Eq '^SECRET_KEY=change-me' .env; then
  sed -i '/^SECRET_KEY=/d' .env
  printf 'SECRET_KEY=%s\n' "$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')" >> .env
  echo "Generated a new SECRET_KEY in .env (everyone signs in again once)."
fi
command -v pm2 >/dev/null || { echo "pm2 is not installed or not on PATH."; exit 1; }
command -v npm >/dev/null || { echo "npm is not installed or not on PATH."; exit 1; }

echo "==> Python dependencies"
[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q -e "$ROOT/api"

echo "==> Web app build"
(cd web && { npm ci --no-audit --no-fund || npm install --no-audit --no-fund; } && npm run build)

echo "==> Database migrations"
(cd api && "$VENV/bin/alembic" upgrade head)

(cd api && "$VENV/bin/python" -c "
from sqlalchemy import select
from app.core.db import SessionLocal
from app.modules.users.models import User
import app.models  # noqa
with SessionLocal() as s:
    raise SystemExit(0 if s.scalar(select(User.id).where(User.role == 'admin')) else 1)
") || echo "!! No admin account yet. Create one: (cd api && $VENV/bin/python -m app.cli create-admin you@example.com \"Your Name\")"

HOST=$(sed -n 's/^HOST=//p' .env | tail -1 | tr -d '"'"'"); PORT=$(sed -n 's/^PORT=//p' .env | tail -1 | tr -d '"'"'")
HOST="${HOST:-127.0.0.1}"; PORT="${PORT:-5252}"

echo "==> pm2"
pm2 describe "$APP" >/dev/null 2>&1 && pm2 delete "$APP" >/dev/null
pm2 start "$VENV/bin/uvicorn" --name "$APP" --interpreter "$VENV/bin/python" --cwd "$ROOT/api" -- \
  app.main:app --host "$HOST" --port "$PORT" --proxy-headers --forwarded-allow-ips="*"
pm2 save >/dev/null
echo "==> Up at http://$HOST:$PORT   (logs: pm2 logs $APP)"
