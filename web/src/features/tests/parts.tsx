/**
 * Pieces shared by the test screens (editor, results, gradebook, course tests, question bank).
 * Kept here rather than in src/ui because only these screens use them.
 */
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "@/api/client";
import type { AreaStatus, Option, OutlineUnit } from "@/api/types";
import { fmtPercent } from "@/i18n/format";
import { Button, useAction } from "@/ui/controls";
import { useErrorText } from "@/ui/errors";
import { Icon } from "@/ui/icons";

export const LETTERS = "ABCDEF";
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;
export const IMAGE_TYPES = "image/png,image/jpeg,image/gif,image/webp";

/** The same thresholds the server uses for strengths (assessment/service.py STRONG / WEAK). */
export function statusOf(percent: number): AreaStatus {
  return percent >= 80 ? "strong" : percent < 60 ? "needs_study" : "getting_there";
}

export function scoreTone(score: number | null | undefined, pass: number): "good" | "bad" | "" {
  if (score == null) return "";
  return score >= pass ? "good" : "bad";
}

/** A score as a coloured pill; the words (not only the colour) say whether it passed. */
export function ScorePill({ score, pass }: { score: number | null | undefined; pass: number }) {
  const { t } = useTranslation("tests");
  if (score == null) return <span className="faint" aria-label={t("score.none")}>—</span>;
  const ok = score >= pass;
  return (
    <span className={`pill ${ok ? "good" : "bad"} num`} title={ok ? t("score.passed") : t("score.below")}>
      {fmtPercent(score)}
      <span className="sr-only">{ok ? t("score.passed") : t("score.below")}</span>
    </span>
  );
}

/** Words for a row-level code from the server (CSV preview), with the question number filled in. */
export function useIssueText() {
  const { t, i18n } = useTranslation("errors");
  return (code: string, params: Record<string, unknown> = {}, number?: number) => {
    const p = { number, ...params } as unknown as Record<string, string>;
    return i18n.exists(`errors:${code}`) ? t(code, p) : t("validation.invalid");
  };
}

export function unitTitle(units: OutlineUnit[], id: number | null) {
  return id == null ? null : units.find((u) => u.id === id)?.title ?? null;
}

/** An optional picture: a thumbnail with a remove button, or a button that uploads one. */
export function ImageField({ url, onChange, label, compact }: { url: string; onChange: (url: string) => void; label: string; compact?: boolean }) {
  const { t } = useTranslation("tests");
  const err = useErrorText();
  const file = useRef<HTMLInputElement>(null);
  const up = useAction(async (f: File) => {
    const r = await api.upload<{ url: string }>("/api/uploads", f);
    onChange(r.url);
  });
  return (
    <span className="row tight" style={{ alignItems: "center" }}>
      {url ? (
        <span className="row tight">
          <img src={url} alt={label} style={{ maxBlockSize: compact ? 44 : 96, maxInlineSize: compact ? 80 : 200, borderRadius: 6, border: "1px solid var(--line)" }} />
          <Button size="small" variant="ghost" icon="x" aria-label={t("image.remove", { what: label })} title={t("image.remove", { what: label })} onClick={() => onChange("")} />
        </span>
      ) : (
        <Button size="small" variant="ghost" icon="image" busy={up.busy} aria-label={t("image.add", { what: label })} title={t("image.add", { what: label })}
                onClick={() => file.current?.click()}>
          {compact ? null : t("image.button")}
        </Button>
      )}
      <input ref={file} type="file" accept={IMAGE_TYPES} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void up.run(f); e.target.value = ""; }} />
      {up.state === "error" && <span className="status err" role="status">{err(up.error)}</span>}
    </span>
  );
}

/** One multiple-choice question as it is being written. */
export interface QDraft {
  id?: number | null; // a saved question keeps its id, so students' past attempts stay linked to it
  text: string; image: string; options: Option[]; correct: number; explanation: string; topic_id: number | null; area: string;
}

export const blankQuestion = (): QDraft => ({
  text: "", image: "", options: [0, 1, 2, 3].map(() => ({ text: "", image: "" })), correct: 0, explanation: "", topic_id: null, area: "",
});

const filled = (o: Option) => !!(o.text.trim() || o.image);

/** What is sent: empty choices are left out (so a question can start with four blanks), and the answer follows its choice. */
export function toPayload(q: QDraft) {
  const keep = q.options.map((o, i) => ({ o, i })).filter(({ o }) => filled(o));
  return {
    id: q.id ?? null, text: q.text.trim(), image: q.image, options: keep.map(({ o }) => ({ text: o.text.trim(), image: o.image })),
    correct: keep.findIndex(({ i }) => i === q.correct), explanation: q.explanation.trim(), topic_id: q.topic_id, area: q.area.trim(),
  };
}

/** The first thing that stops this question being saved, as an error code the errors namespace knows. */
export function problemOf(q: QDraft): string | null {
  const p = toPayload(q);
  if (!p.text && !p.image) return "question.text_required";
  const texts = p.options.filter((o) => !o.image).map((o) => o.text.toLowerCase());
  if (p.options.length < MIN_OPTIONS || p.options.length > MAX_OPTIONS || new Set(texts).size !== texts.length) return "question.options_invalid";
  if (p.correct < 0) return "question.correct_required";
  return null;
}

export interface TopicChoice { id: number; title: string; unit: string }

