# Architecture

Iniyavan Learn is one application with two ways in:

- **Catalog courses**: staff set up programs, terms, courses, units and topics; students are placed in a program and term and study what is published for them.
- **Personal courses**: a student uploads their own material, the AI slices it into units and topics, and they study it the same way.

Everything a learner does (reading, checks, quizzes, spaced review, stars, points) runs on **one learning engine** that does not care which kind of course a topic belongs to.

## Layout

```
api/                      Python 3.12, FastAPI, SQLAlchemy 2, Alembic
  app/
    core/                 config, database, security (passwords, tokens), errors, request context
    modules/
      auth/               sign in/out, session cookie, password change and reset, self-registration
      users/              accounts, roles, placement (program + term), bulk actions, CSV import
      catalog/            programs, terms, courses (catalog + personal), units, topics, ordering,
                          archive, drafts, versions, sharing; the access policy lives here
      learning/           progress, deadlines, spaced review, stars, points and levels, streak, today
      assessment/         quizzes (tests, practice, review), questions, attempts, results,
                          strengths, gradebook, CSV import, question bank
      studio/             material import (PDF, Word, text), slicing (AI or headings), outlines,
                          applying an outline to a course
      ai/                 provider (any OpenAI-compatible API), prompts, cache, usage limits
      search/             topic search across everything a person may see
      reports/            course and student reports for staff
      admin/              settings, branding, audit log
    main.py               app factory: routers, error handlers, CSRF guard, static web build
    cli.py                create the first admin; load demo data
  migrations/             Alembic (the schema is never changed by hand)
  tests/                  pytest; the AI is a fake in tests
web/                      React 19, TypeScript, Vite, TanStack Query, i18next (ICU)
  src/
    api/                  the API client (typed error codes) and response types
    app/                  router, shell (navigation, search), session, theme
    i18n/                 setup, Intl formatting, locales/<lang>/<namespace>.json
    ui/                   primitives: buttons with busy/done states, inline-edit text, autosave,
                          inline Undo and confirm, fields, progress, content rendering
    features/             one folder per area, matching the API modules
  scripts/i18n-check.mjs  every message is valid ICU and every key used exists
  CONVENTIONS.md          how screens are built
```

Each API module has the same four parts: `models.py` (tables), `schemas.py` (request and
response shapes), `service.py` (business rules, no HTTP), `router.py` (HTTP only). Routers call
services; services call other services, never other routers.

## Rules that shape the code

1. **One access policy.** `catalog/policy.py` answers "may this person see / edit this course?"
   for every module. Nothing else decides access.
2. **Errors are codes.** Services raise `AppError("course.not_found", 404, {...})`. The API returns
   `{"error": {"code", "params"}}`; the web app translates the code. Validation errors list the
   field and a code per field. No English sentence leaves the API.
3. **Content is safe by construction.** Topic content is Markdown, or HTML cleaned by an
   allow-list on every write and every read. Uploaded images are checked by their bytes.
4. **The AI only points; it does not rewrite.** Slicing returns paragraph ranges and titles, so
   topics keep the author's words. Generated questions are limited to facts in the material.
   Every AI call goes through one gateway that applies keys, caching and daily limits.
5. **Points are derived, never stored.** Stars, mastery, points and levels are computed from
   progress and attempts, so they cannot drift.
6. **The schema changes only through Alembic migrations.**

## Interaction principles (web)

- **No popups for feedback.** A button shows its own state: idle, working, done (a check that
  fades), or the error under it. Forms validate inline as you type.
- **No confirm dialogs.** Destructive actions happen with an inline **Undo** for a few seconds
  before they are sent.
- **Edit in place.** Titles are edited where they are shown; the topic editor autosaves and keeps
  versions; lists are reordered by dragging or with the keyboard.
- **One obvious next step.** Home always shows what to do now (continue, review due, overdue).
- **Accessible.** Every control works with the keyboard and a screen reader; colour is never the
  only signal.

## Internationalisation

- All user-facing text is in `web/src/i18n/locales/<lang>/<namespace>.json`, ICU message format (plurals,
  selects). English ships first; adding a language is adding a file.
- Dates, numbers and relative times use `Intl` with the user's locale.
- Layout uses logical CSS properties (`margin-inline-start`, `inset-inline-end`) and the `dir`
  attribute, so right-to-left languages work without new CSS.
- The user's language is stored on their account; the AI is told to answer in the material's
  language.
