import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "@/api/client";
import type { Program, ProgramTerm } from "@/api/types";
import { fmtList } from "@/i18n/format";
import { ActionButton, Button, ConfirmButton, Field, InlineText, SaveStatus, Segmented, useAction, UndoBar, useUndo } from "@/ui/controls";
import { Empty, LoadError, Notice, PageHead, PageLoading } from "@/ui/display";
import { useErrorText, useFieldError } from "@/ui/errors";
import { Icon } from "@/ui/icons";

import { type Pattern, PATTERNS, usePrograms } from "./parts";

interface Rollover {
  dry_run: boolean; last_term: number; term: string; moving: number; finishing: number; unplaced: number; finishing_names: string[]; unplaced_names: string[];
}
type Finishing = "keep" | "deactivate";

const PATTERN_KEYS = Object.keys(PATTERNS) as Pattern[];

function useSetPrograms() {
  const qc = useQueryClient();
  return {
    map: (fn: (list: Program[]) => Program[]) => qc.setQueryData<Program[]>(["programs"], (d) => (d ? fn(d) : d)),
    put: (p: Program) => qc.setQueryData<Program[]>(["programs"], (d) => d?.map((x) => (x.id === p.id ? p : x))),
    edit: (id: number, fn: (p: Program) => Program) => qc.setQueryData<Program[]>(["programs"], (d) => d?.map((x) => (x.id === id ? fn(x) : x))),
    refresh: () => qc.invalidateQueries({ queryKey: ["programs"] }),
  };
}

/** Names of people, with "and N more" when the server sent only the first few. */
function Names({ names, count }: { names: string[]; count: number }) {
  const { t } = useTranslation("admin");
  if (!names.length) return null;
  const more = count - names.length;
  return <span className="small muted">{more > 0 ? t("rollover.namesMore", { names: names.join(", "), n: more }) : fmtList(names)}</span>;
}

