import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api, ApiError } from "@/api/client";
import type { OutlineDraftTopic, OutlineDraftUnit, StudioState } from "@/api/types";
import { fmtNumber } from "@/i18n/format";
import { ActionButton, Button, Field, InlineText, SaveStatus, useAction, useAutosave, UndoBar, useUndo } from "@/ui/controls";
import { Crumbs, LoadError, Notice, PageLoading } from "@/ui/display";
import { useErrorText } from "@/ui/errors";
import { Icon } from "@/ui/icons";

type Units = OutlineDraftUnit[];
const key = (id: number) => ["studio", id] as const;
const strip = (units: Units): Units => units.map((u) => ({ title: u.title, topics: u.topics.map(({ title, summary, start, end }) => ({ title, summary, start, end })) }));

// ---------- outline edits (pure) ----------
function flatIndex(units: Units, ui: number, ti: number) {
  return units.slice(0, ui).reduce((n, u) => n + u.topics.length, 0) + ti;
}
function mergeNext(units: Units, ui: number, ti: number): Units {
  const out = structuredClone(units);
  const u = out[ui];
  const t = u.topics[ti];
  if (ti + 1 < u.topics.length) {
    const n = u.topics[ti + 1];
    if (n.start !== t.end + 1) return units;
    t.end = n.end;
    u.topics.splice(ti + 1, 1);
  } else if (ui + 1 < out.length) {
    const n = out[ui + 1].topics[0];
    if (!n || n.start !== t.end + 1) return units;
    t.end = n.end;
    out[ui + 1].topics.shift();
    if (!out[ui + 1].topics.length) out.splice(ui + 1, 1);
  }
  return out;
}
function splitAt(units: Units, ui: number, ti: number, at: number, title: string): Units {
  const out = structuredClone(units);
  const t = out[ui].topics[ti];
  if (at <= t.start || at > t.end) return units;
  out[ui].topics.splice(ti + 1, 0, { title, summary: "", start: at, end: t.end });
  t.end = at - 1;
  return out;
}
function removeTopic(units: Units, ui: number, ti: number): Units {
  const out = structuredClone(units);
  out[ui].topics.splice(ti, 1);
  return out.filter((u) => u.topics.length);
}
function newUnitFrom(units: Units, ui: number, ti: number, title: string): Units {
  const out = structuredClone(units);
  const moved = out[ui].topics.splice(ti);
  out.splice(ui + 1, 0, { title, topics: moved });
  return out.filter((u) => u.topics.length);
}
function mergeUnitUp(units: Units, ui: number): Units {
  const out = structuredClone(units);
  out[ui - 1].topics.push(...out[ui].topics);
  out.splice(ui, 1);
  return out;
}

// ---------- material ----------
interface Upload { name: string; state: "busy" | "done" | "error"; paragraphs?: number; error?: unknown }