/** The fields of one question. Used by the test editor (with images and topics) and the question bank (text only). */
export function QuestionFields({
  value, onChange, number, topics, images = true, head, problem,
}: {
  value: QDraft; onChange: (q: QDraft) => void; number: number; topics?: TopicChoice[]; images?: boolean; head?: ReactNode; problem?: string | null;
}) {
  const { t } = useTranslation("tests");
  const id = useId();
  const set = (change: Partial<QDraft>) => onChange({ ...value, ...change });
  const setOption = (i: number, change: Partial<Option>) => set({ options: value.options.map((o, j) => (j === i ? { ...o, ...change } : o)) });
  const removeOption = (i: number) => set({
    options: value.options.filter((_, j) => j !== i),
    correct: i === value.correct ? -1 : i < value.correct ? value.correct - 1 : value.correct,
  });
  const units = topics ? Array.from(new Set(topics.map((x) => x.unit))) : [];

  return (
    <div className="stack tight">
      {head}
      <label className="field">
        <span className="label">{t("question.text", { n: number })}</span>
        <textarea id={`${id}-text`} rows={2} value={value.text} maxLength={5000} placeholder={t("question.textPlaceholder")}
                  aria-invalid={problem === "question.text_required" || undefined} onChange={(e) => set({ text: e.target.value })} style={{ minBlockSize: 60 }} />
      </label>
      {images && <ImageField url={value.image} onChange={(image) => set({ image })} label={t("image.ofQuestion", { n: number })} />}

      <fieldset className="stack tight" style={{ border: 0, padding: 0, margin: 0 }} aria-invalid={problem === "question.options_invalid" || problem === "question.correct_required" || undefined}>
        <legend className="label small" style={{ fontWeight: 560, marginBlockEnd: 6 }}>{t("question.choices")}</legend>
        {value.options.map((o, i) => (
          <div key={i} className="row tight nowrap" style={{ alignItems: "center" }}>
            <input type="radio" name={`${id}-correct`} checked={value.correct === i} onChange={() => set({ correct: i })}
                   aria-label={t("question.markCorrect", { letter: LETTERS[i] })} title={t("question.markCorrect", { letter: LETTERS[i] })} />
            <span className="pill num" aria-hidden style={value.correct === i ? { background: "var(--good-soft)", color: "var(--good)" } : undefined}>{LETTERS[i]}</span>
            <input type="text" value={o.text} maxLength={2000} aria-label={t("question.choice", { letter: LETTERS[i] })}
                   placeholder={t("question.choicePlaceholder", { letter: LETTERS[i] })} onChange={(e) => setOption(i, { text: e.target.value })} />
            {images && <ImageField compact url={o.image} onChange={(image) => setOption(i, { image })} label={t("image.ofChoice", { letter: LETTERS[i] })} />}
            {value.options.length > MIN_OPTIONS && (
              <Button size="small" variant="ghost" icon="x" aria-label={t("question.removeChoice", { letter: LETTERS[i] })} title={t("question.removeChoice", { letter: LETTERS[i] })}
                      onClick={() => removeOption(i)} />
            )}
          </div>
        ))}
        <div className="row between">
          {value.options.length < MAX_OPTIONS ? (
            <Button size="small" variant="ghost" icon="plus" onClick={() => set({ options: [...value.options, { text: "", image: "" }] })}>{t("question.addChoice")}</Button>
          ) : <span />}
          <span className="tiny muted">{t("question.choicesHint")}</span>
        </div>
      </fieldset>

      <label className="field">
        <span className="label">{t("question.explanation")}</span>
        <textarea rows={2} value={value.explanation} maxLength={5000} placeholder={t("question.explanationPlaceholder")}
                  onChange={(e) => set({ explanation: e.target.value })} style={{ minBlockSize: 56 }} />
      </label>

      {topics && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 220px), 1fr))" }}>
          <label className="field">
            <span className="label">{t("question.topic")}</span>
            <select value={value.topic_id ?? ""} onChange={(e) => set({ topic_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{t("question.noTopic")}</option>
              {units.map((u) => (
                <optgroup key={u} label={u}>
                  {topics.filter((x) => x.unit === u).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">{t("question.area")}</span>
            <input type="text" value={value.area} maxLength={150} placeholder={t("question.areaPlaceholder")} onChange={(e) => set({ area: e.target.value })} />
          </label>
        </div>
      )}
    </div>
  );
}

/** A small "n of total" horizontal bar with the number beside it. */
export function CountBar({ n, of, tone, label }: { n: number; of: number; tone?: "good" | "warn" | "bad"; label: string }) {
  const pct = of ? (100 * n) / of : 0;
  return (
    <span className="row tight nowrap" style={{ minInlineSize: 120 }}>
      <span className={`bar ${tone ?? ""}`} style={{ flex: 1, minInlineSize: 60 }} role="img" aria-label={label}>
        <span style={{ inlineSize: `${pct}%` }} />
      </span>
      <span className="small num muted" aria-hidden style={{ minInlineSize: 24, textAlign: "end" }}>{n}</span>
    </span>
  );
}

export function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card stack tight" style={{ padding: 14 }}>
      <span className="small muted">{label}</span>
      <strong className="num" style={{ fontSize: "1.5rem", lineHeight: 1.1 }}>{value}</strong>
      {sub && <span className="tiny muted">{sub}</span>}
    </div>
  );
}

export function CsvLink({ href, label }: { href: string; label?: string }) {
  const { t } = useTranslation();
  return (
    <a className="btn small" href={href} download>
      <Icon name="download" /> {label ?? t("actions.downloadCsv")}
    </a>
  );
}

/** A question in the shared bank (assessment/bank.py row()). */
export interface BankItem {
  id: number; text: string; options: Option[]; correct: number; explanation: string; tags: string[]; uses: number; owner: string; can_edit: boolean;
}
export interface BankPage { total: number; items: BankItem[]; tags: string[] }

/** A value that follows another one after a pause (search boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}
