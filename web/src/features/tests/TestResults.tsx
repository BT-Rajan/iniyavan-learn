import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { api } from "@/api/client";
import type { Quiz, TestResults as Results } from "@/api/types";
import { fmtNumber, fmtPercent, fmtRelative, fmtDateTime } from "@/i18n/format";
import { AreaPill, Bar, Empty, LoadError, PageHead, PageLoading, tone } from "@/ui/display";
import { Icon } from "@/ui/icons";

import { CountBar, CsvLink, LETTERS, ScorePill, Stat, statusOf } from "./parts";

type Student = Results["students"][number];
type SortKey = "name" | "best" | "latest";

/** How many students landed in each 10% band. Bars below the pass mark are drawn in the warning colour. */
function Spread({ spread, pass }: { spread: number[]; pass: number }) {
  const { t } = useTranslation("tests");
  const top = Math.max(1, ...spread);
  const band = (i: number) => (i === 9 ? t("results.band", { from: 90, to: 100 }) : t("results.band", { from: i * 10, to: i * 10 + 9 }));
  return (
    <figure className="card stack tight" style={{ margin: 0 }} aria-labelledby="spread-h">
      <h3 id="spread-h" style={{ fontSize: "1rem" }}>{t("results.spread")}</h3>
      <ul className="row nowrap" style={{ listStyle: "none", margin: 0, padding: 0, gap: 4, alignItems: "flex-end", blockSize: 150 }}>
        {spread.map((n, i) => (
          <li key={i} className="stack" style={{ flex: 1, gap: 4, alignItems: "center", blockSize: "100%", justifyContent: "flex-end", minInlineSize: 0 }}
              aria-label={t("results.bandCount", { band: band(i), n })}>
            <span className="tiny num muted" aria-hidden>{n || ""}</span>
            <span aria-hidden style={{
              inlineSize: "100%", blockSize: `${(100 * n) / top}%`, minBlockSize: n ? 4 : 1, borderRadius: "4px 4px 0 0",
              background: n ? ((i + 1) * 10 <= pass ? "var(--warn)" : "var(--good)") : "var(--line)",
            }} />
          </li>
        ))}
      </ul>
      <div className="row nowrap" style={{ gap: 4 }} aria-hidden>
        {spread.map((_, i) => <span key={i} className="tiny faint num" style={{ flex: 1, textAlign: "center", minInlineSize: 0 }}>{i * 10}</span>)}
      </div>
      <figcaption className="tiny muted">{t("results.spreadHint", { pass: fmtPercent(pass) })}</figcaption>
    </figure>
  );
}

function Chips({ items, tone: tn }: { items: string[]; tone: "good" | "bad" }) {
  return <>{items.map((x) => <span key={x} className={`pill ${tn}`} style={{ whiteSpace: "normal" }}>{x}</span>)}</>;
}

