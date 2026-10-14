import { type InfiniteData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { api, ApiError, qs } from "@/api/client";
import type { Program, Role, UserRow } from "@/api/types";
import { useMe } from "@/app/session";
import { fmtDateTime, fmtNumber, fmtRelative } from "@/i18n/format";
import { ActionButton, Button, ConfirmButton, Field, SaveStatus, Segmented, Switch, useAction, UndoBar, useUndo } from "@/ui/controls";
import { Empty, LoadError, Notice, PageHead, PageLoading } from "@/ui/display";
import { useErrorText, useFieldError } from "@/ui/errors";
import { Icon } from "@/ui/icons";

import { CopyButton, type Credential, Credentials, downloadFile, usePrograms } from "./parts";

const PAGE = 50;
const ROLES: Role[] = ["student", "faculty", "admin"];

interface UsersPage { total: number; items: UserRow[] }
interface Filters { q: string; role: string; program: string; term: string }
interface BulkResult { changed: number; skipped: { id: number; name: string; reason: string }[]; credentials: Credential[] }
interface ImportResult {
  dry_run: boolean; rows: number; created: number; updated: number; error_count: number; credentials: Credential[];
  errors: { row: number; code: string; params: Record<string, unknown> }[];
}
type Change = Partial<Pick<UserRow, "role" | "active" | "program_id" | "term_no">>;

const liveTerms = (programs: Program[], id: number | null | undefined) => programs.find((p) => p.id === id)?.terms.filter((x) => !x.archived) ?? [];
const compactSelect = { inlineSize: "auto", minBlockSize: 34, paddingBlock: 4 } as const;
const mono = { fontFamily: "var(--mono)", fontSize: "1rem" } as const;

/** Changes one person everywhere they are cached, so the table updates before the server answers. */
function useSetRow() {
  const qc = useQueryClient();
  return (id: number, fn: (u: UserRow) => UserRow) =>
    qc.setQueriesData<InfiniteData<UsersPage>>({ queryKey: ["users"] }, (d) =>
      d && { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map((u) => (u.id === id ? fn(u) : u)) })) });
}