/** R-PROG-6: preview the move first, choose what happens to finishing students, then do it. */
function RolloverPanel({ p, onClose }: { p: Program; onClose: () => void }) {
  const { t } = useTranslation("admin");
  const err = useErrorText();
  const qc = useQueryClient();
  const [finishing, setFinishing] = useState<Finishing>("keep");
  const [outcome, setOutcome] = useState<(Rollover & { choice: Finishing }) | null>(null);
  const preview = useQuery({
    queryKey: ["rollover", p.id],
    queryFn: () => api.post<Rollover>(`/api/programs/${p.id}/rollover`, { dry_run: true }),
    staleTime: 0, gcTime: 0,
  });
  const go = useAction(() => api.post<Rollover>(`/api/programs/${p.id}/rollover`, { dry_run: false, finishing }), {
    onDone: (r) => {
      setOutcome({ ...r, choice: finishing });
      void qc.invalidateQueries({ queryKey: ["programs"] });
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
  const r = preview.data;
  return (
    <div className="panel stack tight fade-in" style={{ margin: "0 16px 16px" }} aria-labelledby={`roll-${p.id}`}>
      <div className="row between">
        <h3 id={`roll-${p.id}`}>{t("rollover.title")}</h3>
        <Button size="small" variant="ghost" icon="x" aria-label={t("common:actions.close")} onClick={onClose} />
      </div>
      {outcome ? (
        <div className="stack tight" role="status">
          <Notice tone="good" icon="check" title={t("rollover.done", { n: outcome.moving })}>
            {outcome.finishing > 0 ? t("rollover.doneFinishing", { n: outcome.finishing, choice: outcome.choice }) : undefined}
          </Notice>
          <div><Button size="small" onClick={onClose}>{t("common:actions.done")}</Button></div>
        </div>
      ) : preview.isPending ? (
        <p className="small muted" role="status"><span className="spin" aria-hidden style={{ inlineSize: 12, blockSize: 12 }} /> {t("rollover.checking")}</p>
      ) : preview.isError ? (
        <span className="status err" role="status">{err(preview.error)} <Button size="small" variant="ghost" onClick={() => void preview.refetch()}>{t("common:actions.retry")}</Button></span>
      ) : r && (
        <>
          <p className="small muted">{t("rollover.intro")}</p>
          <ul className="stack tight" style={{ margin: 0, paddingInlineStart: 20 }}>
            <li><strong>{t("rollover.moving", { n: r.moving })}</strong></li>
            {r.finishing > 0 && (
              <li className="stack" style={{ gap: 2 }}>
                <strong>{t("rollover.finishing", { n: r.finishing, term: r.term, last: r.last_term })}</strong>
                <Names names={r.finishing_names} count={r.finishing} />
              </li>
            )}
            {r.unplaced > 0 && (
              <li className="stack" style={{ gap: 2 }}>
                <span>{t("rollover.unplaced", { n: r.unplaced })}</span>
                <Names names={r.unplaced_names} count={r.unplaced} />
              </li>
            )}
          </ul>
          {r.finishing > 0 && (
            <fieldset className="stack tight" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="small" style={{ fontWeight: 560, marginBlockEnd: 6 }}>{t("rollover.choiceLabel", { n: r.finishing })}</legend>
              {(["keep", "deactivate"] as const).map((c) => (
                <label key={c} className="check">
                  <input type="radio" name={`finishing-${p.id}`} value={c} checked={finishing === c} onChange={() => setFinishing(c)} />
                  {t(`rollover.choice.${c}`, { term: r.term, last: r.last_term })}
                </label>
              ))}
            </fieldset>
          )}
          <div className="row">
            <Button variant="primary" icon="chevronRight" busy={go.busy} disabled={r.moving === 0 && (r.finishing === 0 || finishing === "keep")} onClick={() => void go.run()}>
              {t("rollover.confirm", { n: r.moving })}
            </Button>
            <Button variant="ghost" onClick={onClose}>{t("common:actions.cancel")}</Button>
            {go.state === "error" && <span className="status err" role="status">{err(go.error)}</span>}
          </div>
        </>
      )}
    </div>
  );
}

function AddTerm({ p, onAdded }: { p: Program; onAdded: () => void }) {
  const { t } = useTranslation("admin");
  const err = useErrorText();
  const max = PATTERNS[p.pattern].max;
  const taken = new Set(p.terms.map((x) => x.number));
  const free = Array.from({ length: max }, (_, i) => i + 1).filter((n) => !taken.has(n));
  const [number, setNumber] = useState<string>("");
  const [name, setName] = useState("");
  const n = Number(number || free[0]);
  const add = useAction(() => api.post(`/api/programs/${p.id}/terms`, { number: n, name: name.trim() }), {
    onDone: () => { setName(""); setNumber(""); onAdded(); }, doneFor: 900,
  });
  if (!free.length) return <p className="small muted" style={{ padding: "10px 16px" }}>{t("programs.allTerms", { n: max, pattern: p.pattern })}</p>;
  const submit = (e: FormEvent) => { e.preventDefault(); void add.run(); };
  return (
    <form className="add-row" onSubmit={submit} style={{ flexWrap: "wrap", alignItems: "center" }}>
      <Icon name="plus" style={{ color: "var(--faint)" }} />
      <select aria-label={t("programs.termNumber")} value={number || String(free[0])} onChange={(e) => setNumber(e.target.value)} style={{ inlineSize: "auto" }}>
        {free.map((x) => <option key={x} value={x}>{t("programs.numberOption", { n: x })}</option>)}
      </select>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={150} aria-label={t("programs.termName")}
             placeholder={t("programs.termNamePlaceholder", { label: p.term_label, n })} style={{ flex: 1, minInlineSize: 160, inlineSize: "auto" }} />
      <Button type="submit" size="small" busy={add.busy}>{t("programs.addTerm")}</Button>
      {add.state === "error" && <span className="status err" role="status">{err(add.error)}</span>}
    </form>
  );
}

function TermRow({ term, p, undo }: { term: ProgramTerm; p: Program; undo: ReturnType<typeof useUndo> }) {
  const { t } = useTranslation("admin");
  const set = useSetPrograms();
  const setTerm = (change: Partial<ProgramTerm>) => set.edit(p.id, (x) => ({ ...x, terms: x.terms.map((y) => (y.id === term.id ? { ...y, ...change } : y)) }));
  const archive = async (archived: boolean) => {
    await api.put(`/api/terms/${term.id}/archive`, { archived });
    setTerm({ archived });
    if (archived) {
      undo.offer(t("programs.termArchived", { name: term.name }), async () => {
        await api.put(`/api/terms/${term.id}/archive`, { archived: false });
        setTerm({ archived: false });
      });
    }
  };
  return (
    <div className="topic-row" style={{ opacity: term.archived ? 0.6 : 1 }}>
      <span className="state" aria-hidden>{term.number}</span>
      <span className="grow row tight">
        <InlineText value={term.name} label={t("programs.renameTerm", { n: term.number })} maxLength={150} disabled={p.archived}
                    onSave={async (name) => { const r = await api.patch<{ name: string }>(`/api/terms/${term.id}`, { name }); setTerm({ name: r.name }); }} />
        {term.archived && <span className="pill warn">{t("common:status.archived")}</span>}
      </span>
      <span className="small muted nowrap">{t("programs.courses", { n: term.courses })}</span>
      {term.archived ? (
        <ActionButton size="small" variant="ghost" icon="undo" disabled={p.archived} action={() => archive(false)}>{t("common:actions.restore")}</ActionButton>
      ) : (
        <ActionButton size="small" variant="ghost" icon="archive" disabled={p.archived} title={t("programs.archiveTerm", { name: term.name })} action={() => archive(true)}>{null}</ActionButton>
      )}
    </div>
  );
}

function ProgramCard({ p, pageUndo }: { p: Program; pageUndo: ReturnType<typeof useUndo> }) {
  const { t } = useTranslation("admin");
  const set = useSetPrograms();
  const undo = useUndo();
  const [rolling, setRolling] = useState(false);
  const courses = p.terms.reduce((n, x) => n + x.courses, 0);
  const pattern = useAction(async (v: Pattern) => {
    const before = p;
    set.put({ ...p, pattern: v });
    try {
      set.put(await api.patch<Program>(`/api/programs/${p.id}`, { pattern: v }));
    } catch (e) {
      set.put(before);
      throw e;
    }
  });
  const archive = async (archived: boolean) => {
    await api.put(`/api/programs/${p.id}/archive`, { archived });
    set.edit(p.id, (x) => ({ ...x, archived }));
    if (archived) {
      pageUndo.offer(t("programs.archived", { name: p.name }), async () => {
        await api.put(`/api/programs/${p.id}/archive`, { archived: false });
        set.edit(p.id, (x) => ({ ...x, archived: false }));
      });
    }
  };
  const headId = `program-${p.id}`;
  return (
    <section className="unit" aria-labelledby={headId} style={{ opacity: p.archived ? 0.85 : 1 }}>
      <div className="unit-head" style={{ flexWrap: "wrap" }}>
        <span id={headId} className="grow" style={{ fontSize: "1.1rem", fontWeight: 650 }}>
          <InlineText value={p.name} label={t("programs.rename")} maxLength={150}
                      onSave={async (name) => set.put(await api.patch<Program>(`/api/programs/${p.id}`, { name }))} />
        </span>
        {p.archived && <span className="pill warn">{t("common:status.archived")}</span>}
        <span className="pill"><Icon name="users" style={{ inlineSize: 13, blockSize: 13 }} /> {t("programs.students", { n: p.students })}</span>
      </div>
      <div className="row" style={{ padding: "10px 16px", borderBlockEnd: "1px solid var(--line)" }}>
        <span className="small muted">{t("programs.pattern")}</span>
        <Segmented label={t("programs.pattern")} value={p.pattern} onChange={(v) => { if (v !== p.pattern) void pattern.run(v); }}
                   options={PATTERN_KEYS.map((k) => ({ value: k, label: t(`patterns.${k}`) }))} />
        <SaveStatus state={pattern.state} error={pattern.error} />
      </div>
      {p.terms.length === 0 && <p className="small muted" style={{ padding: "10px 16px" }}>{t("programs.noTerms")}</p>}
      {p.terms.map((x) => <TermRow key={x.id} term={x} p={p} undo={undo} />)}
      {!p.archived && <AddTerm p={p} onAdded={() => void set.refresh()} />}
      <div style={{ padding: "0 16px" }}><UndoBar undo={undo} /></div>
      {rolling && <RolloverPanel p={p} onClose={() => setRolling(false)} />}
      <div className="row between" style={{ padding: "12px 16px", borderBlockStart: "1px solid var(--line)" }}>
        <div className="row">
          {!p.archived && !rolling && (
            <Button size="small" icon="chevronRight" disabled={!p.students} title={!p.students ? t("rollover.nobody") : undefined} onClick={() => setRolling(true)}>
              {t("rollover.open")}
            </Button>
          )}
          {p.archived
            ? <ActionButton size="small" icon="undo" action={() => archive(false)}>{t("programs.restore")}</ActionButton>
            : <ActionButton size="small" variant="ghost" icon="archive" action={() => archive(true)}>{t("programs.archive")}</ActionButton>}
        </div>
        <span className="row tight">
          <span className="tiny muted">{t("programs.deleteHint", { courses, students: p.students })}</span>
          <ConfirmButton confirmLabel={t("programs.deleteConfirm", { name: p.name })}
                         action={async () => { await api.del(`/api/programs/${p.id}`); set.map((list) => list.filter((x) => x.id !== p.id)); }}>
            {t("programs.delete")}
          </ConfirmButton>
        </span>
      </div>
    </section>
  );
}

function NewProgram({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("admin");
  const set = useSetPrograms();
  const fe = useFieldError();
  const err = useErrorText();
  const [name, setName] = useState("");
  const [pattern, setPattern] = useState<Pattern>("semester");
  const [terms, setTerms] = useState<string>(String(PATTERNS.semester.def));
  const max = PATTERNS[pattern].max;
  const count = Number(terms);
  const valid = terms !== "" && Number.isInteger(count) && count >= 0 && count <= max;
  const create = useAction(() => api.post<Program>("/api/programs", { name: name.trim(), pattern, terms: count }), {
    onDone: (p) => { set.map((list) => [...list, p].sort((a, b) => a.name.localeCompare(b.name))); onClose(); },
  });
  const nameErr = fe(create.error, "name") ?? (create.error && String((create.error as { code?: string }).code).startsWith("program.name") ? err(create.error) : undefined);
  return (
    <form className="card stack fade-in" aria-labelledby="new-program" onSubmit={(e) => { e.preventDefault(); if (valid) void create.run(); }}>
      <div className="row between">
        <h2 id="new-program">{t("programs.new.title")}</h2>
        <Button variant="ghost" size="small" icon="x" aria-label={t("common:actions.close")} onClick={onClose} />
      </div>
      <div className="grid">
        <Field label={t("programs.new.name")} hint={t("programs.new.nameHint")} error={nameErr}>
          {(id, d) => <input id={id} aria-describedby={d} type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={150} autoFocus aria-invalid={!!nameErr || undefined} />}
        </Field>
        <Field label={t("programs.new.terms")} hint={t("programs.new.termsHint", { pattern, max })} error={terms !== "" && !valid ? t("programs.new.termsRange", { max }) : undefined}>
          {(id, d) => <input id={id} aria-describedby={d} type="number" min={0} max={max} value={terms} onChange={(e) => setTerms(e.target.value)} aria-invalid={(terms !== "" && !valid) || undefined} />}
        </Field>
      </div>
      <div className="stack tight">
        <span style={{ fontWeight: 560, fontSize: "0.9rem" }}>{t("programs.pattern")}</span>
        <Segmented label={t("programs.pattern")} value={pattern} onChange={(v) => { setPattern(v); setTerms(String(PATTERNS[v].def)); }}
                   options={PATTERN_KEYS.map((k) => ({ value: k, label: t(`patterns.${k}`) }))} />
      </div>
      <div className="row">
        <Button type="submit" variant="primary" icon="plus" busy={create.busy} disabled={!name.trim() || !valid}>{t("programs.new.create")}</Button>
        {create.state === "error" && !nameErr && <span className="status err" role="status">{err(create.error)}</span>}
      </div>
    </form>
  );
}

export default function Programs() {
  const { t } = useTranslation("admin");
  const q = usePrograms();
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const undo = useUndo();
  const list = (q.data ?? []).filter((p) => showArchived || !p.archived);
  const archivedCount = (q.data ?? []).filter((p) => p.archived).length;
  return (
    <div className="page">
      <PageHead title={t("programs.title")} sub={t("programs.sub")} actions={
        !adding && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>{t("programs.add")}</Button>
      } />
      <div className="stack">
        {adding && <NewProgram onClose={() => setAdding(false)} />}
        {q.isPending ? <PageLoading /> : q.isError ? <LoadError error={q.error} retry={() => void q.refetch()} /> : (
          <>
            {archivedCount > 0 && (
              <label className="check small" style={{ alignSelf: "flex-end" }}>
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                {t("programs.showArchived", { n: archivedCount })}
              </label>
            )}
            <UndoBar undo={undo} />
            {list.length === 0 && !adding ? (
              <Empty icon="layers" title={t("programs.emptyTitle")} action={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>{t("programs.add")}</Button>}>
                {t("programs.empty")}
              </Empty>
            ) : (
              <div>{list.map((p) => <ProgramCard key={p.id} p={p} pageUndo={undo} />)}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
