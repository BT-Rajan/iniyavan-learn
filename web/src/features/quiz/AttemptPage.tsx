import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { api } from "@/api/client";
import type { AttemptDetail } from "@/api/types";
import { useMe } from "@/app/session";
import { fmtDateTime, fmtPercent } from "@/i18n/format";
import { Segmented } from "@/ui/controls";
import { AreaPill, Crumbs, LoadError, Notice, PageLoading } from "@/ui/display";
import { Icon } from "@/ui/icons";

/** One attempt, question by question: what was chosen and (when the test allows) what was right. */
export default function AttemptPage() {
  const { t } = useTranslation("quiz");
  const id = Number(useParams().attemptId);
  const me = useMe();
  const q = useQuery({ queryKey: ["attempt", id], queryFn: () => api.get<AttemptDetail>(`/api/attempts/${id}`) });
  const [show, setShow] = useState<"all" | "wrong">("all");
  if (q.isPending) return <div className="page"><PageLoading /></div>;
  if (q.isError) return <div className="page"><LoadError error={q.error} retry={() => void q.refetch()} /></div>;
  const a = q.data;
  const qs = a.questions.filter((x) => show === "all" || !x.ok);
  const someoneElse = a.user_id !== me.id;

  return (
    <div className="page">
      <div className="quiz stack">
        <header className="stack tight">
          <Crumbs items={[{ to: `/quiz/${a.quiz_id}`, label: a.title }, { label: t("attempt.crumb") }]} />
          <h1>{someoneElse ? t("attempt.titleOf", { name: a.user }) : t("attempt.title")}</h1>
          <p className="muted">{fmtDateTime(a.at)}</p>
        </header>

        <section className="card row between">
          <div className="row" style={{ gap: 18 }}>
            <span className="score-big" style={{ fontSize: "2.2rem" }}>{fmtPercent(a.percent)}</span>
            <div className="stack tight">
              <strong>{a.passed ? t("result.passed") : t("result.notYet")}</strong>
              <span className="small muted">{t("result.score", { score: a.score, total: a.total })} · {t("attempt.pass", { n: a.pass_percent })}</span>
            </div>
          </div>
          {!someoneElse && a.kind === "test" && <Link className="btn" to={`/quiz/${a.quiz_id}`}><Icon name="refresh" /> {t("result.again")}</Link>}
        </section>

        {a.changed > 0 && <Notice tone="warn" icon="edit">{t("attempt.changed", { n: a.changed })}</Notice>}
        {!a.reveal && <Notice icon="eyeOff">{t("attempt.hidden")}</Notice>}

        {a.areas.length > 0 && (
          <section className="card stack tight">
            <h2>{t("result.areas")}</h2>
            {a.areas.map((x) => (
              <div key={x.title + x.unit} className="row between">
                {x.topic_id && !someoneElse ? <Link to={`/topics/${x.topic_id}`}>{x.title || t("result.general")}</Link> : <span>{x.title || t("result.general")}</span>}
                <span className="row tight"><span className="small muted num">{x.correct}/{x.total}</span><AreaPill status={x.status} /></span>
              </div>
            ))}
          </section>
        )}

        <div className="row between">
          <h2>{t("attempt.questions")}</h2>
          <Segmented label={t("attempt.filter")} value={show} onChange={setShow}
                     options={[{ value: "all", label: t("attempt.all", { n: a.questions.length }) }, { value: "wrong", label: t("attempt.wrongOnly", { n: a.questions.filter((x) => !x.ok).length }) }]} />
        </div>
        {qs.map((x) => (
          <section key={x.id} className="card stack" aria-label={x.text}>
            <div className="row nowrap" style={{ alignItems: "flex-start" }}>
              <Icon name={x.ok ? "check" : "x"} style={{ color: x.ok ? "var(--good)" : "var(--bad)", marginBlockStart: 3 }} label={x.ok ? t("right") : t("attempt.wrongShort")} />
              <div className="grow stack tight">
                <strong>{x.text}</strong>
                {x.topic && <span className="tiny muted">{x.topic}</span>}
              </div>
            </div>
            {x.image && <img src={x.image} alt="" style={{ maxBlockSize: 220, objectFit: "contain", alignSelf: "flex-start" }} />}
            <div>
              {x.options.map((o, k) => {
                const cls = a.reveal && k === x.correct ? "ok" : k === x.chosen && !x.ok ? "wrong" : k === x.chosen ? "ok" : "";
                return (
                  <div key={k} className={`choice ${cls}`} aria-current={k === x.chosen || undefined} style={{ cursor: "default" }}>
                    <span className="key">{k + 1}</span>
                    <span className="grow">{o.text}{o.image && <img src={o.image} alt="" />}</span>
                    {k === x.chosen && <span className="tiny muted">{t("attempt.yourAnswer")}</span>}
                  </div>
                );
              })}
            </div>
            {a.reveal && x.explanation && <p className="small muted">{x.explanation}</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