function Material({ s, onChanged }: { s: StudioState; onChanged: () => void }) {
  const { t } = useTranslation("studio");
  const err = useErrorText();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [over, setOver] = useState(false);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const send = async (files: File[]) => {
    for (const f of files) {
      setUploads((u) => [...u, { name: f.name, state: "busy" }]);
      const set = (patch: Partial<Upload>) => setUploads((u) => u.map((x) => (x.name === f.name && x.state === "busy" ? { ...x, ...patch } : x)));
      try {
        if (f.size > 20 * 1024 * 1024) throw new ApiError(413, "upload.too_large", { max_mb: 20 });
        const r = await api.upload<{ paragraphs: number }>(`/api/studio/${s.course_id}/files?name=${encodeURIComponent(f.name)}`, f);
        set({ state: "done", paragraphs: r.paragraphs });
        onChanged();
      } catch (e) {
        set({ state: "error", error: e });
      }
    }
  };
  const addText = useAction(async () => {
    await api.post(`/api/studio/${s.course_id}/text`, { text, name: "" });
    setText("");
    onChanged();
  });
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void send(Array.from(e.dataTransfer.files));
  };

  return (
    <div className="stack">
      {s.sources.length > 0 && (
        <ul className="stack tight" style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label={t("material.sources")}>
          {s.sources.map((src, i) => (
            <li key={i} className="row between card" style={{ padding: "10px 14px" }}>
              <span className="row tight grow" style={{ minInlineSize: 0 }}>
                <Icon name="file" style={{ color: "var(--accent)" }} />
                <span className="clip">{src.name === "material" ? t("material.pasted") : src.name}</span>
                <span className="small muted nowrap">{t("material.size", { paragraphs: src.paragraphs, words: fmtNumber(src.words) })}</span>
              </span>
              <ActionButton size="small" variant="ghost" icon="trash" title={t("material.remove")} action={async () => { await api.del(`/api/studio/${s.course_id}/sources/${i}`); onChanged(); }}>
                {null}
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
      <div
        className={`drop ${over ? "over" : ""}`} role="button" tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
      >
        <Icon name="upload" style={{ inlineSize: 28, blockSize: 28 }} />
        <p><strong>{t("material.drop")}</strong></p>
        <p className="small">{t("material.types")}</p>
        <input ref={input} type="file" multiple hidden accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
               onChange={(e) => { void send(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      </div>
      {uploads.length > 0 && (
        <ul className="stack tight" style={{ listStyle: "none", padding: 0, margin: 0 }} aria-live="polite">
          {uploads.map((u, i) => (
            <li key={i} className="row tight small">
              {u.state === "busy" && <span className="spin" style={{ inlineSize: 12, blockSize: 12 }} />}
              {u.state === "done" && <Icon name="check" style={{ color: "var(--good)" }} />}
              {u.state === "error" && <Icon name="x" style={{ color: "var(--bad)" }} />}
              <span className="clip">{u.name}</span>
              <span className={u.state === "error" ? "status err" : "muted"}>
                {u.state === "busy" ? t("material.reading") : u.state === "done" ? t("material.added", { n: u.paragraphs ?? 0 }) : err(u.error)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <details className="disclosure" open={!s.sources.length}>
        <summary>{t("material.paste")}</summary>
        <div className="stack tight" style={{ marginBlockStart: 10 }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} aria-label={t("material.paste")} placeholder={t("material.pastePlaceholder")} />
          <div className="row">
            <Button busy={addText.busy} disabled={!text.trim()} icon="plus" onClick={() => void addText.run()}>{t("material.addText")}</Button>
            {addText.state === "error" && <span className="status err">{err(addText.error)}</span>}
          </div>
        </div>
      </details>
    </div>
  );
}

// ---------- splitting a topic at a paragraph ----------
function SplitPicker({ courseId, topic, onSplit, onClose }: { courseId: number; topic: OutlineDraftTopic; onSplit: (at: number) => void; onClose: () => void }) {
  const { t } = useTranslation("studio");
  const q = useQuery({
    queryKey: ["paras", courseId, topic.start, topic.end],
    queryFn: () => api.get<{ paragraphs: string[] }>(`/api/studio/${courseId}/paragraphs?start=${topic.start}&end=${topic.end}`),
  });
  return (
    <div className="card fade-in stack tight" style={{ background: "var(--surface-2)", marginBlock: 6 }}>
      <div className="row between">
        <span className="small"><strong>{t("outline.splitTitle")}</strong> {t("outline.splitHint")}</span>
        <Button size="small" variant="ghost" icon="x" aria-label={t("common:actions.close")} onClick={onClose} />
      </div>
      {q.isPending && <span className="small muted">{t("common:status.loading")}</span>}
      {q.data?.paragraphs.map((p, k) => (
        <div key={k} className="stack tight">
          {k > 0 && (
            <button type="button" className="btn small ghost" style={{ alignSelf: "center", borderStyle: "dashed", borderColor: "var(--accent)" }} onClick={() => onSplit(topic.start + k)}>
              <Icon name="scissors" /> {t("outline.splitHere")}
            </button>
          )}
          <p className="small" style={{ whiteSpace: "pre-wrap", maxBlockSize: 120, overflow: "hidden" }}>{p}</p>
        </div>
      ))}
    </div>
  );
}

// ---------- the outline ----------
function OutlineEditor({ s, units, setUnits }: { s: StudioState; units: Units; setUnits: (u: Units) => void }) {
  const { t } = useTranslation("studio");
  const undo = useUndo();
  const [splitting, setSplitting] = useState<string | null>(null);
  const info = useMemo(() => {
    const m = new Map<string, { words?: number; excerpt?: string }>();
    for (const u of s.outline?.units ?? []) for (const x of u.topics) m.set(`${x.start}-${x.end}`, { words: x.words, excerpt: x.excerpt });
    return m;
  }, [s.outline]);
  const change = (next: Units, message?: string) => {
    const before = units;
    setUnits(next);
    if (message) undo.offer(message, async () => setUnits(before));
  };
  const setTopic = (ui: number, ti: number, patch: Partial<OutlineDraftTopic>) =>
    setUnits(units.map((u, a) => (a !== ui ? u : { ...u, topics: u.topics.map((x, b) => (b === ti ? { ...x, ...patch } : x)) })));
  const total = units.reduce((n, u) => n + u.topics.length, 0);

  return (
    <div className="stack">
      <UndoBar undo={undo} />
      {units.map((u, ui) => (
        <section key={ui} className="unit">
          <div className="unit-head">
            <span className="pill">{t("outline.unitN", { n: ui + 1 })}</span>
            <InlineText as="h2" value={u.title} placeholder={t("outline.unitPlaceholder")} label={t("outline.unitName")}
                        onSave={async (title) => setUnits(units.map((x, a) => (a === ui ? { ...x, title } : x)))} />
            {ui > 0 && (
              <Button size="small" variant="ghost" icon="merge" title={t("outline.mergeUnit")} onClick={() => change(mergeUnitUp(units, ui), t("outline.unitsMerged"))}>
                <span className="sr-only">{t("outline.mergeUnit")}</span>
              </Button>
            )}
          </div>
          {u.topics.map((x, ti) => {
            const id = `${ui}-${ti}`;
            const meta = info.get(`${x.start}-${x.end}`);
            const lastOverall = flatIndex(units, ui, ti) === total - 1;
            return (
              <div key={`${x.start}`} className="topic-row" style={{ alignItems: "flex-start", flexDirection: "column", gap: 6 }}>
                <div className="row nowrap" style={{ inlineSize: "100%", alignItems: "flex-start" }}>
                  <span className="state" aria-hidden>{flatIndex(units, ui, ti) + 1}</span>
                  <div className="grow stack" style={{ gap: 2 }}>
                    <InlineText value={x.title} placeholder={t("outline.topicPlaceholder")} label={t("outline.topicName")} className="title"
                                onSave={async (title) => setTopic(ui, ti, { title })} />
                    <InlineText value={x.summary} placeholder={t("outline.summaryPlaceholder")} label={t("outline.summary")} className="small muted" maxLength={300}
                                onSave={async (summary) => setTopic(ui, ti, { summary })} />
                    {meta?.excerpt && <span className="tiny faint" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{meta.excerpt}</span>}
                  </div>
                  <span className="tiny muted nowrap num">
                    {meta?.words != null ? t("outline.words", { n: meta.words }) : t("outline.paras", { n: x.end - x.start + 1 })}
                  </span>
                </div>
                <div className="row tight" style={{ paddingInlineStart: 38 }}>
                  {x.end > x.start && (
                    <Button size="small" variant="ghost" icon="scissors" aria-expanded={splitting === id} onClick={() => setSplitting(splitting === id ? null : id)}>{t("outline.split")}</Button>
                  )}
                  {!lastOverall && (
                    <Button size="small" variant="ghost" icon="merge" onClick={() => change(mergeNext(units, ui, ti), t("outline.merged"))}>{t("outline.mergeNext")}</Button>
                  )}
                  {ti > 0 && (
                    <Button size="small" variant="ghost" icon="layers" onClick={() => change(newUnitFrom(units, ui, ti, ""))}>{t("outline.newUnit")}</Button>
                  )}
                  {total > 1 && (
                    <Button size="small" variant="ghost" icon="trash" onClick={() => change(removeTopic(units, ui, ti), t("outline.removed", { title: x.title || t("outline.topicPlaceholder") }))}>
                      {t("outline.remove")}
                    </Button>
                  )}
                </div>
                {splitting === id && (
                  <div style={{ inlineSize: "100%" }}>
                    <SplitPicker courseId={s.course_id} topic={x} onClose={() => setSplitting(null)}
                                 onSplit={(at) => { setSplitting(null); change(splitAt(units, ui, ti, at, t("outline.newTopic"))); }} />
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

// ---------- the page ----------
export default function Studio() {
  const { t } = useTranslation("studio");
  const id = Number(useParams().courseId);
  const qc = useQueryClient();
  const nav = useNavigate();
  const err = useErrorText();
  const q = useQuery({ queryKey: key(id), queryFn: () => api.get<StudioState>(`/api/studio/${id}`) });
  const [units, setUnits] = useState<Units | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [replaceAsk, setReplaceAsk] = useState(false);
  const loadedOutline = useRef<string>("");

  // Take the server's outline whenever it is a new one (after slicing or changing material).
  useEffect(() => {
    const o = q.data?.outline;
    const sig = JSON.stringify(o ? strip(o.units) : null);
    if (sig !== loadedOutline.current) {
      loadedOutline.current = sig;
      setUnits(o ? strip(o.units) : null);
    }
    if (notes === null && q.data) setNotes(q.data.notes ?? "");
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useAutosave(units, async (u) => {
    if (!u) return;
    const r = await api.put<Omit<StudioState, "course_id" | "title" | "kind" | "status" | "ai">>(`/api/studio/${id}/outline`, { units: u });
    loadedOutline.current = JSON.stringify(r.outline ? strip(r.outline.units) : null);
    qc.setQueryData<StudioState>(key(id), (s) => (s ? { ...s, ...r } : s));
  }, { enabled: units !== null });

  const refresh = () => qc.invalidateQueries({ queryKey: key(id) });
  const slice = useAction(async (method: "ai" | "headings") => {
    const r = await api.post<Partial<StudioState>>(`/api/studio/${id}/slice`, { method, notes: notes ?? "" });
    qc.setQueryData<StudioState>(key(id), (s) => (s ? { ...s, ...r } : s));
  });
  const apply = async (replace: boolean) => {
    await save.retry();
    try {
      await api.post(`/api/studio/${id}/apply`, { replace });
    } catch (e) {
      if (e instanceof ApiError && e.code === "studio.would_replace") { setReplaceAsk(true); return; }
      throw e;
    }
    await qc.invalidateQueries({ queryKey: ["course", id] });
    void qc.invalidateQueries({ queryKey: ["browse"] });
    void qc.invalidateQueries({ queryKey: ["home"] });
    nav(`/courses/${id}`);
  };

  if (q.isPending) return <div className="page"><PageLoading /></div>;
  if (q.isError) return <div className="page"><LoadError error={q.error} retry={() => void q.refetch()} /></div>;
  const s = q.data;
  const hasMaterial = s.paragraphs > 0;
  const topics = units?.reduce((n, u) => n + u.topics.length, 0) ?? 0;
  const step = !hasMaterial ? 1 : !units ? 2 : 3;
  const aiOk = s.ai.available;

  return (
    <div className="page" style={{ maxInlineSize: 920 }}>
      <header className="page-head">
        <div className="titles stack tight">
          <Crumbs items={[{ to: "/courses", label: t("crumb") }, { label: s.title }]} />
          <h1>{s.status === "setup" ? t("title.new", { title: s.title }) : t("title.rebuild", { title: s.title })}</h1>
          <p className="muted">{t("sub")}</p>
        </div>
      </header>
      <ol className="steps" aria-label={t("steps.label")} style={{ listStyle: "none", padding: 0, marginBlockEnd: 24 }}>
        {(["material", "split", "review"] as const).map((k, i) => (
          <li key={k} className={`step ${step === i + 1 ? "current" : step > i + 1 ? "done" : ""}`} aria-current={step === i + 1 ? "step" : undefined}>{t(`steps.${k}`)}</li>
        ))}
      </ol>

      <div className="stack loose">
        <section className="stack" aria-labelledby="m-title">
          <div className="stack tight">
            <h2 id="m-title">{t("material.title")}</h2>
            <p className="small muted">{hasMaterial ? t("material.have", { words: fmtNumber(s.words), paragraphs: s.paragraphs }) : t("material.hint")}</p>
          </div>
          <Material s={s} onChanged={() => void refresh()} />
        </section>

        {hasMaterial && (
          <section className="card stack fade-in" aria-labelledby="s-title">
            <div className="stack tight">
              <h2 id="s-title">{units ? t("split.again") : t("split.title")}</h2>
              <p className="small muted">{t("split.hint")}</p>
            </div>
            <Field label={t("split.notes")} hint={t("split.notesHint")}>
              {(fid, d) => <textarea id={fid} rows={2} value={notes ?? ""} onChange={(e) => setNotes(e.target.value)} maxLength={4000} aria-describedby={d} placeholder={t("split.notesPlaceholder")} />}
            </Field>
            <div className="row">
              <Button variant="primary" icon="sparkle" busy={slice.busy} disabled={!aiOk} onClick={() => void slice.run("ai")}>{t("split.ai")}</Button>
              <Button icon="layers" disabled={slice.busy} onClick={() => void slice.run("headings")}>{t("split.headings")}</Button>
            </div>
            {!aiOk && (
              <p className="small muted">{s.ai.needs_own_key ? <>{t("split.needKey")} <Link to="/profile">{t("split.addKey")}</Link></> : t("split.noAi")}</p>
            )}
            {slice.busy && <p className="status" role="status"><span className="spin" style={{ inlineSize: 12, blockSize: 12 }} /> {t("split.working")}</p>}
            {slice.state === "error" && <span className="status err">{err(slice.error)}</span>}
            {units && <p className="tiny muted">{t("split.replaces")}</p>}
          </section>
        )}

        {units && (
          <section className="stack fade-in" aria-labelledby="o-title">
            <div className="row between">
              <div className="stack tight">
                <h2 id="o-title">{t("outline.title")}</h2>
                <p className="small muted">{t("outline.summaryLine", { units: units.length, topics })} · {s.sliced_by === "ai" ? t("outline.byAi") : t("outline.byHeadings")}</p>
              </div>
              <SaveStatus state={save.state} error={save.error} onRetry={() => void save.retry()} />
            </div>
            <p className="small muted">{t("outline.hint")}</p>
            <OutlineEditor s={s} units={units} setUnits={setUnits} />
          </section>
        )}

        {units && (
          <section className="card stack" style={{ position: "sticky", insetBlockEnd: 12, boxShadow: "var(--shadow)" }} aria-label={t("create.label")}>
            {replaceAsk ? (
              <Notice tone="warn" icon="refresh" title={t("create.replaceTitle")} action={
                <span className="row tight">
                  <ActionButton variant="danger" className="solid" action={() => apply(true)}>{t("create.replace")}</ActionButton>
                  <Button variant="ghost" onClick={() => setReplaceAsk(false)}>{t("common:actions.cancel")}</Button>
                </span>
              }>{t("create.replaceBody")}</Notice>
            ) : (
              <div className="row between">
                <span className="small muted grow">{s.kind === "catalog" ? t("create.drafts") : t("create.ready")}</span>
                <ActionButton variant="primary" size="lg" icon="check" action={() => apply(false)}>{t("create.go", { n: topics })}</ActionButton>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
