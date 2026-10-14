#!/usr/bin/env bash
# One-time switch from the old Eng Tutor app (github.com/BT-Rajan/iniyavan) to Iniyavan Learn.
#
#   1. checks the server (Python, Node, npm, pm2, git, mysql client)
#   2. backs up the old database and uploaded images
#   3. clones the new repo next to the old one (the old folder is left untouched)
#   4. copies the old .env across
#   5. stops the old app, DROPS and recreates the database
#   6. installs, builds, creates the tables and starts the new app under pm2
#   7. creates the first admin account
#
# Run as the user that runs pm2 (root here):   bash switch-from-old-app.sh
# Optional settings: BASE=/apps/engtutor APP=engtutor ADMIN_EMAIL=you@school.org ADMIN_NAME="Your Name" YES=1 (skip the confirmation)
set -euo pipefail

BASE="${BASE:-/apps/engtutor}"
OLD="${OLD:-$BASE/iniyavan}"
NEW="${NEW:-$BASE/iniyavan-learn}"
VENV="${VENV:-$BASE/venv-learn}"
APP="${APP:-engtutor}"
REPO="${REPO:-https://github.com/BT-Rajan/iniyavan-learn.git}"
BACKUPS="${BACKUPS:-$BASE/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mxx  %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 1. checks
say "Checking the server"
for cmd in python3 node npm pm2 git mysql mysqldump; do
  command -v "$cmd" >/dev/null || die "$cmd is not installed or not on PATH."
done
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || die "Python 3.10 or newer is needed (found $(python3 --version))."
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)' \
  || die "Node 20.19+ or 22.12+ is needed (found $(node --version))."
python3 -c 'import venv' 2>/dev/null || die "python3-venv is missing: apt install python3-venv"
[ -f "$OLD/.env" ] || [ -f "$NEW/.env" ] || die "No .env found in $OLD or $NEW."
echo "Python $(python3 --version | cut -d' ' -f2), Node $(node --version), pm2 $(pm2 --version)"

ENV_FILE="$NEW/.env"; [ -f "$ENV_FILE" ] || ENV_FILE="$OLD/.env"

# Database settings from DATABASE_URL (the password may be %-encoded, e.g. %23 for #).
read_db() {
  python3 - "$ENV_FILE" <<'PY'
import sys, urllib.parse
url = ""
for line in open(sys.argv[1], encoding="utf-8"):
    line = line.strip()
    if line.startswith("DATABASE_URL="):
        url = line.split("=", 1)[1].strip().strip('"').strip("'")
if not url.startswith("mysql"):
    sys.exit("DATABASE_URL in .env is not a MySQL/MariaDB address: " + (url or "(missing)"))
u = urllib.parse.urlparse(url)
print("\n".join([urllib.parse.unquote(u.username or ""), urllib.parse.unquote(u.password or ""),
                 u.hostname or "localhost", str(u.port or 3306), u.path.lstrip("/")]))
PY
}
DB_INFO="$(read_db)" || die "Could not read DATABASE_URL from $ENV_FILE."
{ read -r DB_USER; read -r DB_PASS; read -r DB_HOST; read -r DB_PORT; read -r DB_NAME; } <<< "$DB_INFO"
[ -n "$DB_NAME" ] || die "DATABASE_URL has no database name."
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || die "Unexpected database name: $DB_NAME"
echo "Database: $DB_NAME on $DB_HOST:$DB_PORT (user $DB_USER)"

