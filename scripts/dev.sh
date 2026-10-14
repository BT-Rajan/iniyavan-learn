#!/usr/bin/env sh
# Runs the API (auto-reload) and the web app (hot reload) together. Open http://localhost:5173
set -e
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "SECRET_KEY=$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')" > .env; echo "Created .env"; }
(cd api && pip install -q -e ".[dev]" && alembic upgrade head)
(cd web && [ -d node_modules ] || npm install --no-audit --no-fund)
trap 'kill 0' INT TERM EXIT
(cd api && uvicorn app.main:app --reload --port 8000) &
(cd web && npm run dev) &
wait