/** Program and term pickers; the term list follows the program. */
function Placement({ programs, program, term, onChange, id, compact }: {
  programs: Program[]; program: number | null; term: number | null; onChange: (program: number | null, term: number | null) => void; id?: string; compact?: boolean;
}) {
  const { t } = useTranslation("admin");
  const style = compact ? compactSelect : { inlineSize: "auto" };
  return (
    <span className="row tight nowrap">
      <select id={id} aria-label={t("people.program")} value={program ?? ""} style={style}
              onChange={(e) => {
                const next = e.target.value ? Number(e.target.value) : null;
                const keep = term != null && liveTerms(programs, next).some((x) => x.number === term) ? term : null;
                onChange(next, keep);
              }}>
        <option value="">{t("people.noProgram")}</option>
        {programs.filter((p) => !p.archived || p.id === program).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {program != null && (
        <select aria-label={t("people.term")} value={term ?? ""} style={style} onChange={(e) => onChange(program, e.target.value ? Number(e.target.value) : null)}>
          <option value="">{t("people.noTerm")}</option>
          {liveTerms(programs, program).map((x) => <option key={x.id} value={x.number}>{x.name}</option>)}
        </select>
      )}
    </span>
  );
}

function PersonRow({ u, self, programs, selected, onSelect }: { u: UserRow; self: boolean; programs: Program[]; selected: boolean; onSelect: (on: boolean) => void }) {
  const { t } = useTranslation("admin");
  const setRow = useSetRow();
  const [temp, setTemp] = useState<string | null>(null);
  const save = useAction(async (change: Change) => {
    const before = u;
    setRow(u.id, (x) => ({ ...x, ...change }));
    try {
      const fresh = await api.patch<UserRow>(`/api/users/${u.id}`, change);
      setRow(u.id, () => fresh);
    } catch (e) {
      setRow(u.id, () => before);
      throw e;
    }
  });
  const selfHint = self ? t("people.selfHint") : undefined;
  return (
    <>
      <tr className={selected ? "selected" : ""}>
        <td>
          <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={t("people.select", { name: u.name })} />
        </td>
        <td style={{ minInlineSize: 220 }}>
          <div className="stack" style={{ gap: 0, opacity: u.active ? 1 : 0.65 }}>
            <span className="row tight">
              {u.role === "student" ? <Link to={`/students/${u.id}`} style={{ fontWeight: 560 }}>{u.name}</Link> : <strong style={{ fontWeight: 560 }}>{u.name}</strong>}
              {self && <span className="pill accent">{t("people.you")}</span>}
              {!u.active && <span className="pill">{t("people.offPill")}</span>}
              {u.self_registered && <span className="pill">{t("people.selfRegistered")}</span>}
              {u.must_change_password && u.active && <span className="pill warn" title={t("people.mustChangeHint")}>{t("people.mustChange")}</span>}
            </span>
            <span className="small muted">{u.email}</span>
          </div>
          {save.state !== "idle" && <SaveStatus state={save.state} error={save.error} />}
        </td>
        <td>
          <select aria-label={t("people.roleOf", { name: u.name })} value={u.role} disabled={self} title={selfHint} style={compactSelect}
                  onChange={(e) => void save.run({ role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r} value={r}>{t(`common:roles.${r}`)}</option>)}
          </select>
        </td>
        <td>
          {u.role === "student"
            ? <Placement compact programs={programs} program={u.program_id} term={u.term_no} onChange={(p, n) => void save.run({ program_id: p, term_no: n })} />
            : <span className="faint">—</span>}
        </td>
        <td title={selfHint}>
          <Switch checked={u.active} disabled={self} onChange={(v) => void save.run({ active: v })}
                  label={<><span className="sr-only">{t("people.activeFor", { name: u.name })}</span><span aria-hidden className="small muted">{u.active ? t("people.on") : t("people.off")}</span></>} />
        </td>
        <td className="small muted nowrap" title={u.last_seen_at ? fmtDateTime(u.last_seen_at) : undefined}>
          {u.last_seen_at ? fmtRelative(u.last_seen_at) : t("people.never")}
        </td>
        <td>
          <span className="row tight nowrap">
            <ConfirmButton icon="key" confirmLabel={t("people.resetConfirm")} action={async () => {
              const r = await api.post<{ password: string }>(`/api/users/${u.id}/reset-password`);
              setTemp(r.password);
              setRow(u.id, (x) => ({ ...x, must_change_password: true }));
            }}>{t("people.reset")}</ConfirmButton>
          </span>
        </td>
      </tr>
      {temp && (
        <tr className="fade-in">
          <td />
          <td colSpan={6}>
            <Notice tone="good" icon="key" title={t("people.tempTitle", { name: u.name })}
                    action={<Button size="small" variant="ghost" icon="x" aria-label={t("common:actions.dismiss")} onClick={() => setTemp(null)} />}>
              <span className="row tight" style={{ marginBlockStart: 4 }}>
                <code style={mono}>{temp}</code>
                <CopyButton text={temp} />
              </span>
              <span className="small muted">{t("people.tempHint")}</span>
            </Notice>
          </td>
        </tr>
      )}
    </>
  );
}

function BulkBar({ rows, programs, onClear, onDone }: { rows: UserRow[]; programs: Program[]; onClear: () => void; onDone: () => void }) {
  const { t } = useTranslation("admin");
  const err = useErrorText();
  const undo = useUndo();
  const [program, setProgram] = useState<number | null>(null);
  const [term, setTerm] = useState<number | null>(null);
  const [result, setResult] = useState<(BulkResult & { action: string }) | null>(null);
  const send = async (action: string, ids: number[], extra: Record<string, unknown> = {}) => {
    const r = await api.post<BulkResult>("/api/users/bulk", { ids, action, ...extra });
    onDone();
    return r;
  };
  const run = (action: string, extra: Record<string, unknown> = {}) => async () => {
    const wasActive = rows.filter((r) => r.active).map((r) => r.id);
    const r = await send(action, rows.map((x) => x.id), extra);
    setResult({ ...r, action });
    if (action === "disable" && r.changed > 0 && wasActive.length) {
      undo.offer(t("bulk.disabledUndo", { n: r.changed }), async () => { await send("enable", wasActive); setResult(null); });
    }
  };
  const reason = (code: string) => t(`bulk.reasons.${code.replace(/\./g, "_")}`, { defaultValue: err(new ApiError(400, code)) });
  return (
    <div className="card stack tight fade-in" role="region" aria-label={t("bulk.label")} style={{ background: "var(--accent-soft)", borderColor: "var(--accent)" }}>
      <div className="row between">
        <strong>{t("bulk.selected", { n: rows.length })}</strong>
        <Button size="small" variant="ghost" icon="x" onClick={onClear}>{t("bulk.clear")}</Button>
      </div>
      <div className="row">
        <ActionButton size="small" icon="eyeOff" action={run("disable")}>{t("bulk.disable")}</ActionButton>
        <ActionButton size="small" icon="eye" action={run("enable")}>{t("bulk.enable")}</ActionButton>
        <span className="row tight">
          <Placement compact programs={programs} program={program} term={term} onChange={(p, n) => { setProgram(p); setTerm(n); }} />
          <ActionButton size="small" icon="layers" disabled={program == null} action={run("place", { program_id: program, term_no: term })}>{t("bulk.place")}</ActionButton>
        </span>
        <ConfirmButton icon="key" confirmLabel={t("bulk.resetConfirm", { n: rows.length })} action={run("reset_passwords")}>{t("bulk.reset")}</ConfirmButton>
      </div>
      <UndoBar undo={undo} />
      {result && (
        <div className="stack tight fade-in" role="status">
          <span className="status ok"><Icon name="check" /> {t("bulk.result", { action: result.action, n: result.changed })}</span>
          {result.skipped.length > 0 && (
            <div className="small">
              <strong>{t("bulk.skipped", { n: result.skipped.length })}</strong>
              <ul style={{ margin: "4px 0 0", paddingInlineStart: 20 }}>
                {result.skipped.map((s) => <li key={s.id}>{t("bulk.skippedRow", { name: s.name, reason: reason(s.reason) })}</li>)}
              </ul>
            </div>
          )}
          <Credentials items={result.credentials} file="new-passwords.csv" />
        </div>
      )}
    </div>
  );
}

function NewPerson({ programs, onClose, onCreated }: { programs: Program[]; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation("admin");
  const fe = useFieldError();
  const err = useErrorText();
  const blank = { name: "", email: "", password: "" };
  const [f, setF] = useState(blank);
  const [role, setRole] = useState<Role>("student");
  const [program, setProgram] = useState<number | null>(null);
  const [term, setTerm] = useState<number | null>(null);
  const [made, setMade] = useState<{ name: string; password: string | null } | null>(null);
  const create = useAction(
    () => api.post<UserRow & { password: string | null }>("/api/users", {
      name: f.name.trim(), email: f.email.trim(), role, password: f.password,
      program_id: role === "student" ? program : null, term_no: role === "student" ? term : null,
    }),
    { onDone: (r) => { setMade({ name: r.name, password: r.password }); setF(blank); onCreated(); }, doneFor: 900 },
  );
  const code = create.error instanceof ApiError ? create.error.code : "";
  const nameErr = fe(create.error, "name");
  const emailErr = fe(create.error, "email") ?? (code.startsWith("user.email") ? err(create.error) : undefined);
  const passwordErr = fe(create.error, "password") ?? (code === "user.password_short" ? err(create.error) : undefined);
  const placeErr = code.startsWith("program.") ? err(create.error) : undefined;
  const otherErr = create.state === "error" && !nameErr && !emailErr && !passwordErr && !placeErr;
  const submit = (e: FormEvent) => { e.preventDefault(); setMade(null); void create.run(); };
  return (
    <form className="card stack fade-in" onSubmit={submit} aria-labelledby="new-person">
      <div className="row between">
        <h2 id="new-person">{t("add.title")}</h2>
        <Button variant="ghost" size="small" icon="x" aria-label={t("common:actions.close")} onClick={onClose} />
      </div>
      <div className="grid">
        <Field label={t("add.name")} error={nameErr}>
          {(id, d) => <input id={id} aria-describedby={d} type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} autoFocus aria-invalid={!!nameErr || undefined} />}
        </Field>
        <Field label={t("add.email")} error={emailErr}>
          {(id, d) => <input id={id} aria-describedby={d} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} maxLength={200} autoComplete="off" aria-invalid={!!emailErr || undefined} />}
        </Field>
        <Field label={t("add.password")} hint={t("add.passwordHint")} error={passwordErr}>
          {(id, d) => <input id={id} aria-describedby={d} type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} maxLength={200} autoComplete="new-password" aria-invalid={!!passwordErr || undefined} />}
        </Field>
      </div>
      <div className="row" style={{ gap: 20, alignItems: "flex-start" }}>
        <div className="stack tight">
          <span style={{ fontWeight: 560, fontSize: "0.9rem" }}>{t("add.role")}</span>
          <Segmented label={t("add.role")} value={role} onChange={setRole} options={ROLES.map((r) => ({ value: r, label: t(`common:roles.${r}`) }))} />
        </div>
        {role === "student" && (
          <div className="stack tight">
            <label htmlFor="new-person-program" style={{ fontWeight: 560, fontSize: "0.9rem" }}>{t("add.placement")}</label>
            <Placement id="new-person-program" programs={programs} program={program} term={term} onChange={(p, n) => { setProgram(p); setTerm(n); }} />
            {placeErr && <span className="field-error">{placeErr}</span>}
          </div>
        )}
      </div>
      <div className="row">
        <Button type="submit" variant="primary" icon="plus" busy={create.busy} disabled={!f.name.trim() || !f.email.trim()}>{t("add.create")}</Button>
        {otherErr && <span className="status err" role="status">{err(create.error)}</span>}
      </div>
      {made && (
        <Notice tone="good" icon="check" title={t("add.made", { name: made.name })}>
          {made.password ? (
            <>
              <span className="row tight" style={{ marginBlockStart: 4 }}>
                <span>{t("add.tempPassword")}</span>
                <code style={mono}>{made.password}</code>
                <CopyButton text={made.password} />
              </span>
              <span className="small muted">{t("people.tempHint")}</span>
            </>
          ) : <span className="small muted">{t("add.ownPassword")}</span>}
        </Notice>
      )}
    </form>
  );
}

