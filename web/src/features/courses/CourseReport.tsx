import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { api } from "@/api/client";
import type { CourseReport as Report } from "@/api/types";
import { fmtDateTime, fmtPercent, fmtRelative } from "@/i18n/format";
import { Segmented } from "@/ui/controls";
import { AreaPill, Bar, Empty, LoadError, PageLoading, tone } from "@/ui/display";
import { Icon } from "@/ui/icons";

import { useCourse } from "./useCourse";

type Row = Report["students"][number];
type SortKey = "name" | "completion" | "tests_taken" | "final" | "last_active";

function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card stack tight">
      <span className="small muted">{label}</span>
      <strong style={{ fontSize: "1.6rem", lineHeight: 1.1 }} className="num">{value}</strong>
      {sub && <span className="tiny muted">{sub}</span>}
    </div>
  );
}

/** Missing values (no final score, never active) always sort last, whichever way the column runs. */
function compare(a: Row, b: Row, key: SortKey) {
  if (key === "name") return a.name.localeCompare(b.name);
  const x = a[key];
  const y = b[key];
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return key === "last_active" ? String(x).localeCompare(String(y)) : Number(x) - Number(y);
}

export default function CourseReport() {
  const { t } = useTranslation("reports");
  const { course } = useCourse();
  const q = useQuery({ queryKey: ["report", "course", course.id], queryFn: () => api.get<Report>(`/api/reports/courses/${course.id}`) });
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "name", desc: false });
  const [show, setShow] = useState<"all" | "not_started">("all");

  const rows = useMemo(() => {
    const list = (q.data?.students ?? []).filter((r) => show === "all" || !r.last_active);
    return [...list].sort((a, b) => {
      const c = compare(a, b, sort.key);
      const missing = sort.key !== "name" && (a[sort.key] == null || b[sort.key] == null);
      return missing ? c : sort.desc ? -c : c;
    });
  }, [q.data, sort, show]);

  if (q.isPending) return <PageLoading />;
  if (q.isError) return <LoadError error={q.error} retry={() => void q.refetch()} />;
  const r = q.data;
  const s = r.summary;
  const notStarted = r.students.filter((x) => !x.last_active).length;

  const th = (k: SortKey, children: ReactNode, num?: boolean) => {
    const active = sort.key === k;
    return (
      <th key={k} scope="col" className={num ? "num" : undefined} aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}>
        <button type="button" className="btn ghost small" style={{ minBlockSize: 0, padding: "2px 4px", font: "inherit", color: active ? "var(--text)" : "inherit" }}
                onClick={() => setSort({ key: k, desc: active ? !sort.desc : k !== "name" })}>
          {children}
          {active && <Icon name="chevronDown" style={{ inlineSize: 14, blockSize: 14, transform: sort.desc ? undefined : "rotate(180deg)" }} />}
        </button>
      </th>
    );
  };

  return (
    <div className="stack loose">
      <div className="row between">
        <p className="small muted">{t("course.intro", { topics: r.topics })}</p>
        <a className="btn small" href={`/api/reports/courses/${course.id}?format=csv`} download><Icon name="download" /> {t("common:actions.downloadCsv")}</a>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 200px), 1fr))" }}>
        <Stat label={t("course.students")} value={s.students} />
        <Stat label={t("course.started")} value={s.started} sub={t("course.startedOf", { started: s.started, total: s.students })} />
        <Stat label={t("course.completion")} value={fmtPercent(s.completion)} />
        <Stat label={t("course.final")} value={fmtPercent(s.final.average)}
              sub={s.final.average == null ? t("course.noTests") : t("course.finalSpread", { median: fmtPercent(s.final.median), high: fmtPercent(s.final.highest), low: fmtPercent(s.final.lowest) })} />
      </div>

      <section className="stack" aria-labelledby="report-students">
        <div className="row between">
          <h2 id="report-students">{t("course.studentsTitle")}</h2>
          {r.students.length > 0 && (
            <Segmented label={t("course.show")} value={show} onChange={setShow}
                       options={[{ value: "all", label: t("course.everyone", { n: r.students.length }) }, { value: "not_started", label: t("course.notStarted", { n: notStarted }) }]} />
          )}
        </div>
        {r.students.length === 0 ? <Empty icon="users" title={t("course.noStudents")}>{t("course.noStudentsHint")}</Empty>
          : rows.length === 0 ? <p className="muted">{t("course.everyoneStarted")}</p> : (
          <div className="table-wrap" style={{ position: "relative" }}>
            <table className="table">
              <thead>
                <tr>
                  {th("name", t("cols.student"))}
                  {th("completion", t("cols.completion"))}
                  {th("tests_taken", t("cols.testsTaken"), true)}
                  {th("final", t("cols.final"), true)}
                  {th("last_active", t("cols.lastActive"))}
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.user_id}>
                    <td>
                      <div className="stack" style={{ gap: 0 }}>
                        <Link to={`/students/${x.user_id}`} style={{ fontWeight: 560 }}>{x.name}</Link>
                        <span className="tiny muted">{x.email}</span>
                      </div>
                    </td>
                    <td style={{ minInlineSize: 170 }}>
                      <div className="stack" style={{ gap: 4 }}>
                        <Bar value={x.completion} label={t("common:progress.topicsDone", { done: x.completed, total: r.topics })} />
                        <span className="tiny muted num">{t("course.completionRow", { percent: fmtPercent(x.completion), done: x.completed, total: r.topics })}</span>
                      </div>
                    </td>
                    <td className="num">{x.tests_taken}</td>
                    <td className="num"><strong>{fmtPercent(x.final)}</strong></td>
                    <td className="small nowrap" title={x.last_active ? fmtDateTime(x.last_active) : undefined}>
                      {x.last_active ? fmtRelative(x.last_active) : <span className="pill warn">{t("course.notStartedPill")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="stack" aria-labelledby="report-areas">
        <div className="stack tight">
          <h2 id="report-areas">{t("course.weakTitle")}</h2>
          <p className="small muted">{t("course.weakHint")}</p>
        </div>
        {r.weak_areas.length === 0 ? <p className="muted">{t("course.noWeak")}</p> : (
          <div className="unit">
            {r.weak_areas.map((a, i) => (
              <div key={`${a.topic_id ?? a.title}-${i}`} className="topic-row" style={{ flexWrap: "wrap" }}>
                <span className="grow stack" style={{ gap: 0, minInlineSize: 180 }}>
                  {a.topic_id ? <Link to={`/topics/${a.topic_id}`} className="title">{a.title}</Link> : <span className="title">{a.title}</span>}
                  {a.unit && <span className="tiny muted">{a.unit}</span>}
                </span>
                <span style={{ inlineSize: 120 }}><Bar value={a.percent} tone={tone(a.status)} label={fmtPercent(a.percent)} /></span>
                <span className="small num" style={{ minInlineSize: 44, textAlign: "end" }}>{fmtPercent(a.percent)}</span>
                <span className="tiny muted num nowrap">{t("course.answers", { correct: a.correct, total: a.total })}</span>
                <AreaPill status={a.status} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