function StudentsTable({ students, pass }: { students: Student[]; pass: number }) {
  const { t } = useTranslation("tests");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "best", desc: true });
  const rows = [...students].sort((a, b) => {
    const d = sort.key === "name" ? a.name.localeCompare(b.name) : a[sort.key] - b[sort.key];
    return sort.desc ? -d : d;
  });
  const head = (key: SortKey, label: string, num?: boolean) => {
    const on = sort.key === key;
    return (
      <th scope="col" className={num ? "num" : ""} aria-sort={on ? (sort.desc ? "descending" : "ascending") : "none"}>
        <button type="button" className="btn ghost small" style={{ paddingInline: 4, minBlockSize: 24, font: "inherit", color: "inherit" }}
                onClick={() => setSort({ key, desc: on ? !sort.desc : key !== "name" })}>
          {label}
          {on && <Icon name="chevronDown" style={{ inlineSize: 12, blockSize: 12, transform: sort.desc ? undefined : "rotate(180deg)" }} />}
        </button>
      </th>
    );
  };
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">{t("results.studentsTitle")}</caption>
        <thead>
          <tr>
            {head("name", t("results.name"))}
            {head("best", t("results.best"), true)}
            {head("latest", t("results.latest"), true)}
            <th scope="col" className="num">{t("results.attempts")}</th>
            <th scope="col">{t("results.lastTaken")}</th>
            <th scope="col">{t("results.strengths")}</th>
            <th scope="col"><span className="sr-only">{t("results.attemptLink")}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.user_id}>
              <td><Link to={`/students/${s.user_id}`}>{s.name}</Link><div className="tiny muted">{s.email}</div></td>
              <td className="num"><ScorePill score={s.best} pass={pass} /></td>
              <td className="num">{fmtPercent(s.latest)}</td>
              <td className="num">{fmtNumber(s.attempts)}</td>
              <td className="small nowrap" title={fmtDateTime(s.last_at)}>{fmtRelative(s.last_at)}</td>
              <td style={{ minInlineSize: 220 }}>
                <div className="row tight">
                  {s.strong.length > 0 && <span className="tiny muted">{t("results.strong")}</span>}
                  <Chips items={s.strong} tone="good" />
                </div>
                {s.needs_study.length > 0 && (
                  <div className="row tight" style={{ marginBlockStart: 4 }}>
                    <span className="tiny muted">{t("results.needsStudy")}</span>
                    <Chips items={s.needs_study} tone="bad" />
                  </div>
                )}
              </td>
              <td><Link className="btn small ghost nowrap" to={`/attempts/${s.latest_attempt}`}>{t("results.viewAttempt")}<span className="sr-only"> {s.name}</span></Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuestionAnalysis({ questions }: { questions: Results["questions"] }) {
  const { t } = useTranslation("tests");
  return (
    <div className="stack">
      {questions.map((q) => (
        <article key={q.id} className="card stack tight" aria-labelledby={`qa-${q.id}`}>
          <div className="row between" style={{ alignItems: "flex-start" }}>
            <div className="stack tight grow">
              <strong id={`qa-${q.id}`}>{t("results.qTitle", { n: q.position, text: q.text })}</strong>
              {q.topic && <span className="tiny muted">{q.topic}</span>}
            </div>
            <span className="stack tight" style={{ minInlineSize: 140, alignItems: "flex-end" }}>
              <strong className="num">{q.percent == null ? "—" : t("results.right", { pct: fmtPercent(q.percent) })}</strong>
              {q.percent != null && <span style={{ inlineSize: 140 }}><Bar value={q.percent} tone={tone(statusOf(q.percent))} label={t("results.right", { pct: fmtPercent(q.percent) })} /></span>}
            </span>
          </div>
          {q.image && <img src={q.image} alt="" style={{ maxBlockSize: 120, alignSelf: "flex-start", borderRadius: 6 }} />}
          <ul className="stack tight" style={{ listStyle: "none", margin: 0, padding: 0, gap: 6 }}>
            {q.options.map((o, i) => {
              const ok = i === q.correct;
              return (
                <li key={i} className="row" style={{ gap: 10 }}>
                  <span className={`pill ${ok ? "good" : ""}`} style={{ minInlineSize: 26, justifyContent: "center" }}>
                    {ok ? <Icon name="check" style={{ inlineSize: 12, blockSize: 12 }} /> : LETTERS[i]}
                  </span>
                  <span className="small" style={{ flex: "1 1 160px", minInlineSize: 0, fontWeight: ok ? 600 : undefined }}>
                    {o.text || (o.image ? <img src={o.image} alt="" style={{ maxBlockSize: 36 }} /> : "—")}
                    {ok && <span className="sr-only"> ({t("results.correct")})</span>}
                  </span>
                  <span style={{ inlineSize: 160, marginInlineStart: "auto" }}>
                    <CountBar n={q.picks[i] ?? 0} of={q.total} tone={ok ? "good" : "warn"} label={t("results.picked", { n: q.picks[i] ?? 0, total: q.total })} />
                  </span>
                </li>
              );
            })}
          </ul>
          {q.blank > 0 && <span className="tiny muted">{t("results.blank", { n: q.blank })}</span>}
        </article>
      ))}
    </div>
  );
}

