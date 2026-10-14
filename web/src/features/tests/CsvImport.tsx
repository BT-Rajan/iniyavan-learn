/** The CSV import panel of the test editor: paste or choose a file, check it, upload the pictures it names, then add the questions. */
import { type DragEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "@/api/client";
import type { CsvParse } from "@/api/types";
import { ActionButton, Button, SaveStatus, useAction } from "@/ui/controls";
import { Notice } from "@/ui/display";
import { useErrorText } from "@/ui/errors";
import { Icon } from "@/ui/icons";

import { IMAGE_TYPES, LETTERS, type QDraft, type TopicChoice, useIssueText } from "./parts";

const COLUMNS = ["question", "a", "b", "c", "correct", "explanation", "topic", "unit", "area", "question_image", "a_image"] as const;

function csvCell(v: string) {
  return /[",;\n\r\t]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** One small file someone can open in a spreadsheet, fill in, and bring back. */
function useSample() {
  const { t } = useTranslation("tests");
  return () => {
    const rows = [
      [...COLUMNS],
      [t("csv.sample.q1"), t("csv.sample.q1a"), t("csv.sample.q1b"), t("csv.sample.q1c"), "A", t("csv.sample.q1why"), t("csv.sample.q1topic"), "", "", "", ""],
      [t("csv.sample.q2"), t("csv.sample.q2a"), t("csv.sample.q2b"), "", "B", "", "", "", t("csv.sample.q2area"), "diagram.png", ""],
    ];
    const text = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "test-questions-sample.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}

function Format() {
  const { t } = useTranslation("tests");
  const sample = useSample();
  const cols: [string, string][] = [
    ["question", t("csv.col.question")],
    ["a, b", t("csv.col.ab")],
    ["c, d, e, f", t("csv.col.cf")],
    ["correct", t("csv.col.correct")],
    ["explanation", t("csv.col.explanation")],
    ["topic", t("csv.col.topic")],
    ["unit", t("csv.col.unit")],
    ["area", t("csv.col.area")],
    ["question_image, a_image … f_image", t("csv.col.images")],
  ];
  return (
    <details className="disclosure">
      <summary>{t("csv.formatTitle")}</summary>
      <div className="stack tight" style={{ marginBlockStart: 10 }}>
        <p className="small muted">{t("csv.formatIntro")}</p>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">{t("csv.column")}</th><th scope="col">{t("csv.meaning")}</th></tr></thead>
            <tbody>
              {cols.map(([c, d]) => (
                <tr key={c}><td><code className="small">{c}</code></td><td className="small">{d}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div><Button size="small" icon="download" onClick={sample}>{t("csv.sampleDownload")}</Button></div>
      </div>
    </details>
  );
}

type Parsed = CsvParse["questions"][number];

/** Files for the pictures the CSV names, matched by file name (one at a time, or several dropped at once). */
function ImagesNeeded({ names, urls, onUploaded }: { names: string[]; urls: Record<string, string>; onUploaded: (name: string, url: string) => void }) {
  const { t } = useTranslation("tests");
  const err = useErrorText();
  const many = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const byLower = new Map(names.map((n) => [n.toLowerCase(), n]));
  const upload = useAction(async (files: File[], forName?: string) => {
    const miss: string[] = [];
    for (const f of files) {
      const name = forName ?? byLower.get(f.name.toLowerCase());
      if (!name) { miss.push(f.name); continue; }
      const r = await api.upload<{ url: string }>("/api/uploads", f);
      onUploaded(name, r.url);
    }
    setUnmatched(miss);
  });
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void upload.run(Array.from(e.dataTransfer.files));
  };
  const left = names.filter((n) => !urls[n]).length;
  return (
    <section className="stack tight" aria-labelledby="csv-images-h">
      <div className="row between">
        <h4 id="csv-images-h">{t("csv.imagesTitle", { n: names.length })}</h4>
        <span className={`small ${left ? "muted" : "status ok"}`}>{left ? t("csv.imagesLeft", { n: left }) : t("csv.imagesAll")}</span>
      </div>
      <div className={`drop ${over ? "over" : ""}`} style={{ padding: 16 }} role="button" tabIndex={0}
           onClick={() => many.current?.click()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); many.current?.click(); } }}
           onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
        <Icon name="upload" /> {t("csv.imagesDrop")}
        <input ref={many} type="file" accept={IMAGE_TYPES} multiple hidden onChange={(e) => { void upload.run(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      </div>
      {upload.busy && <span className="status"><span className="spin" style={{ inlineSize: 12, blockSize: 12 }} aria-hidden /> {t("csv.uploading")}</span>}
      {upload.state === "error" && <span className="status err" role="status">{err(upload.error)}</span>}
      {unmatched.length > 0 && <span className="status warn" role="status">{t("csv.unmatched", { names: unmatched.join(", "), n: unmatched.length })}</span>}
      <ul className="stack tight" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {names.map((n) => (
          <li key={n} className="row tight">
            {urls[n]
              ? <img src={urls[n]} alt="" style={{ blockSize: 32, inlineSize: 32, objectFit: "cover", borderRadius: 4 }} />
              : <Icon name="image" style={{ color: "var(--faint)" }} />}
            <code className="small grow clip">{n}</code>
            {urls[n] ? <span className="pill good"><Icon name="check" style={{ inlineSize: 12, blockSize: 12 }} /> {t("csv.imageReady")}</span> : null}
            <label className="btn small ghost">
              <Icon name="upload" /> {urls[n] ? t("csv.imageReplace") : t("csv.imageChoose")}
              <input type="file" accept={IMAGE_TYPES} hidden aria-label={t("csv.imageFor", { name: n })}
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload.run([f], n); e.target.value = ""; }} />
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CsvImport({ courseId, unitId, topics, room, onApply, onClose }: {
  courseId: number; unitId: number | null; topics: TopicChoice[]; room: number;
  onApply: (questions: QDraft[], mode: "append" | "replace") => void; onClose: () => void;
}) {
  const { t } = useTranslation("tests");
  const issue = useIssueText();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<CsvParse | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const file = useRef<HTMLInputElement>(null);
  const check = useAction(async () => {
    const r = await api.post<CsvParse>(`/api/courses/${courseId}/tests/parse-csv`, { csv: text, unit_id: unitId });
    setResult(r);
  });
  const topicName = (id: number | null) => (id == null ? null : topics.find((x) => x.id === id)?.title ?? null);

  const pick = async (f: File) => {
    setFileName(f.name);
    setText(await f.text());
    setResult(null);
  };
  const ready = (result?.questions ?? []).map((q: Parsed): QDraft => ({
    text: q.text, image: q.image || (q.image_name ? urls[q.image_name] ?? "" : ""),
    options: q.options.map((o) => ({ text: o.text, image: o.image || (o.image_name ? urls[o.image_name] ?? "" : "") })),
    correct: q.correct ?? 0, explanation: q.explanation ?? "", topic_id: q.topic_id ?? null, area: q.area ?? "",
  }));
  const n = ready.length;
  const warnFor = (row: number) => (result?.warnings ?? []).filter((w) => w.row === row);

  return (
    <section className="card stack panel" aria-labelledby="csv-h">
      <div className="row between">
        <h3 id="csv-h">{t("csv.title")}</h3>
        <Button size="small" variant="ghost" icon="x" onClick={onClose}>{t("common:actions.close")}</Button>
      </div>
      <p className="small muted">{t("csv.intro")}</p>
      <Format />

      <div className="row">
        <Button icon="file" onClick={() => file.current?.click()}>{t("csv.choose")}</Button>
        <input ref={file} type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ""; }} />
        {fileName && <span className="small muted">{t("csv.chosen", { name: fileName })}</span>}
      </div>
      <label className="field">
        <span className="label">{t("csv.paste")}</span>
        <textarea rows={5} value={text} onChange={(e) => { setText(e.target.value); setFileName(""); setResult(null); }}
                  placeholder={COLUMNS.slice(0, 5).join(",")} style={{ fontFamily: "var(--mono)", fontSize: "0.85rem" }} />
      </label>
      <div className="row">
        <Button variant="primary" icon="check" busy={check.busy} disabled={!text.trim()} onClick={() => void check.run()}>{t("csv.check")}</Button>
        {check.state === "error" && <SaveStatus state="error" error={check.error} />}
      </div>

      {result && (
        <div className="stack fade-in">
          <div role="status" className="row">
            <span className="pill good">{t("csv.readyCount", { n })}</span>
            {result.error_count > 0 && <span className="pill bad">{t("csv.errorCount", { n: result.error_count })}</span>}
            {result.warnings.length > 0 && <span className="pill warn">{t("csv.warningCount", { n: result.warnings.length })}</span>}
          </div>

          {result.errors.length > 0 && (
            <Notice tone="bad" icon="flag" title={t("csv.skippedTitle", { n: result.error_count })}>
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {result.errors.map((e, i) => (
                  <li key={i}>{t("csv.rowIssue", { row: e.row, message: issue(e.code, e.params, e.row - 1) })}</li>
                ))}
              </ul>
            </Notice>
          )}

          {n > 0 && (
            <div className="table-wrap" style={{ maxBlockSize: 420, overflowY: "auto" }}>
              <table className="table">
                <caption className="sr-only">{t("csv.previewCaption")}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="num">{t("csv.row")}</th>
                    <th scope="col">{t("csv.question")}</th>
                    <th scope="col">{t("csv.choices")}</th>
                    <th scope="col">{t("csv.topicArea")}</th>
                    <th scope="col">{t("csv.notes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.questions.map((q, i) => {
                    const missing = [q.image_name, ...q.options.map((o) => o.image_name)].filter((x) => x && !urls[x]);
                    return (
                      <tr key={q.row}>
                        <td className="num small muted">{q.row}</td>
                        <td style={{ minInlineSize: 200 }}>
                          {q.text || <span className="faint">{t("csv.imageOnly")}</span>}
                          {ready[i].image && <img src={ready[i].image} alt="" style={{ display: "block", maxBlockSize: 48, marginBlockStart: 4 }} />}
                        </td>
                        <td style={{ minInlineSize: 180 }}>
                          <ol style={{ margin: 0, paddingInlineStart: 0, listStyle: "none" }} className="small">
                            {q.options.map((o, j) => (
                              <li key={j} style={j === q.correct ? { color: "var(--good)", fontWeight: 600 } : undefined}>
                                {LETTERS[j]}. {o.text || o.image_name || "—"}
                                {j === q.correct && <> <Icon name="check" style={{ inlineSize: 12, blockSize: 12 }} /><span className="sr-only"> {t("results.correct")}</span></>}
                              </li>
                            ))}
                          </ol>
                        </td>
                        <td className="small">{topicName(q.topic_id ?? null) ?? (q.area || <span className="faint">—</span>)}</td>
                        <td className="small">
                          {warnFor(q.row).map((w, k) => <div key={k} className="status warn">{issue(w.code, w.params, q.row - 1)}</div>)}
                          {missing.length > 0 && <div className="status warn">{t("csv.missingImages", { n: missing.length })}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {result.images_needed.length > 0 && (
            <ImagesNeeded names={result.images_needed} urls={urls} onUploaded={(name, url) => setUrls((u) => ({ ...u, [name]: url }))} />
          )}

          {n > 0 && (
            <div className="row">
              <ActionButton variant="primary" icon="plus" disabled={n > room} action={async () => { onApply(ready, "append"); }}>{t("csv.append", { n })}</ActionButton>
              <ActionButton icon="refresh" action={async () => { onApply(ready, "replace"); }}>{t("csv.replace", { n })}</ActionButton>
              {n > room && <span className="status warn">{t("csv.noRoom", { n: room })}</span>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
