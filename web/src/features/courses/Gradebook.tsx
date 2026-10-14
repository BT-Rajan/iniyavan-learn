import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { api } from "@/api/client";
import type { Gradebook as Book, Stats } from "@/api/types";
import { CsvLink, ScorePill, Stat } from "@/features/tests/parts";
import { fmtPercent } from "@/i18n/format";
import { Empty, LoadError, PageLoading } from "@/ui/display";

import { useCourse } from "./useCourse";

const FOOT = { background: "var(--surface-2)", borderBlockStart: "1px solid var(--line-strong)" };

function StatsCell({ s }: { s: Stats }) {
  const { t } = useTranslation("tests");
  if (s.average == null) return <span className="faint">—</span>;
  return (
    <span className="stack" style={{ gap: 0, alignItems: "flex-end" }}>
      <strong className="num">{fmtPercent(s.average)}</strong>
      <span className="tiny muted nowrap">{t("gradebook.colStats", { median: fmtPercent(s.median), low: fmtPercent(s.lowest), high: fmtPercent(s.highest) })}</span>
    </span>
  );
}

export default function Gradebook() {
  const { t } = useTranslation("tests");
  const { course } = useCourse();
  const q = useQuery({ queryKey: ["gradebook", course.id], queryFn: () => api.get<Book>(`/api/courses/${course.id}/gradebook`) });
  if (q.isPending) return <PageLoading />;
  if (q.isError) return <LoadError error={q.error} retry={() => void q.refetch()} />;
  const g = q.data;
  if (!g.tests.length) {
    return <Empty icon="chart" title={t("gradebook.noTestsTitle")} action={<Link className="btn" to={`/courses/${course.id}/tests`}>{t("gradebook.toTests")}</Link>}>{t("gradebook.noTests")}</Empty>;
  }
  const passMean = g.tests.reduce((n, x) => n + x.pass_percent, 0) / g.tests.length;
  return (
    <div className="stack">
      <div className="row between">
        <p className="small muted grow">{t("gradebook.hint")}</p>
        <CsvLink href={`/api/courses/${course.id}/gradebook?format=csv`} />
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 150px), 1fr))" }}>
        <Stat label={t("gradebook.students")} value={g.students.length} sub={t("gradebook.tookAny", { n: g.students.filter((s) => s.taken > 0).length })} />
        <Stat label={t("gradebook.finalAverage")} value={fmtPercent(g.summary.average)} sub={t("results.median", { pct: fmtPercent(g.summary.median) })} />
        <Stat label={t("results.range")} value={g.summary.highest == null ? "—" : t("results.rangeValue", { low: fmtPercent(g.summary.lowest), high: fmtPercent(g.summary.highest) })} />
      </div>
      {!g.students.length ? <Empty icon="users" title={t("gradebook.noStudentsTitle")}>{t("gradebook.noStudents")}</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">{t("gradebook.caption", { course: g.course })}</caption>
            <thead>
              <tr>
                <th scope="col">{t("gradebook.student")}</th>
                {g.tests.map((x) => (
                  <th key={x.id} scope="col" className="num" style={{ whiteSpace: "normal", minInlineSize: 110 }}>
                    <Link to={`/tests/${x.id}/results`} style={{ color: "inherit" }}>{x.title}</Link>
                    <div className="tiny faint" style={{ fontWeight: 400 }}>{t("gradebook.colMeta", { unit: x.unit, hasUnit: x.unit ? "yes" : "no", pass: fmtPercent(x.pass_percent) })}</div>
                  </th>
                ))}
                <th scope="col" className="num">{t("gradebook.taken")}</th>
                <th scope="col" className="num">{t("gradebook.final")}</th>
              </tr>
            </thead>
            <tbody>
              {g.students.map((s) => (
                <tr key={s.user_id}>
                  <th scope="row" style={{ background: "transparent", fontSize: "0.92rem", color: "var(--text)", fontWeight: 540 }}>
                    <Link to={`/students/${s.user_id}`}>{s.name}</Link>
                    <div className="tiny muted" style={{ fontWeight: 400 }}>{s.email}</div>
                  </th>
                  {s.scores.map((v, i) => <td key={g.tests[i].id} className="num"><ScorePill score={v} pass={g.tests[i].pass_percent} /></td>)}
                  <td className="num small">{t("gradebook.takenOf", { n: s.taken, total: g.tests.length })}</td>
                  <td className="num"><ScorePill score={s.final} pass={passMean} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="small" style={FOOT}>{t("gradebook.classAverage")}</th>
                {g.tests.map((x) => <td key={x.id} className="num" style={FOOT}><StatsCell s={x} /></td>)}
                <td style={FOOT} />
                <td className="num" style={FOOT}><StatsCell s={g.summary} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
