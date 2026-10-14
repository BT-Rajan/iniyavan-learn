import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api, ApiError } from "@/api/client";
import type { AttemptResult, Check, Quiz } from "@/api/types";
import { fmtPercent, fmtRelative } from "@/i18n/format";
import { ActionButton, Button, useAction } from "@/ui/controls";
import { AreaPill, LoadError, PageLoading, Stars } from "@/ui/display";
import { useErrorText } from "@/ui/errors";
import { Icon } from "@/ui/icons";

const KEYS = ["1", "2", "3", "4", "5", "6"];

/** Answers survive a refresh or an accidental back-swipe. */
function useStoredAnswers(quizId: number, n: number) {
  const key = `quiz:${quizId}`;
  const read = () => {
    try {
      const v = JSON.parse(sessionStorage.getItem(key) || "null");
      if (Array.isArray(v) && v.length === n) return v as (number | null)[];
    } catch { /* storage may be unavailable */ }
    return Array<number | null>(n).fill(null);
  };
  const [answers, setAnswers] = useState<(number | null)[]>(read);
  useEffect(() => { if (answers.length !== n) setAnswers(read()); }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try { if (answers.some((a) => a !== null)) sessionStorage.setItem(key, JSON.stringify(answers)); } catch { /* ignore */ }
  }, [key, answers]);
  const clear = () => { try { sessionStorage.removeItem(key); } catch { /* ignore */ } };
  return [answers, setAnswers, clear] as const;
}

function Intro({ quiz, onStart }: { quiz: Quiz; onStart: () => void }) {
  const { t } = useTranslation("quiz");
  return (
    <div className="quiz card pad-lg stack" style={{ textAlign: "center", alignItems: "center" }}>
      <span className="pill accent">{t(`kind.${quiz.kind}`)}</span>
      <h1>{quiz.title}</h1>
      <p className="muted">{t("intro.facts", { n: quiz.questions.length, pass: quiz.pass_percent })}</p>
      {quiz.attempts > 0 && (
        <p className="small">
          {t("intro.before", { n: quiz.attempts, best: fmtPercent(quiz.best) })}
          {quiz.latest_attempt && <> · <Link to={`/attempts/${quiz.latest_attempt}`}>{t("intro.seeLast")}</Link></>}
        </p>
      )}
      <p className="small muted">{quiz.mode === "quick" ? t("intro.quickHow") : t("intro.fullHow")}</p>
      <Button variant="primary" size="lg" icon="play" onClick={onStart} autoFocus>{quiz.attempts ? t("intro.retake") : t("intro.start")}</Button>
      <p className="tiny faint">{t("intro.keys")}</p>
    </div>
  );
}

function Result({ quiz, r, onAgain }: { quiz: Quiz; r: AttemptResult; onAgain: () => Promise<void> }) {
  const { t } = useTranslation("quiz");
  const back = quiz.topic_id ? `/topics/${quiz.topic_id}` : `/courses/${quiz.course_id}`;
  const reward = r.reward;
  const strong = r.areas.filter((a) => a.status === "strong");
  const weak = r.areas.filter((a) => a.status !== "strong");
  return (
    <div className="quiz stack" aria-live="polite">
      <section className={`card pad-lg stack ${r.passed ? "hero" : ""}`} style={{ textAlign: "center", alignItems: "center" }}>
        <span className="small muted">{quiz.title}</span>
        <div className="score-big pop">{fmtPercent(r.percent)}</div>
        <strong style={{ fontSize: "1.15rem" }}>
          {r.percent === 100 ? t("result.perfect") : r.passed ? t("result.passed") : t("result.notYet")}
        </strong>
        <span className="muted">{t("result.score", { score: r.score, total: r.total })}</span>
        {reward && (
          <div className="row" style={{ justifyContent: "center" }}>
            {reward.points > 0 && <span className="pill accent pop" style={{ fontSize: "0.9rem" }}><Icon name="bolt" /> {t("result.points", { n: reward.points })}</span>}
            {reward.stars_after > reward.stars_before && (
              <span className="pill pop" style={{ fontSize: "0.9rem", background: "var(--surface)", color: "var(--text)" }}>
                <Stars n={reward.stars_after} /> {t("result.newStar")}
              </span>
            )}
          </div>
        )}
        {reward?.level_up && <div className="notice good pop"><Icon name="sparkle" /><strong>{t("result.levelUp", { level: reward.level })}</strong></div>}
        {r.completed_now && <p className="small">{t("result.completed")}</p>}
        {r.next_review && <p className="small muted">{t("result.nextReview", { when: fmtRelative(r.next_review) })}</p>}
      </section>

      {r.areas.length > 0 && (
        <section className="card stack">
          <h2>{t("result.areas")}</h2>
          {weak.length > 0 && (
            <div className="stack tight">
              <span className="small muted">{t("result.revisit")}</span>
              {weak.map((a) => (
                <div key={a.title + a.unit} className="row between">
                  {a.topic_id ? <Link to={`/topics/${a.topic_id}`}>{a.title || t("result.general")}</Link> : <span>{a.title || t("result.general")}</span>}
                  <span className="row tight"><span className="small num muted">{a.correct}/{a.total}</span><AreaPill status={a.status} /></span>
                </div>
              ))}
            </div>
          )}
          {strong.length > 0 && (
            <div className="stack tight">
              <span className="small muted">{t("result.goodAt")}</span>
              <div className="row tight">{strong.map((a) => <span key={a.title + a.unit} className="pill good">{a.title || t("result.general")}</span>)}</div>
            </div>
          )}
        </section>
      )}

      <div className="row" style={{ justifyContent: "center" }}>
        <Link className="btn" to={`/attempts/${r.attempt_id}`}><Icon name="eye" /> {t("result.review")}</Link>
        <ActionButton icon="refresh" action={onAgain}>{quiz.kind === "test" ? t("result.again") : t("result.newSet")}</ActionButton>
        <Link className="btn primary" to={back}>{quiz.topic_id ? t("result.backTopic") : t("result.backCourse")}</Link>
      </div>
    </div>
  );
}