# mysql as the app user (password passed through the environment, never on the command line)
as_app() { local cmd="$1"; shift; MYSQL_PWD="$DB_PASS" "$cmd" -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$@"; }
# mysql as an administrator: the local root socket first (works for root on Ubuntu/Debian), then the app user
as_admin_sql() {
  if mysql -e "SELECT 1" >/dev/null 2>&1; then mysql -e "$1"; else as_app mysql -e "$1"; fi
}
as_app mysql -e "SELECT 1" "$DB_NAME" >/dev/null 2>&1 || as_app mysql -e "SELECT 1" >/dev/null 2>&1 \
  || die "Can't connect to the database with the user and password in DATABASE_URL."

# ---------------------------------------------------------------- 2. confirm + backup
cat <<EOF

This will:
  - back up database '$DB_NAME' and old uploads to $BACKUPS
  - put the new app in $NEW (the old folder $OLD is left as it is)
  - stop the pm2 app '$APP' and DELETE ALL DATA in database '$DB_NAME'
  - start the new app under pm2 as '$APP'
EOF
if [ "${YES:-}" != "1" ]; then
  read -r -p "Type the database name ($DB_NAME) to go ahead: " answer
  [ "$answer" = "$DB_NAME" ] || die "Stopped. Nothing was changed."
fi

say "Backing up the old database and uploads"
mkdir -p "$BACKUPS"
if as_app mysql -e "SELECT 1" "$DB_NAME" >/dev/null 2>&1; then
  as_app mysqldump --single-transaction --routines --no-tablespaces "$DB_NAME" | gzip > "$BACKUPS/$DB_NAME-before-switch-$STAMP.sql.gz"
  echo "Database → $BACKUPS/$DB_NAME-before-switch-$STAMP.sql.gz ($(du -h "$BACKUPS/$DB_NAME-before-switch-$STAMP.sql.gz" | cut -f1))"
else
  warn "Database '$DB_NAME' doesn't exist yet — nothing to back up."
fi
if [ -d "$OLD/backend/uploads" ]; then
  tar -czf "$BACKUPS/uploads-before-switch-$STAMP.tar.gz" -C "$OLD/backend" uploads
  echo "Uploads  → $BACKUPS/uploads-before-switch-$STAMP.tar.gz"
fi

# ---------------------------------------------------------------- 3. code
say "Getting the new app"
if [ -d "$NEW/.git" ]; then
  git -C "$NEW" pull --ff-only
else
  [ -e "$NEW" ] && die "$NEW exists but isn't a git checkout. Move it away and run again."
  git clone "$REPO" "$NEW" || die "Clone failed. The repo is private: sign in with your GitHub username and a personal access token."
fi

# ---------------------------------------------------------------- 4. settings
say "Settings (.env)"
if [ ! -f "$NEW/.env" ]; then
  cp "$OLD/.env" "$NEW/.env"
  echo "Copied $OLD/.env"
fi
chmod 600 "$NEW/.env"
grep -q '^DATABASE_URL=.*charset=' "$NEW/.env" || sed -i '/^DATABASE_URL=/{/?/!s/$/?charset=utf8mb4/;/charset=/!s/$/\&charset=utf8mb4/}' "$NEW/.env"
echo "HOST=$(sed -n 's/^HOST=//p' "$NEW/.env" | tail -1)  PORT=$(sed -n 's/^PORT=//p' "$NEW/.env" | tail -1)"

# ---------------------------------------------------------------- 5. stop old, fresh database
say "Stopping the old app"
pm2 describe "$APP" >/dev/null 2>&1 && pm2 delete "$APP" >/dev/null && echo "Stopped pm2 app '$APP'" || echo "pm2 app '$APP' wasn't running"

say "Dropping and recreating database '$DB_NAME'"
as_admin_sql "DROP DATABASE IF EXISTS \`$DB_NAME\`; CREATE DATABASE \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
if mysql -e "SELECT 1" >/dev/null 2>&1 && [ "$DB_HOST" = "localhost" -o "$DB_HOST" = "127.0.0.1" ]; then
  mysql -e "GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost'; FLUSH PRIVILEGES;" 2>/dev/null || true
fi
as_app mysql -e "SELECT 1" "$DB_NAME" >/dev/null || die "The app user can't open the new database."
echo "Fresh, empty database '$DB_NAME' ready"

# ---------------------------------------------------------------- 6. install, build, migrate, start
say "Installing, building and starting (this takes a few minutes)"
(cd "$NEW" && VENV="$VENV" APP="$APP" ./run.sh)

# ---------------------------------------------------------------- 7. admin
has_admin() {
  (cd "$NEW/api" && "$VENV/bin/python" - <<'PY'
from sqlalchemy import select
import app.models  # noqa: F401
from app.core.db import SessionLocal
from app.modules.users.models import User
with SessionLocal() as s:
    raise SystemExit(0 if s.scalar(select(User.id).where(User.role == "admin")) else 1)
PY
  )
}
if ! has_admin; then
  say "Creating the first admin account"
  email="${ADMIN_EMAIL:-}"; name="${ADMIN_NAME:-}"
  [ -n "$email" ] || read -r -p "Admin email: " email
  [ -n "$name" ] || read -r -p "Admin name: " name
  (cd "$NEW/api" && "$VENV/bin/python" -m app.cli create-admin "$email" "$name")
fi

# ---------------------------------------------------------------- done
HOST=$(sed -n 's/^HOST=//p' "$NEW/.env" | tail -1 | tr -d "\"'"); PORT=$(sed -n 's/^PORT=//p' "$NEW/.env" | tail -1 | tr -d "\"'")
sleep 2
if curl -fsS "http://${HOST:-127.0.0.1}:${PORT:-5252}/api/health" >/dev/null 2>&1; then
  say "Done — Iniyavan Learn is running at http://${HOST:-127.0.0.1}:${PORT:-5252}"
else
  warn "The app didn't answer yet. Check: pm2 logs $APP"
fi
cat <<EOF

  Logs:      pm2 logs $APP
  Update:    cd $NEW && git pull && VENV=$VENV ./run.sh
  Backup:    $BACKUPS
  Undo:      pm2 delete $APP
             gunzip < $BACKUPS/$DB_NAME-before-switch-$STAMP.sql.gz | mysql $DB_NAME
             cd $OLD && VENV=$BASE/venv ./run.sh
EOF
