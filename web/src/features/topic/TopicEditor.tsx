import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { api } from "@/api/client";
import type { Topic, TopicVersion } from "@/api/types";
import { fmtRelative } from "@/i18n/format";
import { ActionButton, Button, Field, SaveStatus, Segmented, Switch, useAction, useAutosave } from "@/ui/controls";
import { Content, Crumbs } from "@/ui/display";
import { useErrorText } from "@/ui/errors";
import { Icon } from "@/ui/icons";

type Draft = Pick<Topic, "title" | "summary" | "content" | "content_format" | "question_pattern" | "answer_guide" | "sample_answer" | "published"> & { due_at: string };

const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

function Versions({ topicId, onRestored }: { topicId: number; onRestored: () => void }) {
  const { t } = useTranslation("topic");
  const q = useQuery({ queryKey: ["versions", topicId], queryFn: () => api.get<TopicVersion[]>(`/api/topics/${topicId}/versions`) });
  const [peek, setPeek] = useState<number | null>(null);
  const preview = useQuery({
    queryKey: ["version", topicId, peek],
    queryFn: () => api.get<Draft>(`/api/topics/${topicId}/versions/${peek}`),
    enabled: peek !== null,
  });
  const qc = useQueryClient();
  const restore = (vid: number) => async () => {
    await api.post(`/api/topics/${topicId}/versions/${vid}/restore`);
    await qc.invalidateQueries({ queryKey: ["versions", topicId] });
    setPeek(null);
    onRestored();
  };
  return (
    <div className="stack tight">
      {(q.data ?? []).map((v) => (
        <div key={v.id} className="stack tight" style={{ borderBlockEnd: "1px solid var(--line)", paddingBlock: 8 }}>
          <div className="row between">
            <span className="small">
              <strong>{fmtRelative(v.saved_at)}</strong> · {v.by || "—"} · <span className="muted">{t(`versions.note.${v.note.startsWith("copied") ? "copied" : v.note}`, { defaultValue: v.note })}</span>
            </span>
            {v.current ? <span className="pill accent">{t("versions.current")}</span> : (
              <span className="row tight">
                <Button size="small" variant="ghost" icon="eye" aria-expanded={peek === v.id} onClick={() => setPeek(peek === v.id ? null : v.id)}>{t("versions.peek")}</Button>
                <ActionButton size="small" icon="undo" action={restore(v.id)}>{t("versions.restore")}</ActionButton>
              </span>
            )}
          </div>
          {peek === v.id && preview.data && (
            <div className="card fade-in" style={{ maxBlockSize: 280, overflow: "auto", background: "var(--surface-2)" }}>
              <strong>{preview.data.title}</strong>
              <Content text={preview.data.content} format={preview.data.content_format} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function TopicEditor({ topic, onDone }: { topic: Topic; onDone: () => void }) {
  const { t } = useTranslation("topic");
  const qc = useQueryClient();
  const err = useErrorText();
  const initial: Draft = {
    title: topic.title, summary: topic.summary, content: topic.content, content_format: topic.content_format, question_pattern: topic.question_pattern,
    answer_guide: topic.answer_guide, sample_answer: topic.sample_answer, published: topic.published, due_at: toLocal(topic.due_at),
  };
  const [draft, setDraft] = useState<Draft>(initial);
  const [view, setView] = useState<"write" | "preview">("write");
  const [epoch, setEpoch] = useState(0); // bumps after a restore so the form reloads from the server
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const auto = useAutosave(draft, async (d) => {
    if (!d.title.trim()) throw Object.assign(new Error("title"), { code: "topic.title_required" });
    await api.patch(`/api/topics/${topic.id}`, { ...d, title: d.title.trim(), due_at: fromLocal(d.due_at) });
    void qc.invalidateQueries({ queryKey: ["versions", topic.id] });
  });

  const upload = useAction(async (f: File) => {
    const { url } = await api.upload<{ url: string }>("/api/uploads", f);
    const el = area.current;
    const snippet = draft.content_format === "html" ? `<img src="${url}" alt="">` : `![](${url})`;
    const at = el?.selectionStart ?? draft.content.length;
    set("content", draft.content.slice(0, at) + snippet + draft.content.slice(at));
  });

  const finish = async () => {
    await auto.retry();
    await qc.invalidateQueries({ queryKey: ["topic", topic.id] });
    void qc.invalidateQueries({ queryKey: ["course", topic.course_id] });
    onDone();
  };
  const reload = async () => {
    const fresh = await qc.fetchQuery({ queryKey: ["topic", topic.id], queryFn: () => api.get<Topic>(`/api/topics/${topic.id}`), staleTime: 0 });
    setDraft({
      title: fresh.title, summary: fresh.summary, content: fresh.content, content_format: fresh.content_format, question_pattern: fresh.question_pattern,
      answer_guide: fresh.answer_guide, sample_answer: fresh.sample_answer, published: fresh.published, due_at: toLocal(fresh.due_at),
    });
    setEpoch((n) => n + 1);
  };

  return (
    <div className="stack" key={epoch}>
      <header className="page-head" style={{ marginBlockEnd: 0 }}>
        <div className="titles stack tight">
          <Crumbs items={[{ to: `/courses/${topic.course_id}`, label: topic.course }, { label: topic.unit }, { label: t("editor.editing") }]} />
          <input type="text" value={draft.title} onChange={(e) => set("title", e.target.value)} aria-label={t("editor.title")} maxLength={200}
                 aria-invalid={!draft.title.trim() || undefined} style={{ fontSize: "1.5rem", fontWeight: 650, border: 0, paddingInline: 0, background: "transparent" }} />
        </div>
        <div className="row">
          {auto.state === "error" && (auto.error as { code?: string })?.code === "topic.title_required"
            ? <span className="status err">{t("editor.needsTitle")}</span>
            : <SaveStatus state={auto.dirty && auto.state === "idle" ? "busy" : auto.state} error={auto.error} onRetry={() => void auto.retry()} />}
          <Button variant="primary" icon="check" onClick={() => void finish()}>{t("editor.done")}</Button>
        </div>
      </header>

      <div className="topic-layout">
        <div className="stack">
          <Field label={t("editor.summary")} hint={t("editor.summaryHint")}>
            {(id, d) => <input id={id} type="text" value={draft.summary} onChange={(e) => set("summary", e.target.value)} maxLength={300} aria-describedby={d} />}
          </Field>

          <div className="card stack" style={{ padding: 0 }}>
            <div className="row between" style={{ padding: "10px 12px", borderBlockEnd: "1px solid var(--line)" }}>
              <Segmented label={t("editor.view")} value={view} onChange={setView} options={[{ value: "write", label: t("editor.write") }, { value: "preview", label: t("editor.preview") }]} />
              <div className="row tight">
                <Button size="small" variant="ghost" icon="image" busy={upload.busy} onClick={() => file.current?.click()}>{t("editor.image")}</Button>
                <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload.run(f); e.target.value = ""; }} />
                <select value={draft.content_format} onChange={(e) => set("content_format", e.target.value as Draft["content_format"])} aria-label={t("editor.format")}
                        style={{ inlineSize: "auto", minBlockSize: 30, paddingBlock: 2 }}>
                  <option value="markdown">Markdown</option>
                  <option value="html">HTML</option>
                </select>
              </div>
            </div>
            {upload.state === "error" && <div style={{ paddingInline: 12 }}><span className="status err">{err(upload.error)}</span></div>}
            {view === "write" ? (
              <textarea ref={area} value={draft.content} onChange={(e) => set("content", e.target.value)} aria-label={t("editor.content")}
                        placeholder={t("editor.contentPlaceholder")}
                        style={{ minBlockSize: 420, border: 0, borderRadius: 0, fontFamily: draft.content_format === "html" ? "var(--mono)" : "inherit", padding: 16 }} />
            ) : (
              <div className="reading" style={{ padding: 16, minBlockSize: 420 }}>
                {draft.content_format === "html"
                  ? <p className="small muted">{t("editor.htmlPreview")}</p>
                  : <Content text={draft.content || t("editor.nothing")} />}
              </div>
            )}
          </div>
          <p className="tiny muted">{draft.content_format === "markdown" ? t("editor.markdownHelp") : t("editor.htmlHelp")}</p>

          <details className="disclosure card" open={!!(draft.question_pattern || draft.answer_guide || draft.sample_answer)}>
            <summary>{t("exam.title")}</summary>
            <div className="stack" style={{ marginBlockStart: 12 }}>
              <Field label={t("exam.pattern")} hint={t("editor.patternHint")}>
                {(id) => <textarea id={id} rows={2} value={draft.question_pattern} onChange={(e) => set("question_pattern", e.target.value)} />}
              </Field>
              <Field label={t("exam.guide")} hint={t("editor.guideHint")}>
                {(id) => <textarea id={id} rows={3} value={draft.answer_guide} onChange={(e) => set("answer_guide", e.target.value)} />}
              </Field>
              <Field label={t("exam.sample")}>
                {(id) => <textarea id={id} rows={4} value={draft.sample_answer} onChange={(e) => set("sample_answer", e.target.value)} />}
              </Field>
            </div>
          </details>
        </div>

        <aside className="topic-side">
          <section className="card stack">
            {topic.course_kind === "catalog" && (
              <Switch checked={draft.published} onChange={(v) => set("published", v)} label={draft.published ? t("editor.published") : t("editor.draft")} />
            )}
            <Field label={t("editor.due")} hint={t("editor.dueHint")}>
              {(id) => (
                <div className="row tight nowrap">
                  <input id={id} type="datetime-local" value={draft.due_at} onChange={(e) => set("due_at", e.target.value)} />
                  {draft.due_at && <Button size="small" variant="ghost" icon="x" aria-label={t("editor.clearDue")} onClick={() => set("due_at", "")} />}
                </div>
              )}
            </Field>
            <Link to={`/topics/${topic.id}`} className="small" onClick={(e) => { e.preventDefault(); void finish(); }}>{t("editor.seeAsStudent")}</Link>
          </section>
          <details className="disclosure card">
            <summary><Icon name="history" /> {t("versions.title")}</summary>
            <div style={{ marginBlockStart: 8 }}>
              <p className="tiny muted" style={{ marginBlockEnd: 6 }}>{t("versions.hint")}</p>
              <Versions topicId={topic.id} onRestored={() => void reload()} />
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
