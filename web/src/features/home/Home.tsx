import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import type { Browse, Home as HomeData, Quiz } from "@/api/types";
import { useMe, useSession } from "@/app/session";
import { fmtDate, fmtWeekday } from "@/i18n/format";
import { ActionButton } from "@/ui/controls";
import { Bar, Empty, LoadError, PageLoading, Ring } from "@/ui/display";
import { Icon } from "@/ui/icons";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

export default function Home() {
  const { t } = useTranslation("home");
  const me = useMe();
  const { isStaff } = useSession();
  const nav = useNavigate();
  const home = useQuery({ queryKey: ["home"], queryFn: () => api.get<HomeData>("/api/home") });
  const browse = useQuery({ queryKey: ["browse"], queryFn: () => api.get<Browse>("/api/browse"), enabled: isStaff });

  if (home.isPending) return <div className="page"><PageLoading /></div>;
  if (home.isError) return <div className="page"><LoadError error={home.error} retry={() => void home.refetch()} /></div>;
  const h = home.data;
  const first = me.name.split(" ")[0];
  const teaching = (browse.data?.terms ?? []).flatMap((g) => g.courses).filter((c) => c.can_edit && c.kind === "catalog");

  return (
    <div className="page stack loose">
      <header className="stack tight">
        <h1>{t("greeting", { part: greeting(), name: first })}</h1>
        <p className="muted">{h.studied_today ? t("studiedToday") : h.streak > 0 ? t("keepStreak", { n: h.streak }) : t("subtitle")}</p>
      </header>

      {!isStaff && !me.placed && !me.self_registered && <div className="notice warn"><Icon name="calendar" /><span>{t("notPlaced")}</span></div>}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}>
        {h.next ? (
          <section className="card hero pad-lg stack" aria-labelledby="next-title">
            <span className="small muted">{t("nextUp")} · {h.next.course}</span>
            <h2 id="next-title" style={{ fontSize: "1.4rem" }}>{h.next.title}</h2>
            <div className="stack tight">
              <Bar value={(100 * h.next.done) / Math.max(1, h.next.topics)} label={t("courseProgress")} />
              <span className="small muted">{t("common:progress.topicsDone", { done: h.next.done, total: h.next.topics })}</span>
            </div>
            <div className="row">
              <Link className="btn lg" to={`/topics/${h.next.topic_id}`} style={{ background: "var(--accent-ink)", color: "var(--accent)", borderColor: "transparent" }}>
                <Icon name="play" className="flip" /> {h.next.done ? t("continue") : t("start")}
              </Link>
              <Link className="btn ghost" style={{ color: "inherit" }} to={`/courses/${h.next.course_id}`}>{t("seeCourse")}</Link>
            </div>
          </section>
        ) : (
          <section className="card pad-lg">
            <Empty icon="sparkle" title={h.courses ? t("allDone") : t("noCourses")}
                   action={<Link className="btn primary" to={h.courses ? "/courses" : "/studio/new"}>{h.courses ? t("browse") : t("makeCourse")}</Link>}>
              {h.courses ? t("allDoneBody") : t("noCoursesBody")}
            </Empty>
          </section>
        )}

        <section className="card stack" aria-labelledby="stats-title">
          <h2 id="stats-title" className="sr-only">{t("yourWeek")}</h2>
          <div className="row nowrap" style={{ gap: 16 }}>
            <Ring value={(100 * h.level.into) / h.level.span} size={64} label={t("levelProgress", { into: h.level.into, span: h.level.span })}>{h.level.level}</Ring>
            <div className="grow stack tight">
              <strong>{t("common:progress.level", { level: h.level.level })}</strong>
              <span className="small muted">{t("toNext", { n: h.level.span - h.level.into })}</span>
            </div>
            <div className="stack tight" style={{ alignItems: "center" }}>
              <Icon name="flame" style={{ color: h.streak ? "var(--star)" : "var(--faint)", inlineSize: 26, blockSize: 26 }} />
              <span className="small num"><strong>{h.streak}</strong></span>
            </div>
          </div>
          <div className="week" aria-label={t("yourWeek")}>
            {h.week.map((d) => (
              <span key={d.date} className={`day ${d.active ? "active" : ""} ${d.today ? "today" : ""}`} title={fmtDate(d.date)}>
                <span className="dot">{d.active && <Icon name="check" style={{ inlineSize: 14, blockSize: 14 }} />}</span>
                {fmtWeekday(d.date)}
              </span>
            ))}
          </div>
          <p className="small muted">{t("completedWeek", { n: h.completed_week })}</p>
        </section>
      </div>

      {h.reviews.length > 0 && (
        <section className="stack" aria-labelledby="reviews-title">
          <div className="row between">
            <h2 id="reviews-title">{t("reviews.title")}</h2>
            <span className="muted small">{t("reviews.why")}</span>
          </div>
          <div className="grid">
            {h.reviews.map((r) => (
              <div key={r.course_id} className="card row between">
                <div className="stack tight">
                  <strong>{r.course}</strong>
                  <span className="small muted">{t("reviews.count", { n: r.due })}</span>
                </div>
                <ActionButton variant="primary" icon="refresh" action={async () => {
                  const q = await api.post<Quiz>(`/api/courses/${r.course_id}/review`);
                  nav(`/quiz/${q.id}`);
                }}>{t("reviews.start")}</ActionButton>
              </div>
            ))}
          </div>
        </section>
      )}

      {(h.overdue.length > 0 || h.due_soon.length > 0) && (
        <section className="stack" aria-labelledby="due-title">
          <h2 id="due-title">{t("deadlines")}</h2>
          <div className="card" style={{ padding: 0 }}>
            {[...h.overdue.map((x) => ({ ...x, late: true })), ...h.due_soon.map((x) => ({ ...x, late: false }))].map((x) => (
              <Link key={x.topic_id} className="topic-row" to={`/topics/${x.topic_id}`}>
                <Icon name="calendar" style={{ color: x.late ? "var(--bad)" : "var(--warn)" }} />
                <span className="grow stack" style={{ gap: 0 }}>
                  <span className="title">{x.title}</span>
                  <span className="tiny muted">{x.course}</span>
                </span>
                <span className={`pill ${x.late ? "bad" : "warn"}`}>{x.late ? t("common:progress.deadline.overdue") : t("dueOn", { date: fmtDate(x.due_at) })}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {isStaff && (
        <section className="stack" aria-labelledby="teach-title">
          <div className="row between">
            <h2 id="teach-title">{t("teaching.title")}</h2>
            <Link to="/courses" className="small">{t("teaching.all")}</Link>
          </div>
          {teaching.length === 0 ? (
            <p className="muted">{t("teaching.none")}</p>
          ) : (
            <div className="grid">
              {teaching.slice(0, 6).map((c) => (
                <div key={c.id} className="card stack tight">
                  <Link to={`/courses/${c.id}`}><strong>{c.title}</strong></Link>
                  <div className="row tight small">
                    <Link className="btn small" to={`/courses/${c.id}/report`}><Icon name="chart" /> {t("teaching.report")}</Link>
                    <Link className="btn small ghost" to={`/courses/${c.id}/tests`}>{t("teaching.tests")}</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
