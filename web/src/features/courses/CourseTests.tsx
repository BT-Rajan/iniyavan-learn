import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import type { Course, Quiz, TestRow } from "@/api/types";
import { useSession } from "@/app/session";
import { unitTitle } from "@/features/tests/parts";
import { fmtPercent } from "@/i18n/format";
import { ConfirmButton, SaveStatus, Switch, useAction } from "@/ui/controls";
import { Empty, LoadError, Notice, PageLoading } from "@/ui/display";
import { Icon } from "@/ui/icons";

import { useCourse } from "./useCourse";

const testsKey = (courseId: number) => ["tests", courseId] as const;

function useTests(courseId: number) {
  return useQuery({ queryKey: testsKey(courseId), queryFn: () => api.get<TestRow[]>(`/api/courses/${courseId}/tests`) });
}

function Meta({ row, course }: { row: TestRow; course: Course }) {
  const { t } = useTranslation("tests");
  const unit = unitTitle(course.units, row.unit_id);
  return (
    <span className="small muted">
      {t("list.meta", { questions: row.questions, pass: fmtPercent(row.pass_percent), unit: unit ?? "", hasUnit: unit ? "yes" : "no" })}
    </span>
  );
}

/** A learner's view: each published test, how they did, and one button to take it. */
function StudentTests({ course }: { course: Course }) {
  const { t } = useTranslation("tests");
  const q = useTests(course.id);
  if (q.isPending) return <PageLoading />;
  if (q.isError) return <LoadError error={q.error} retry={() => void q.refetch()} />;
  if (!q.data.length) return <Empty icon="flag" title={t("list.emptyTitle")}>{t("list.emptyStudent")}</Empty>;
  return (
    <div className="unit">
      {q.data.map((x) => {
        const passed = x.best != null && x.best >= x.pass_percent;
        const attempt = x.latest_attempt;
        return (
          <div key={x.id} className="topic-row" style={{ flexWrap: "wrap" }}>
            <span className="grow stack" style={{ gap: 2, minInlineSize: 180 }}>
              <span className="title">{x.title}</span>
              <Meta row={x} course={course} />
            </span>
            {x.best == null ? (
              <span className="pill">{t("list.notTaken")}</span>
            ) : (
              <span className={`pill ${passed ? "good" : "warn"}`}>
                {passed && <Icon name="check" style={{ inlineSize: 12, blockSize: 12 }} />}
                {t(passed ? "list.passedBest" : "list.notPassedBest", { best: fmtPercent(x.best) })}
              </span>
            )}
            <span className="row tight">
              {attempt && <Link className="btn small ghost" to={`/attempts/${attempt}`}>{t("list.lastAttempt")}</Link>}
              <Link className={`btn small ${x.best == null ? "primary" : ""}`} to={`/quiz/${x.id}`}>
                <Icon name={x.best == null ? "play" : "refresh"} className={x.best == null ? "flip" : ""} />
                {x.best == null ? t("list.start") : t("list.retake")}
              </Link>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Composing a new test: name it, say what it covers, then write the questions in the editor. */
function NewTest({ course }: { course: Course }) {
  const { t } = useTranslation("tests");
  const nav = useNavigate();
  const [title, setTitle] = useState("");
  const [unit, setUnit] = useState("");
  const units = course.units.filter((u) => !u.archived);
  const create = useAction(async () => {
    const q = await api.post<Quiz>(`/api/courses/${course.id}/tests`, { title: title.trim(), unit_id: unit ? Number(unit) : null });
    nav(`/tests/${q.id}/edit`);
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim()) void create.run();
  };
  return (
    <form className="card stack tight" onSubmit={submit} aria-labelledby="new-test-h">
      <h2 id="new-test-h" style={{ fontSize: "1rem" }}>{t("list.newTitle")}</h2>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="field grow" style={{ minInlineSize: 200 }}>
          <span className="label">{t("list.name")}</span>
          <input type="text" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={t("list.namePlaceholder")} />
        </label>
        <label className="field" style={{ minInlineSize: 180 }}>
          <span className="label">{t("list.covers")}</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="">{t("list.wholeCourse")}</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.title}</option>)}
          </select>
        </label>
        <button type="submit" className="btn primary" disabled={!title.trim() || create.busy} aria-busy={create.busy || undefined}>
          {create.busy ? <span className="spin" aria-hidden /> : <Icon name="plus" />} {t("list.create")}
        </button>
      </div>
      <p className="tiny muted">{t("list.newHint")}</p>
      {create.state === "error" && <SaveStatus state="error" error={create.error} />}
    </form>
  );
}

/** A teacher's view: every test, drafts included, with what can be done to each right on its row. */
function EditorTests({ course }: { course: Course }) {
  const { t } = useTranslation("tests");
  const q = useTests(course.id);
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const setRow = (id: number, change: Partial<TestRow> | null) =>
    qc.setQueryData<TestRow[]>(testsKey(course.id), (rows) => rows && (change ? rows.map((r) => (r.id === id ? { ...r, ...change } : r)) : rows.filter((r) => r.id !== id)));

  const publish = async (x: TestRow, published: boolean) => {
    setError(null);
    setRow(x.id, { published });
    try {
      await api.patch(`/api/tests/${x.id}`, { published });
      void qc.invalidateQueries({ queryKey: ["quiz", x.id] });
    } catch (e) {
      setError(e);
      void qc.invalidateQueries({ queryKey: testsKey(course.id) });
    }
  };

  if (q.isPending) return <PageLoading />;
  if (q.isError) return <LoadError error={q.error} retry={() => void q.refetch()} />;
  return (
    <div className="stack">
      <NewTest course={course} />
      {error ? <SaveStatus state="error" error={error} /> : null}
      {!q.data.length ? (
        <Empty icon="flag" title={t("list.emptyTitle")}>{t("list.emptyEditor")}</Empty>
      ) : (
        <div className="unit">
          {q.data.map((x) => (
            <div key={x.id} className={`topic-row ${x.published ? "" : "draft"}`} style={{ flexWrap: "wrap" }}>
              <span className="grow stack" style={{ gap: 2, minInlineSize: 180 }}>
                <Link to={`/tests/${x.id}/edit`} className="title" style={{ color: "inherit" }}>{x.title}</Link>
                <Meta row={x} course={course} />
              </span>
              {x.published && x.questions === 0 && <span className="pill warn">{t("list.hiddenEmpty")}</span>}
              <Switch checked={x.published} onChange={(v) => void publish(x, v)}
                      label={<span className="small muted">{x.published ? t("common:status.published") : t("common:status.draft")}</span>} />
              <span className="row tight">
                <Link className="btn small" to={`/tests/${x.id}/edit`}><Icon name="edit" /> {t("common:actions.edit")}</Link>
                <Link className="btn small ghost" to={`/tests/${x.id}/results`}><Icon name="chart" /> {t("list.results")}</Link>
                <ConfirmButton confirmLabel={t("list.deleteConfirm")} action={async () => {
                  await api.del(`/api/tests/${x.id}`);
                  setRow(x.id, null);
                  qc.removeQueries({ queryKey: ["quiz", x.id] });
                }}>
                  {t("common:actions.delete")}<span className="sr-only"> {x.title}</span>
                </ConfirmButton>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CourseTests() {
  const { t } = useTranslation("tests");
  const { course } = useCourse();
  const { isStaff } = useSession();
  if (course.kind === "personal") {
    return (
      <Notice icon="target" title={t("list.personalTitle")} action={<Link className="btn small" to={`/courses/${course.id}`}>{t("list.toTopics")}</Link>}>
        {t("list.personal")}
      </Notice>
    );
  }
  return course.can_edit && isStaff ? <EditorTests course={course} /> : <StudentTests course={course} />;
}
