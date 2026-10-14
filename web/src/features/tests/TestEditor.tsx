import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api, ApiError } from "@/api/client";
import type { Course, Quiz } from "@/api/types";
import { courseKey } from "@/features/courses/useCourse";
import { fmtPercent } from "@/i18n/format";
import { Button, ConfirmButton, InlineText, SavingSwitch, SaveStatus, UndoBar, useAutosave, useSortable, useUndo } from "@/ui/controls";
import { Crumbs, LoadError, Notice, PageLoading } from "@/ui/display";
import { useErrorText } from "@/ui/errors";
import { Icon } from "@/ui/icons";

import { FromBank, ToBank } from "./BankPanels";
import { CsvImport } from "./CsvImport";
import { type BankItem, blankQuestion, problemOf, type QDraft, QuestionFields, toPayload, type TopicChoice, unitTitle } from "./parts";

type Row = QDraft & { key: number };
type Panel = "csv" | "fromBank" | "toBank" | null;

const quizKey = (id: number) => ["quiz", id] as const;
/** The editor keeps its own copy, dropped when it closes, so it always opens on what the server has now. */
const editKey = (id: number) => ["quiz", id, "edit"] as const;

function fromQuiz(q: Quiz): QDraft[] {
  return q.questions.map((x) => ({
    id: x.id, text: x.text, image: x.image, options: x.options.map((o) => ({ text: o.text, image: o.image })), correct: x.correct ?? 0,
    explanation: x.explanation ?? "", topic_id: x.topic_id ?? null, area: x.area ?? "",
  }));
}

/** Pass mark and the two switches. Each saves on its own. */
function Settings({ quiz, course }: { quiz: Quiz; course: Course | undefined }) {
  const { t } = useTranslation("tests");
  const qc = useQueryClient();
  const [pass, setPass] = useState(String(quiz.pass_percent));
  const n = Number(pass);
  const passOk = pass.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= 100;
  const patch = async (body: Partial<Quiz>) => {
    await api.patch(`/api/tests/${quiz.id}`, body);
    qc.setQueryData<Quiz>(editKey(quiz.id), (q) => (q ? { ...q, ...body } : q));
    void qc.invalidateQueries({ queryKey: quizKey(quiz.id), exact: true });
    void qc.invalidateQueries({ queryKey: ["tests", quiz.course_id] });
  };
  const savePass = useAutosave(n, (v) => patch({ pass_percent: v }), { enabled: passOk });
  const unit = course ? unitTitle(course.units, quiz.unit_id) : null;
  return (
    <section className="card stack" aria-label={t("editor.settings")}>
      <div className="row" style={{ gap: 28, alignItems: "flex-start" }}>
        <label className="field">
          <span className="label">{t("editor.passMark")}</span>
          <span className="row tight nowrap">
            <input type="number" min={1} max={100} step={1} value={pass} onChange={(e) => setPass(e.target.value)} aria-invalid={!passOk || undefined}
                   aria-describedby="pass-hint" style={{ inlineSize: 90 }} />
            <span aria-hidden className="muted">%</span>
          </span>
        </label>
        <div className="stack tight" style={{ paddingBlockStart: 4 }}>
          <SavingSwitch checked={quiz.reveal} label={t("editor.reveal")} save={(reveal) => patch({ reveal })} />
          <SavingSwitch checked={quiz.published} label={t("editor.publish")} save={(published) => patch({ published })} />
        </div>
      </div>
      <span id="pass-hint" className="small">
        {!passOk ? <span className="field-error">{t("editor.passInvalid")}</span>
          : savePass.state !== "idle" ? <SaveStatus state={savePass.state} error={savePass.error} onRetry={() => void savePass.retry()} />
          : <span className="muted">{t("editor.passHint", { pass: fmtPercent(n) })}</span>}
      </span>
      <ul className="small muted stack tight" style={{ margin: 0, paddingInlineStart: 18, gap: 2 }}>
        <li>{t("editor.covers", { unit: unit ?? "", hasUnit: unit ? "yes" : "no" })}</li>
        <li>{quiz.reveal ? t("editor.revealOn") : t("editor.revealOff")}</li>
        <li>{quiz.published ? t("editor.publishedHint") : t("editor.draftHint")}</li>
      </ul>
    </section>
  );
}