const TEMPLATE = "name,email,role,program,term\nPriya Pupil,priya@school.example,student,Green School,7\nTamil Teacher,tamil@school.example,faculty,,\n";
const COLUMNS = ["name", "email", "role", "program", "term", "password"] as const;

function ImportPanel({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { t } = useTranslation("admin");
  const err = useErrorText();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const check = useAction(() => api.post<ImportResult>("/api/users/import", { csv: text, dry_run: true }), { onDone: (r) => { setPreview(r); setDone(null); } });
  const run = useAction(() => api.post<ImportResult>("/api/users/import", { csv: text, dry_run: false }), {
    onDone: (r) => { setDone(r); setPreview(null); setText(""); setFileName(""); onImported(); },
  });
  const edit = (v: string) => { setText(v); setPreview(null); check.reset(); };
  const ready = preview ? preview.created + preview.updated : 0;
  return (
    <section className="card stack fade-in" aria-labelledby="import-title">
      <div className="row between">
        <h2 id="import-title">{t("import.title")}</h2>
        <Button variant="ghost" size="small" icon="x" aria-label={t("common:actions.close")} onClick={onClose} />
      </div>
      <details className="disclosure" open>
        <summary>{t("import.columnsTitle")}</summary>
        <div className="stack tight" style={{ marginBlockStart: 8 }}>
          <ul className="small" style={{ margin: 0, paddingInlineStart: 20 }}>
            {COLUMNS.map((c) => <li key={c}><code style={{ fontFamily: "var(--mono)" }}>{c}</code> — {t(`import.columns.${c}`)}</li>)}
          </ul>
          <p className="small muted">{t("import.existing")}</p>
          <div><Button size="small" variant="ghost" icon="download" onClick={() => downloadFile("people-template.csv", TEMPLATE)}>{t("import.template")}</Button></div>
        </div>
      </details>
      <div className="row">
        <label className="btn small" style={{ cursor: "pointer" }}>
          <Icon name="upload" /> {t("import.chooseFile")}
          <input type="file" accept=".csv,text/csv,text/plain" className="sr-only"
                 onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) { setFileName(file.name); edit(await file.text()); } }} />
        </label>
        {fileName && <span className="small muted">{t("import.chosen", { name: fileName })}</span>}
      </div>
      <Field label={t("import.paste")}>
        {(id) => <textarea id={id} value={text} onChange={(e) => { setFileName(""); edit(e.target.value); }} rows={6} spellCheck={false}
                           placeholder={TEMPLATE} style={{ fontFamily: "var(--mono)", fontSize: "0.86rem" }} />}
      </Field>
      <div className="row">
        <Button variant={preview ? "default" : "primary"} icon="eye" busy={check.busy} disabled={!text.trim()} onClick={() => void check.run()}>{t("import.check")}</Button>
        {check.state === "error" && <span className="status err" role="status">{err(check.error)}</span>}
      </div>
      {preview && (
        <div className="stack tight fade-in" role="status">
          <Notice tone={preview.error_count ? "warn" : "info"} icon="file"
                  title={t("import.summary", { rows: preview.rows, created: preview.created, updated: preview.updated, errors: preview.error_count })}>
            {preview.error_count > 0 ? t("import.leftOut") : undefined}
          </Notice>
          {preview.errors.length > 0 && (
            <ul className="small" style={{ margin: 0, paddingInlineStart: 20 }}>
              {preview.errors.map((e) => <li key={e.row}>{t("import.rowError", { row: e.row, message: err(new ApiError(400, e.code, e.params)) })}</li>)}
              {preview.error_count > preview.errors.length && <li className="muted">{t("import.moreErrors", { n: preview.error_count - preview.errors.length })}</li>}
            </ul>
          )}
          <div className="row">
            <Button variant="primary" icon="upload" busy={run.busy} disabled={!ready} onClick={() => void run.run()}>{t("import.run", { n: ready })}</Button>
            {run.state === "error" && <span className="status err">{err(run.error)}</span>}
          </div>
        </div>
      )}
      {done && (
        <div className="stack tight fade-in" role="status">
          <span className="status ok"><Icon name="check" /> {t("import.done", { created: done.created, updated: done.updated })}</span>
          <Credentials items={done.credentials} file="new-accounts.csv" />
        </div>
      )}
    </section>
  );
}

