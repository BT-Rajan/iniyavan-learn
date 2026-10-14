import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { api } from "@/api/client";
import type { StudentReport } from "@/api/types";
import { useSession } from "@/app/session";
import { fmtDateTime, fmtPercent, fmtRelative } from "@/i18n/format";
import { AreaPill, Avatar, Bar, Empty, LoadError, PageHead, PageLoading, tone } from "@/ui/display";
import { Icon, type IconName } from "@/ui/icons";

function Stat({ icon, label, children }: { icon: IconName; label: ReactNode; children: ReactNode }) {
  return (
    <div className="card stack tight">
      <span className="small muted row tight"><Icon name={icon} /> {label}</span>
      {children}
    </div>
  );
}

export default function StudentPage() {
  const { t } = useTranslation("reports");
  const id = Number(useParams().userId);
  const { isAdmin } = useSession();
  const q = useQuery({ queryKey: ["report", "student", id], queryFn: () => api.get<StudentReport>(`/api/reports/students/${id}`) });
  if (q.isPending) return <div className="page"><PageLoading /></div>;
  if (q.isError) return <div className="page"><LoadError error={q.error} retry={() => void q.refetch()} /></div>;
  const r = q.data;
  const s = r.student;
  const lv = r.level;
  return (
    <div className="page">
      <PageHead
        crumbs={isAdmin ? [{ to: "/admin/people?role=student", label: t("common:nav.people") }, { label: s.name }] : undefined}
        title={
          <div className="row" style={{ gap: 14 }}>
            <Avatar name={s.name} />
            <div className="stack" style={{ gap: 2 }}>
              <h1>{s.name}</h1>
              <span className="small muted row tight">
                <a href={`mailto:${s.email}`}>{s.email}</a>
                <span aria-hidden>·</span>
                <span title={s.last_seen ? fmtDateTime(s.last_seen) : undefined}>
                  {s.last_seen ? t("student.lastSeen", { when: fmtRelative(s.last_seen) }) : t("student.neverSeen")}
                </span>
              </span>
            </div>
          </div>
        }
      />
      <div className="stack loose">
        <div className="grid">
          <Stat icon="star" label={t("common:progress.level", { level: lv.level })}>
            <strong style={{ fontSize: "1.3rem" }}>{t("common:progress.points", { points: lv.points })}</strong>
            <Bar value={lv.span ? (100 * lv.into) / lv.span : 0} label={t("student.toNextLevel", { into: lv.into, span: lv.span })} />
            <span className="tiny muted">{t("student.toNextLevel", { into: lv.into, span: lv.span })}</span>
          </Stat>
          <Stat icon="flame" label={t("student.streak")}>
            <strong style={{ fontSize: "1.3rem" }}>{t("common:progress.streak", { n: r.streak })}</strong>
          </Stat>
        </div>

        <section className="stack" aria-labelledby="courses-h">
          <h2 id="courses-h">{t("student.courses")}</h2>
          {r.courses.length === 0 ? <Empty icon="book" title={t("student.noCourses")}>{t("student.noCoursesHint")}</Empty> : (
            <div className="table-wrap" style={{ position: "relative" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t("cols.course")}</th>
                    <th scope="col" style={{ minInlineSize: 180 }}>{t("cols.completion")}</th>
                    <th scope="col" className="num">{t("cols.testsTaken")}</th>
                    <th scope="col" className="num">{t("cols.final")}</th>
                    <th scope="col"><span className="sr-only">{t("cols.open")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {r.courses.map((c) => (
                    <tr key={c.id}>
                      <td><Link to={`/courses/${c.id}`} style={{ fontWeight: 560 }}>{c.title}</Link></td>
                      <td>
                        <div className="stack" style={{ gap: 4 }}>
                          <Bar value={c.completion} label={t("common:progress.topicsDone", { done: c.completed, total: c.topics })} />
                          <span className="tiny muted num">{t("student.completion", { percent: fmtPercent(c.completion), done: c.completed, total: c.topics })}</span>
                        </div>
                      </td>
                      <td className="num">{c.tests_taken}</td>
                      <td className="num"><strong>{fmtPercent(c.final)}</strong></td>
                      <td><Link className="btn small ghost" to={`/courses/${c.id}/report`}><Icon name="chart" /> {t("student.courseReport")}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="stack" aria-labelledby="summary-h">
          <h2 id="summary-h">{t("student.summary")}</h2>
          {!r.summary.strong.length && !r.summary.needs_study.length ? <p className="muted">{t("student.noTests")}</p> : (
            <div className="grid">
              <div className="card stack tight">
                <h3 className="row tight"><Icon name="check" style={{ color: "var(--good)" }} /> {t("student.strong", { n: r.summary.strong.length })}</h3>
                <div className="row tight">
                  {r.summary.strong.length ? r.summary.strong.map((x) => <span key={x} className="pill good">{x}</span>) : <span className="small muted">{t("student.none")}</span>}
                </div>
              </div>
              <div className="card stack tight">
                <h3 className="row tight"><Icon name="target" style={{ color: "var(--bad)" }} /> {t("student.needsStudy", { n: r.summary.needs_study.length })}</h3>
                <div className="row tight">
                  {r.summary.needs_study.length ? r.summary.needs_study.map((x) => <span key={x} className="pill bad">{x}</span>) : <span className="small muted">{t("student.none")}</span>}
                </div>
              </div>
            </div>
          )}
        </section>

        {r.areas.length > 0 && (
          <section className="stack" aria-labelledby="areas-h">
            <h2 id="areas-h">{t("student.areas")}</h2>
            <div className="table-wrap" style={{ position: "relative" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t("cols.area")}</th>
                    <th scope="col" className="num">{t("cols.right")}</th>
                    <th scope="col" style={{ minInlineSize: 140 }}>{t("cols.score")}</th>
                    <th scope="col">{t("cols.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.areas.map((a, i) => (
                    <tr key={`${a.topic_id ?? a.title}-${i}`}>
                      <td>
                        <div className="stack" style={{ gap: 0 }}>
                          {a.topic_id ? <Link to={`/topics/${a.topic_id}`}>{a.title}</Link> : <span>{a.title}</span>}
                          {a.unit && <span className="tiny muted">{a.unit}</span>}
                        </div>
                      </td>
                      <td className="num">{t("student.right", { correct: a.correct, total: a.total })}</td>
                      <td>
                        <div className="row tight nowrap">
                          <span className="grow"><Bar value={a.percent} tone={tone(a.status)} label={fmtPercent(a.percent)} /></span>
                          <span className="small num" style={{ minInlineSize: 40, textAlign: "end" }}>{fmtPercent(a.percent)}</span>
                        </div>
                      </td>
                      <td><AreaPill status={a.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