function Questions({ quiz, topics }: { quiz: Quiz; topics: TopicChoice[] }) {
  const { t } = useTranslation("tests");
  const err = useErrorText();
  const qc = useQueryClient();
  const undo = useUndo();
  const key = useRef(0);
  const withKey = (q: QDraft): Row => ({ ...q, key: ++key.current });
  const [rows, setRows] = useState<Row[]>(() => fromQuiz(quiz).map(withKey));
  const [panel, setPanel] = useState<Panel>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const max = quiz.unit_id ? 100 : 200;
  const room = max - rows.length;

  const payload = useMemo(() => rows.map((r) => ({ ...toPayload(r), key: r.key })), [rows]);
  const problems = rows.map(problemOf);
  const first = problems.findIndex(Boolean);
  const auto = useAutosave(payload, async (questions) => {
    const r = await api.put<{ ids: number[] }>(`/api/tests/${quiz.id}/questions`, { questions });
    // New questions get their ids, so the next save updates them instead of adding them again.
    const ids = new Map(questions.map((x, i) => [x.key, r.ids[i]]));
    setRows((rs) => (rs.some((x) => !x.id && ids.has(x.key)) ? rs.map((x) => (!x.id && ids.has(x.key) ? { ...x, id: ids.get(x.key) } : x)) : rs));
    void qc.invalidateQueries({ queryKey: ["tests", quiz.course_id] });
    void qc.invalidateQueries({ queryKey: quizKey(quiz.id), exact: true }); // the player reads it fresh next time
  }, { enabled: first < 0 });
  const serverNumber = auto.state === "error" && auto.error instanceof ApiError ? Number(auto.error.params.number) || null : null;
  const problemText = (i: number) => err(new ApiError(400, problems[i]!, { number: i + 1 }));

  useEffect(() => {
    if (focus == null) return;
    const el = document.getElementById(`q-${focus}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.querySelector("textarea")?.focus({ preventScroll: true });
    setFocus(null);
  }, [focus]);

  const sort = useSortable(rows.map((r) => r.key), (ids) => setRows((rs) => ids.map((k) => rs.find((r) => r.key === k)!)));
  const update = (k: number, q: QDraft) => setRows((rs) => rs.map((r) => (r.key === k ? { ...q, key: k } : r)));
  const add = () => {
    const r = withKey(blankQuestion());
    setRows((rs) => [...rs, r]);
    setFocus(r.key);
  };
  const remove = (r: Row, i: number) => {
    setRows((rs) => rs.filter((x) => x.key !== r.key));
    undo.offer(t("editor.removed", { n: i + 1 }), async () => setRows((rs) => [...rs.slice(0, i), r, ...rs.slice(i)]));
  };
  const apply = (qs: QDraft[], mode: "append" | "replace") => {
    const before = rows;
    const added = qs.map(withKey);
    setRows(mode === "append" ? [...before, ...added] : added);
    setPanel(null);
    undo.offer(mode === "append" ? t("editor.appended", { n: qs.length }) : t("editor.replaced", { n: qs.length }), async () => setRows(before));
  };
  /** The server copies the bank questions in (and counts the use); this list gets the same copies so the next save keeps them. */
  const addFromBank = async (items: BankItem[]) => {
    await api.post(`/api/tests/${quiz.id}/from-bank`, { ids: items.map((x) => x.id) });
    apply(items.map((x) => ({
      text: x.text, image: "", options: x.options.map((o) => ({ text: o.text, image: o.image ?? "" })), correct: x.correct,
      explanation: x.explanation, topic_id: null, area: "",
    })), "append");
  };
  const savedFirst = async () => {
    if (first >= 0) throw new ApiError(400, problems[first]!, { number: first + 1 });
    await auto.retry();
  };
  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));

  return (
    <div className="stack">
      <div className="row between" style={{ position: "sticky", insetBlockStart: 0, zIndex: 2, background: "var(--bg)", paddingBlock: 8 }}>
        <div className="row tight">
          <h2 style={{ fontSize: "1.1rem" }}>{t("editor.questions", { n: rows.length })}</h2>
          {first >= 0 ? (
            <span className="status warn" role="status">
              {t("editor.notSaved", { reason: problemText(first) })}
              <button type="button" className="btn ghost small" onClick={() => setFocus(rows[first].key)}>{t("editor.show")}</button>
            </span>
          ) : (
            <SaveStatus state={auto.dirty && auto.state === "idle" ? "busy" : auto.state} error={auto.error} onRetry={() => void auto.retry()} />
          )}
        </div>
        <div className="row tight">
          <Button size="small" icon="file" aria-expanded={panel === "csv"} onClick={() => toggle("csv")}>{t("editor.importCsv")}</Button>
          <Button size="small" icon="layers" aria-expanded={panel === "fromBank"} onClick={() => toggle("fromBank")}>{t("editor.fromBank")}</Button>
          <Button size="small" variant="ghost" icon="upload" aria-expanded={panel === "toBank"} disabled={!rows.length} onClick={() => toggle("toBank")}>{t("editor.toBank")}</Button>
        </div>
      </div>

      {panel === "csv" && (
        <CsvImport courseId={quiz.course_id} unitId={quiz.unit_id} topics={topics} room={room} onApply={apply} onClose={() => setPanel(null)} />
      )}
      {panel === "fromBank" && <FromBank room={room} onAdd={addFromBank} onClose={() => setPanel(null)} />}
      {panel === "toBank" && <ToBank quizId={quiz.id} before={savedFirst} onClose={() => setPanel(null)} />}

      <UndoBar undo={undo} />

      {!rows.length && (
        <div className="empty card">
          <h3>{t("editor.emptyTitle")}</h3>
          <p>{t("editor.empty")}</p>
        </div>
      )}

      {rows.map((r, i) => {
        const row = sort.row(r.key);
        const problem = problems[i];
        const flagged = !!problem || serverNumber === i + 1;
        return (
          <article key={r.key} id={`q-${r.key}`} {...row} className={`card ${row.className}`}
                   style={{ borderColor: flagged ? "var(--warn)" : undefined }} aria-label={t("question.label", { n: i + 1 })}>
            <QuestionFields value={r} onChange={(q) => update(r.key, q)} number={i + 1} topics={topics} problem={problem}
              head={(
                <div className="row between nowrap">
                  <div className="row tight">
                    <button type="button" {...sort.handle(r.key, t("common:actions.reorder"))}><Icon name="grip" /></button>
                    <strong>{t("question.label", { n: i + 1 })}</strong>
                    {problem && <span className="status warn">{problemText(i)}</span>}
                  </div>
                  <Button size="small" variant="ghost" icon="trash" aria-label={t("editor.remove", { n: i + 1 })} title={t("editor.remove", { n: i + 1 })} onClick={() => remove(r, i)} />
                </div>
              )} />
          </article>
        );
      })}

      <div className="row between">
        <Button icon="plus" variant="primary" disabled={room <= 0} onClick={add}>{t("editor.add")}</Button>
        <span className="tiny muted">{t("editor.limit", { n: rows.length, max })}</span>
      </div>
    </div>
  );
}

export default function TestEditor() {
  const { t } = useTranslation("tests");
  const id = Number(useParams().quizId);
  const qc = useQueryClient();
  const nav = useNavigate();
  // Read once: the questions below are edited locally and saved; a refetch must not overwrite what is being typed.
  const q = useQuery({ queryKey: editKey(id), queryFn: () => api.get<Quiz>(`/api/quizzes/${id}`), staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false });
  const courseId = q.data?.course_id ?? 0;
  const course = useQuery({ queryKey: courseKey(courseId), queryFn: () => api.get<Course>(`/api/courses/${courseId}`), enabled: courseId > 0 });
  const topics = useMemo<TopicChoice[]>(() => {
    const c = course.data;
    const unitId = q.data?.unit_id;
    if (!c) return [];
    return c.units.filter((u) => !unitId || u.id === unitId)
      .flatMap((u) => u.topics.filter((x) => !x.archived).map((x) => ({ id: x.id, title: x.title, unit: u.title })));
  }, [course.data, q.data?.unit_id]);

  if (q.isPending) return <div className="page narrow"><PageLoading /></div>;
  if (q.isError) return <div className="page narrow"><LoadError error={q.error} retry={() => void q.refetch()} /></div>;
  const quiz = q.data;
  const back = `/courses/${quiz.course_id}/tests`;
  if (quiz.kind !== "test" || !quiz.can_edit) {
    return (
      <div className="page narrow">
        <Notice tone="warn" icon="flag" title={t("editor.cannotEdit")} action={<Link className="btn small" to={back}>{t("editor.backToTests")}</Link>} />
      </div>
    );
  }
  return (
    <div className="page narrow stack">
      <header className="page-head" style={{ marginBlockEnd: 0 }}>
        <div className="titles stack tight">
          <Crumbs items={[{ to: `/courses/${quiz.course_id}`, label: quiz.course }, { to: back, label: t("editor.crumbTests") }, { label: t("editor.crumbEdit") }]} />
          <InlineText as="h1" value={quiz.title} label={t("editor.title")} onSave={async (title) => {
            await api.patch(`/api/tests/${quiz.id}`, { title });
            qc.setQueryData<Quiz>(editKey(id), (x) => (x ? { ...x, title } : x));
            void qc.invalidateQueries({ queryKey: quizKey(id), exact: true });
            void qc.invalidateQueries({ queryKey: ["tests", quiz.course_id] });
          }} />
        </div>
        <div className="row tight">
          <Link className="btn small ghost" to={`/tests/${id}/results`}><Icon name="chart" /> {t("list.results")}</Link>
          <Link className="btn small" to={back}><Icon name="check" /> {t("common:actions.done")}</Link>
        </div>
      </header>
      <Settings quiz={quiz} course={course.data} />
      <Questions quiz={quiz} topics={topics} />
      <section className="card row between" aria-label={t("editor.dangerTitle")}>
        <span className="small muted grow">{t("editor.deleteHint")}</span>
        <ConfirmButton confirmLabel={t("list.deleteConfirm")} action={async () => {
          await api.del(`/api/tests/${id}`);
          qc.removeQueries({ queryKey: quizKey(id) }); // and the editor's copy under it
          void qc.invalidateQueries({ queryKey: ["tests", quiz.course_id] });
          nav(back, { replace: true });
        }}>{t("editor.delete")}</ConfirmButton>
      </section>
    </div>
  );
}