export default function QuizPlayer() {
  const { t } = useTranslation("quiz");
  const id = Number(useParams().quizId);
  const nav = useNavigate();
  const qc = useQueryClient();
  const err = useErrorText();
  const q = useQuery({ queryKey: ["quiz", id], queryFn: () => api.get<Quiz>(`/api/quizzes/${id}`), staleTime: Infinity });
  const n = q.data?.questions.length ?? 0;
  const [answers, setAnswers, clearStored] = useStoredAnswers(id, n);
  const [i, setI] = useState(0);
  const [startedTest, setStartedTest] = useState(false);
  const [checks, setChecks] = useState<Record<number, Check>>({});
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [flagged, setFlagged] = useState<Record<number, boolean>>({});
  const quick = q.data?.mode === "quick";
  const started = startedTest || (!!q.data && q.data.kind !== "test");

  const check = useAction(async (index: number, answer: number) => {
    const c = await api.post<Check>(`/api/quizzes/${id}/check`, { index, answer });
    setChecks((m) => ({ ...m, [index]: c }));
  });
  const submit = useAction(async () => {
    const r = await api.post<AttemptResult>(`/api/quizzes/${id}/attempts`, { answers });
    clearStored();
    setResult(r);
    window.scrollTo({ top: 0 });
    void qc.invalidateQueries({ queryKey: ["home"] });
    void qc.invalidateQueries({ queryKey: ["course", q.data?.course_id] });
    if (q.data?.topic_id) void qc.invalidateQueries({ queryKey: ["topic", q.data.topic_id] });
  });

  const choose = useCallback((k: number) => {
    if (!q.data || result) return;
    if (quick && (checks[i] || check.busy)) return; // answered: the feedback stays
    setAnswers((a) => a.map((x, j) => (j === i ? k : x)));
    if (quick) void check.run(i, k);
  }, [q.data, result, quick, checks, i, setAnswers, check]);

  const answeredAll = n > 0 && answers.every((a) => a !== null);
  const last = i === n - 1;
  const next = useCallback(() => {
    if (last) { if (answeredAll) void submit.run(); }
    else setI((x) => Math.min(n - 1, x + 1));
  }, [last, answeredAll, submit, n]);

  useEffect(() => {
    if (!started || result) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = KEYS.indexOf(e.key);
      const rtl = document.dir === "rtl";
      if (k >= 0 && q.data && k < q.data.questions[i].options.length) { e.preventDefault(); choose(k); }
      else if (e.key === "Enter" && answers[i] !== null && (!quick || checks[i]) && !(e.target as HTMLElement).closest("button, a")) { e.preventDefault(); next(); }
      else if (!quick && e.key === (rtl ? "ArrowRight" : "ArrowLeft")) setI((x) => Math.max(0, x - 1));
      else if (!quick && e.key === (rtl ? "ArrowLeft" : "ArrowRight")) setI((x) => Math.min(n - 1, x + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started, result, q.data, i, answers, checks, quick, choose, next, n]);

  if (q.isPending) return <div className="page"><PageLoading /></div>;
  if (q.isError) return <div className="page"><LoadError error={q.error} retry={() => void q.refetch()} /></div>;
  const quiz = q.data;
  if (!n) return <div className="page"><LoadError error={new ApiError(400, "quiz.empty")} /></div>;

  const again = async () => {
    if (quiz.kind === "practice" && quiz.topic_id) {
      const fresh = await api.post<Quiz>(`/api/topics/${quiz.topic_id}/practice`, { mode: quiz.mode });
      nav(`/quiz/${fresh.id}`, { replace: true });
      return;
    }
    if (quiz.kind === "review") {
      const fresh = await api.post<Quiz>(`/api/courses/${quiz.course_id}/review`);
      nav(`/quiz/${fresh.id}`, { replace: true });
      return;
    }
    await qc.invalidateQueries({ queryKey: ["quiz", id] });
    setAnswers(Array(n).fill(null));
    setChecks({});
    setResult(null);
    setI(0);
    setStartedTest(true);
  };

  if (result) return <div className="page"><Result quiz={quiz} r={result} onAgain={again} /></div>;
  if (!started) return <div className="page"><Intro quiz={quiz} onStart={() => setStartedTest(true)} /></div>;

  const qn = quiz.questions[i];
  const c = checks[i];
  const left = answers.filter((a) => a === null).length;

  return (
    <div className="page">
      <div className="quiz stack">
        <div className="row between">
          <Link to={quiz.topic_id ? `/topics/${quiz.topic_id}` : `/courses/${quiz.course_id}`} className="small muted row tight">
            <Icon name="x" /> {t("leave")}
          </Link>
          <span className="small muted num" aria-live="polite">{t("progress", { n: i + 1, total: n })}</span>
        </div>
        <div className="quiz-progress">
          {quiz.questions.map((_, j) => {
            const cls = quick && checks[j] ? (checks[j].ok ? "ok" : "wrong") : j === i ? "current" : answers[j] !== null ? "answered" : "";
            return quick
              ? <span key={j} className={cls} aria-hidden />
              : <span key={j} className={cls} role="button" tabIndex={-1} aria-label={t("goTo", { n: j + 1 })} onClick={() => setI(j)} style={{ cursor: "pointer" }} />;
          })}
        </div>

        <section className="card pad-lg stack" aria-labelledby="qtext">
          {qn.topic && <span className="pill" style={{ alignSelf: "flex-start" }}>{qn.topic}</span>}
          <h1 id="qtext" style={{ fontSize: "1.25rem", lineHeight: 1.4 }}>{qn.text}</h1>
          {qn.image && <img src={qn.image} alt="" style={{ maxBlockSize: 280, objectFit: "contain", alignSelf: "flex-start", borderRadius: 8 }} />}
          <div role="group" aria-label={t("choices")}>
            {qn.options.map((o, k) => {
              const picked = answers[i] === k;
              const state = c ? (k === c.correct ? "ok" : picked ? "wrong" : "") : "";
              return (
                <button key={k} type="button" className={`choice ${state}`} aria-pressed={picked} disabled={!!c || (quick && check.busy)} onClick={() => choose(k)}>
                  <span className="key">
                    {state === "ok" ? <Icon name="check" style={{ inlineSize: 14, blockSize: 14 }} /> : state === "wrong" ? <Icon name="x" style={{ inlineSize: 14, blockSize: 14 }} /> : k + 1}
                  </span>
                  <span className="grow stack tight">
                    {o.text && <span>{o.text}</span>}
                    {o.image && <img src={o.image} alt="" />}
                  </span>
                </button>
              );
            })}
          </div>

          {quick && check.busy && <span className="status"><span className="spin" style={{ inlineSize: 12, blockSize: 12 }} /> {t("checking")}</span>}
          {check.state === "error" && <span className="status err">{err(check.error)}</span>}
          {c && (
            <div className={`notice ${c.ok ? "good" : "bad"} fade-in`} role="status">
              <Icon name={c.ok ? "check" : "x"} />
              <div className="grow">
                <strong>{c.ok ? t("right") : t("wrong", { answer: qn.options[c.correct]?.text ?? "" })}</strong>
                {c.explanation && <span>{c.explanation}</span>}
              </div>
            </div>
          )}
        </section>

        <div className="row between">
          <div className="row tight">
            {!quick && (
              <button type="button" className="btn ghost" disabled={i === 0} onClick={() => setI(i - 1)}>
                <Icon name="chevronLeft" className="flip" /> {t("common:actions.previous")}
              </button>
            )}
            {quiz.kind !== "test" && (
              flagged[qn.id]
                ? <span className="small muted">{t("flagged")}</span>
                : <ActionButton size="small" variant="ghost" icon="flag" action={async () => { await api.post(`/api/quizzes/${id}/questions/${qn.id}/flag`); setFlagged((f) => ({ ...f, [qn.id]: true })); }}>{t("flag")}</ActionButton>
            )}
          </div>
          <div className="row tight">
            {!quick && last && !answeredAll && <span className="small muted">{t("left", { n: left })}</span>}
            {last ? (
              <Button variant="primary" busy={submit.busy} disabled={!answeredAll || (quick && !c)} onClick={() => void submit.run()}>{t("finish")}</Button>
            ) : (
              <Button variant="primary" disabled={answers[i] === null || (quick && !c)} onClick={next}>{t("common:actions.next")}</Button>
            )}
          </div>
        </div>
        {submit.state === "error" && <p className="status err" style={{ justifyContent: "flex-end" }}>{err(submit.error)}</p>}
      </div>
    </div>
  );
}