export default function People() {
  const { t } = useTranslation("admin");
  const me = useMe();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const filters: Filters = { q: params.get("q") ?? "", role: params.get("role") ?? "", program: params.get("program") ?? "", term: params.get("term") ?? "" };
  const [text, setText] = useState(filters.q);
  const [panel, setPanel] = useState<"add" | "import" | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const programs = usePrograms();
  const progs = programs.data ?? [];

  const setParam = (changes: Partial<Filters>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };
  useEffect(() => {
    const id = window.setTimeout(() => { if (text.trim() !== filters.q) setParam({ q: text.trim() }); }, 300);
    return () => window.clearTimeout(id);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const filterKey = JSON.stringify(filters);
  useEffect(() => setSelected(new Set()), [filterKey]);

  const q = useInfiniteQuery({
    queryKey: ["users", filters],
    queryFn: ({ pageParam }) => api.get<UsersPage>(`/api/users${qs({ q: filters.q, role: filters.role, program_id: filters.program, term_no: filters.term, limit: PAGE, offset: pageParam })}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const n = pages.reduce((s, p) => s + p.items.length, 0);
      return n < last.total ? n : undefined;
    },
    placeholderData: (prev) => prev,
  });
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const total = q.data?.pages[0]?.total ?? 0;
  const chosen = rows.filter((r) => selected.has(r.id));
  const all = rows.length > 0 && chosen.length === rows.length;
  const head = useRef<HTMLInputElement>(null);
  useEffect(() => { if (head.current) head.current.indeterminate = chosen.length > 0 && !all; }, [chosen.length, all]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["users"] });
    void qc.invalidateQueries({ queryKey: ["programs"] });
  };
  const toggle = (id: number, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const program = progs.find((p) => String(p.id) === filters.program);
  const filtered = !!(filters.q || filters.role || filters.program);

  return (
    <div className="page">
      <PageHead title={t("people.title")} sub={q.data ? t("people.count", { n: total, filtered: filtered ? "yes" : "no" }) : undefined} actions={
        <>
          <Button icon="upload" aria-expanded={panel === "import"} onClick={() => setPanel(panel === "import" ? null : "import")}>{t("people.import")}</Button>
          <Button variant="primary" icon="plus" aria-expanded={panel === "add"} onClick={() => setPanel(panel === "add" ? null : "add")}>{t("people.add")}</Button>
        </>
      } />
      <div className="stack">
        {panel === "add" && <NewPerson programs={progs} onClose={() => setPanel(null)} onCreated={refresh} />}
        {panel === "import" && <ImportPanel onClose={() => setPanel(null)} onImported={refresh} />}

        <div className="row" role="search" aria-label={t("people.filters")}>
          <div className="searchbox" style={{ minInlineSize: 200 }}>
            <Icon name="search" />
            <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("people.search")} aria-label={t("people.search")} />
          </div>
          <Segmented label={t("people.roleFilter")} value={filters.role} onChange={(v) => setParam({ role: v })}
                     options={[{ value: "", label: t("people.roles.all") }, { value: "student", label: t("people.roles.student") },
                               { value: "faculty", label: t("people.roles.faculty") }, { value: "admin", label: t("people.roles.admin") }]} />
          <select aria-label={t("people.programFilter")} value={filters.program} style={{ inlineSize: "auto" }} onChange={(e) => setParam({ program: e.target.value, term: "" })}>
            <option value="">{t("people.anyProgram")}</option>
            {progs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {program && (
            <select aria-label={t("people.termFilter")} value={filters.term} style={{ inlineSize: "auto" }} onChange={(e) => setParam({ term: e.target.value })}>
              <option value="">{t("people.anyTerm")}</option>
              {program.terms.map((x) => <option key={x.id} value={x.number}>{x.name}</option>)}
            </select>
          )}
          {q.isFetching && !q.isPending && <span className="spin" aria-hidden style={{ inlineSize: 14, blockSize: 14, color: "var(--faint)" }} />}
        </div>

        {chosen.length > 0 && <BulkBar rows={chosen} programs={progs} onClear={() => setSelected(new Set())} onDone={refresh} />}

        {q.isPending ? <PageLoading /> : q.isError ? <LoadError error={q.error} retry={() => void q.refetch()} /> : rows.length === 0 ? (
          <Empty icon="users" title={filtered ? t("people.noMatch") : t("people.emptyTitle")}
                 action={filtered ? <Button onClick={() => { setText(""); setParams(new URLSearchParams(), { replace: true }); }}>{t("people.clearFilters")}</Button> : undefined}>
            {filtered ? undefined : t("people.empty")}
          </Empty>
        ) : (
          <>
            <div className="table-wrap" style={{ position: "relative" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col" style={{ inlineSize: 40 }}>
                      <input ref={head} type="checkbox" checked={all} aria-label={t("people.selectAll")}
                             onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
                    </th>
                    <th scope="col">{t("people.cols.person")}</th>
                    <th scope="col">{t("people.cols.role")}</th>
                    <th scope="col">{t("people.cols.placement")}</th>
                    <th scope="col">{t("people.cols.active")}</th>
                    <th scope="col">{t("people.cols.lastSeen")}</th>
                    <th scope="col"><span className="sr-only">{t("people.cols.actions")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => <PersonRow key={u.id} u={u} self={u.id === me.id} programs={progs} selected={selected.has(u.id)} onSelect={(on) => toggle(u.id, on)} />)}
                </tbody>
              </table>
            </div>
            <div className="row between">
              <span className="small muted num">{t("people.showing", { shown: fmtNumber(rows.length), total: fmtNumber(total) })}</span>
              {q.hasNextPage && <Button busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{t("common:actions.showMore")}</Button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
