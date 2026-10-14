# Iniyavan Learn

A learning platform for schools and colleges, and for students on their own.

- **Staff** set up programs (semesters, years or school grades 1–12), terms, courses, units and topics;
  write tests (by hand or from CSV, with images); see results, a gradebook and reports.
- **Students** study what is published for their term: read a topic, ask for a simple explanation or a
  model answer, take quick checks and quizzes written fresh from the topic, review at spaced intervals,
  and collect stars, points and levels.
- **Anyone** can turn their own notes (PDF, Word, pasted text) into a course: the material is split into
  small topics, which they adjust and then study with the same tools — and can share with classmates.

The interface is built to be obvious: one clear next step on the home page, edit in place, changes that
save themselves, and feedback right where you acted — no popups. Every word is translatable (ICU messages);
English ships today.

## Run it

**Try it with demo data** (Python 3.12 and Node 22):

```sh
scripts/dev.sh                      # first run creates .env, installs, migrates; then API :8000 + web :5173
cd api && python -m app.cli demo    # in another terminal: a small school to explore
```

Open http://localhost:5173 and sign in as `admin@demo.school`, `teacher@demo.school` or
`student@demo.school` with the password `demo-pass-1`.

**Production** (one container; the API serves the built web app):

```sh
cp .env.example .env                # set SECRET_KEY at least
docker compose up -d --build
docker compose exec app python -m app.cli create-admin you@school.org "Your Name"
```

Data (SQLite database and uploads) lives in the `data` volume. Use PostgreSQL or MySQL by setting
`DATABASE_URL`. Set `SECURE_COOKIES=1` behind HTTPS. Mail settings turn on password reset and
self-registration; an AI key (in `.env` or Admin → Settings) turns on the AI helper.

## Develop

```sh
cd api && pytest -q && ruff check .                 # API tests (the AI is faked)
cd web && npm run typecheck && npm run i18n:check   # web checks
cd api && alembic revision --autogenerate -m "…"   # after changing models
```

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the layout and the rules the code follows,
[docs/business-rules.md](docs/business-rules.md) for what the app must do, and
[web/CONVENTIONS.md](web/CONVENTIONS.md) for how screens are built.

### Adding a language

Copy `web/src/i18n/locales/en` to `web/src/i18n/locales/<code>`, translate the values (keep the ICU
`{placeholders}`), add the language to `LANGUAGES` in `web/src/i18n/index.ts` (with `dir: "rtl"` for
right-to-left scripts) and to `LOCALES` in `api/app/modules/auth/router.py`. `npm run i18n:check` reports
missing or broken messages.