export default function TestResults() {
  const { t } = useTranslation("tests");
  const id = Number(useParams().quizId);
  const q = useQuery({ queryKey: ["results", id], queryFn: () => api.get<Results>(`/api/tests/${id}/results`) });
  // Results do not name the course; the test's own view does (for the way back).
  const quiz = useQuery({ queryKey: ["quiz", id], queryFn: () => api.get<Quiz>(`/api/quizzes/${id}`) });
  if (q.isPending) return <div className="page"><PageLoading /></div>;
  if (q.isError) return <div className="page"><LoadError error={q.error} retry={() => void q.refetch()} /></div>;
  const r = q.data;
  const s = r.summary;
  return (
    <div className="page stack loose">
      <PageHead
        crumbs={[
          ...(quiz.data ? [{ to: `/courses/${quiz.data.course_id}`, label: quiz.data.course }, { to: `/courses/${quiz.data.course_id}/tests`, label: t("editor.crumbTests") }] : []),
          { label: t("results.crumb") },
        ]}
        title={t("results.title", { title: r.title })}
        sub={t("results.sub", { pass: fmtPercent(r.pass_percent), published: r.published ? "yes" : "no" })}
        actions={<><Link className="btn small ghost" to={`/tests/${id}/edit`}><Icon name="edit" /> {t("common:actions.edit")}</Link><CsvLink href={`/api/tests/${id}/results?format=csv`} /></>}
      />

      <section className="stack" aria-label={t("results.summary")}>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 150px), 1fr))" }}>
          <Stat label={t("results.took")} value={t("results.ofStudents", { n: s.took, total: s.students })} sub={t("results.attemptsTotal", { n: s.attempts })} />
          <Stat label={t("results.notTakenCount")} value={fmtNumber(s.not_taken)} />
          <Stat label={t("results.passed")} value={fmtNumber(s.passed)} sub={t("results.passRate", { pct: fmtPercent(s.pass_rate) })} />
          <Stat label={t("results.average")} value={fmtPercent(s.average)} sub={t("results.median", { pct: fmtPercent(s.median) })} />
          <Stat label={t("results.range")} value={s.highest == null ? "—" : t("results.rangeValue", { low: fmtPercent(s.lowest), high: fmtPercent(s.highest) })} />
        </div>
        {s.took > 0 && <Spread spread={s.spread} pass={r.pass_percent} />}
      </section>

      <section className="stack" aria-labelledby="students-h">
        <h2 id="students-h">{t("results.studentsTitle")}</h2>
        {r.students.length ? <StudentsTable students={r.students} pass={r.pass_percent} /> : <Empty icon="users" title={t("results.noneTitle")}>{t("results.none")}</Empty>}
        {r.not_taken.length > 0 && (
          <details className="disclosure card">
            <summary>{t("results.notTakenTitle", { n: s.not_taken })}</summary>
            <ul className="row tight" style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
              {r.not_taken.map((u) => <li key={u.user_id}><Link className="pill" to={`/students/${u.user_id}`}>{u.name}</Link></li>)}
            </ul>
          </details>
        )}
      </section>

      {s.took > 0 && r.areas.length > 0 && (
        <section className="stack" aria-labelledby="areas-h">
          <div className="stack tight">
            <h2 id="areas-h">{t("results.areasTitle")}</h2>
            <p className="small muted">{t("results.areasHint")}</p>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("results.area")}</th>
                  <th scope="col">{t("results.classScore")}</th>
                  <th scope="col">{t("results.status")}</th>
                  <th scope="col">{t("results.studentsSplit")}</th>
                </tr>
              </thead>
              <tbody>
                {r.areas.map((a) => (
                  <tr key={`${a.topic_id}-${a.title}`}>
                    <td style={{ minInlineSize: 180 }}>{a.title || t("results.general")}{a.unit && <div className="tiny muted">{a.unit}</div>}</td>
                    <td style={{ minInlineSize: 160 }}>
                      <span className="row tight nowrap">
                        <span style={{ flex: 1 }}><Bar value={a.percent} tone={tone(statusOf(a.percent))} label={fmtPercent(a.percent)} /></span>
                        <span className="small num">{fmtPercent(a.percent)}</span>
                      </span>
                    </td>
                    <td><AreaPill status={statusOf(a.percent)} /></td>
                    <td className="small">{t("results.split", { strong: a.strong, getting: a.getting_there, needs: a.needs_study })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="stack" aria-labelledby="qa-h">
        <div className="stack tight">
          <h2 id="qa-h">{t("results.questionsTitle")}</h2>
          <p className="small muted">{t("results.questionsHint")}</p>
        </div>
        {r.questions.length ? <QuestionAnalysis questions={r.questions} /> : <Empty icon="flag" title={t("results.noQuestions")} />}
      </section>
    </div>
  );
}
