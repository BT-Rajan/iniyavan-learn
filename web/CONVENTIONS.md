# Web app conventions

The rules every screen follows. Read with `../ARCHITECTURE.md`.

## Interaction
- **No popups, toasts, modals or `confirm()`.** Feedback appears where the action happened:
  - `ActionButton`: the button shows a spinner, then a check, and any error sits right beside it.
  - `SaveStatus`: the quiet "Saving… / Saved / what went wrong + Try again" line for autosaving forms.
- **Reversible removals** (archive, hide, remove from a list) happen at once and show an inline Undo:
  `const undo = useUndo(); … undo.offer(t("…"), revertFn)`, then render `<UndoBar undo={undo} />` near the list.
- **Irreversible actions** (delete for good) use `ConfirmButton`, which confirms inline on the second press.
- **Edit in place.** Names and short texts are `InlineText` (click, type, Enter). Forms autosave with `useAutosave`.
  Explicit Save buttons only where a person composes something new (a new user, a new test).
- **Reorder by dragging** with `useSortable` (keyboard: Alt+↑/↓ on the handle).
- Change the cache right away (`queryClient.setQueryData`), then call the API; on failure refetch and show the error.
- Disclosure over navigation: secondary details open in place (`<details className="disclosure">`, inline panels).

## Building blocks (`src/ui`)
`controls.tsx` (Button, ActionButton, useAction, InlineText, ConfirmButton, useUndo/UndoBar, Switch, SavingSwitch,
Segmented, Field, useAutosave, SaveStatus, useSortable), `display.tsx` (PageHead, Crumbs, PageLoading, LoadError, Empty,
Notice, Stars, Bar, Ring, AreaPill, Avatar, Content), `icons.tsx` (Icon), `errors.ts` (useErrorText, useFieldError).
Styles are in `src/styles.css`. Use its classes (`page`, `card`, `stack`, `row`, `grid`, `table-wrap`/`table`, `pill`,
`notice`, `btn`, `muted`, `small`, `num`…) and logical properties only (`marginInlineStart`, never `marginLeft`).

## Data
- All calls go through `api` in `src/api/client.ts`; failures are `ApiError` with a `code` and `params`.
- Shapes are in `src/api/types.ts`. Screen-specific shapes may live next to the screen.
- TanStack Query keys: `["course", id]`, `["topic", id]`, `["quiz", id]`, `["home"]`, `["browse"]`, `["programs"]`, …

## Words
- Every visible word comes from `src/i18n/locales/en/<namespace>.json`, written as ICU messages
  (`{n, plural, one {# topic} other {# topics}}`, `{part, select, …}`). Never build sentences from pieces.
- One namespace per feature (`useTranslation("tests")`); shared words are in `common` (`t("common:actions.save")`).
- Server errors are codes: show them with `useErrorText()(error)`; their words live in `errors.json`.
- Numbers, dates and times go through `src/i18n/format.ts` (Intl).
- Accessibility: every control has a visible label or `aria-label`; status changes use `role="status"`.
