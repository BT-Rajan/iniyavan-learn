import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { api } from "@/api/client";
import type { AiStatus, AiText, Quiz, Topic } from "@/api/types";
import { fmtDate, fmtRelative } from "@/i18n/format";
import { ActionButton, Button, useAction } from "@/ui/controls";
import { Content, Crumbs, LoadError, Notice, PageLoading, Skeleton, Stars } from "@/ui/display";
import { useErrorText } from "@/ui/errors";
import { Icon } from "@/ui/icons";

import { TopicEditor } from "./TopicEditor";

export const topicKey = (id: number) => ["topic", id] as const;

/** An AI answer that opens in place under its button, and stays open while you read. */
function AiPanel({ title, url, onClose }: { title: string; url: string; onClose: () => void }) {
  const { t } = useTranslation("topic");
  const err = useErrorText();
  const q = useQuery({ queryKey: ["ai", url], queryFn: () => api.get<AiText>(url), staleTime: Infinity, retry: false });
  return (
    <section className="card panel fade-in stack" aria-live="polite" aria-busy={q.isPending}>
      <div className="row between">
        <h2 className="row tight"><Icon name="sparkle" style={{ color: "var(--accent)" }} /> {title}</h2>
        <Button variant="ghost" size="small" icon="x" aria-label={t("common:actions.close")} onClick={onClose} />
      </div>
      {q.isPending ? (
        <div className="stack tight"><Skeleton w="70%" /><Skeleton /><Skeleton w="85%" /><Skeleton w="60%" /><span className="small muted">{t("ai.thinking")}</span></div>
      ) : q.isError ? (
        <div className="row"><span className="status err">{err(q.error)}</span><Button size="small" icon="refresh" onClick={() => void q.refetch()}>{t("common:actions.retry")}</Button></div>
      ) : (
        <>
          <Content text={q.data.text} />
          <p className="tiny faint">{t("ai.disclaimer")}</p>
        </>
      )}
      {q.isSuccess && <span className="sr-only">{t("ai.ready")}</span>}
    </section>
  );
}

function StudyTools({ topic, ai }: { topic: Topic; ai?: AiStatus }) {
  const { t } = useTranslation("topic");
  const nav = useNavigate();
  const qc = useQueryClient();
  const err = useErrorText();
  const [celebrate, setCelebrate] = useState(false);
  const complete = useAction(async (done: boolean) => {
    const r = await api.put<Pick<Topic, "status" | "completed_at" | "stars" | "deadline">>(`/api/topics/${topic.id}/completed`, { completed: done });
    qc.setQueryData<Topic>(topicKey(topic.id), (x) => (x ? { ...x, ...r } : x));
    void qc.invalidateQueries({ queryKey: ["course", topic.course_id] });
    void qc.invalidateQueries({ queryKey: ["home"] });
    setCelebrate(done);
  });
  const practice = (mode: "quick" | "full") => async () => {
    const q = await api.post<Quiz>(`/api/topics/${topic.id}/practice`, { mode });
    nav(`/quiz/${q.id}`);
  };
  const done = topic.status === "completed";
  const aiOff = ai && !ai.available;

  return (
    <aside className="topic-side" aria-label={t("tools.label")}>
      {topic.tracked && (
        <section className="card stack">
          <div className="row between">
            <strong>{done ? t("tools.done") : t("tools.notDone")}</strong>
            <Stars n={topic.stars} />
          </div>
          <Button variant={done ? "default" : "primary"} icon={done ? "check" : undefined} busy={complete.busy} block onClick={() => void complete.run(!done)}
                  aria-pressed={done}>
            {done ? t("tools.markedDone") : t("tools.markDone")}
          </Button>
          {complete.state === "error" && <span className="status err">{err(complete.error)}</span>}
          {celebrate && done && (
            <div className="notice good pop" role="status">
              <Icon name="star" style={{ color: "var(--star)" }} />
              <span className="grow">
                <strong>{t("tools.niceWork")}</strong>
                <span className="small">{topic.next ? t("tools.nextIs", { title: topic.next.title }) : t("tools.lastTopic")}</span>
              </span>
              {topic.next && <Link className="btn small primary" to={`/topics/${topic.next.id}`}>{t("common:actions.next")}</Link>}
            </div>
          )}
          {topic.review_now && <Notice tone="info" icon="refresh">{t("tools.reviewNow")}</Notice>}
          {!topic.review_now && topic.review_due && <p className="tiny muted">{t("tools.reviewOn", { when: fmtRelative(topic.review_due) })}</p>}
        </section>
      )}

      {topic.tracked && (
        <section className="card stack">
          <div className="stack tight">
            <strong>{t("tools.checkTitle")}</strong>
            <span className="small muted">{t("tools.checkHint")}</span>
          </div>
          <ActionButton variant={done ? "primary" : "default"} icon="bolt" block disabled={aiOff} action={practice("quick")}>{t("tools.quick")}</ActionButton>
          <ActionButton icon="target" block disabled={aiOff} action={practice("full")}>{t("tools.full")}</ActionButton>
          {aiOff && <span className="small muted">{ai?.needs_own_key ? <Link to="/profile">{t("ai.addKey")}</Link> : t("ai.off")}</span>}
          {ai?.left != null && ai.left <= 5 && <span className="small" style={{ color: "var(--warn)" }}>{t("ai.left", { n: ai.left })}</span>}
        </section>
      )}
    </aside>
  );
}

export default function TopicPage() {
  const { t } = useTranslation("topic");
  const id = Number(useParams().topicId);
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: topicKey(id), queryFn: () => api.get<Topic>(`/api/topics/${id}`) });
  const ai = useQuery({ queryKey: ["ai-status"], queryFn: () => api.get<AiStatus>("/api/ai/status"), staleTime: 60_000 });
  const [panel, setPanel] = useState<"explain" | "answer" | null>(null);
  const editing = params.get("edit") === "1";

  if (q.isPending) return <div className="page"><PageLoading /></div>;
  if (q.isError) return <div className="page"><LoadError error={q.error} retry={() => void q.refetch()} /></div>;
  const topic = q.data;
  const setEditing = (on: boolean) => setParams(on ? { edit: "1" } : {}, { replace: true });
  if (editing && topic.can_edit) return <div className="page"><TopicEditor topic={topic} onDone={() => setEditing(false)} /></div>;

  const hasExam = topic.question_pattern || topic.answer_guide || topic.sample_answer;
  const aiReady = ai.data?.available;

  return (
    <div className="page">
      <div className="topic-layout">
        <article className="stack">
          <header className="stack tight">
            <Crumbs items={[{ to: `/courses/${topic.course_id}`, label: topic.course }, { label: topic.unit }]} />
            <div className="row between nowrap" style={{ alignItems: "flex-start" }}>
              <h1>{topic.title}</h1>
              {topic.can_edit && <Button icon="edit" onClick={() => setEditing(true)}>{t("common:actions.edit")}</Button>}
            </div>
            <div className="row small muted">
              {topic.position && <span>{t("position", { n: topic.position, total: topic.total })}</span>}
              {!topic.published && <span className="pill warn">{t("common:status.draft")}</span>}
              {topic.archived && <span className="pill">{t("common:status.archived")}</span>}
              {topic.deadline && topic.deadline !== "on_time" && (
                <span className={`pill ${topic.deadline === "overdue" ? "bad" : "warn"}`}>{t(`common:progress.deadline.${topic.deadline}`, { date: fmtDate(topic.due_at) })}</span>
              )}
            </div>
            {topic.summary && <p className="muted" style={{ fontSize: "1.05rem" }}>{topic.summary}</p>}
          </header>

          {aiReady && (
            <div className="row">
              <Button icon="sparkle" aria-expanded={panel === "explain"} onClick={() => setPanel(panel === "explain" ? null : "explain")}>{t("ai.explain")}</Button>
              {hasExam && <Button icon="file" aria-expanded={panel === "answer"} onClick={() => setPanel(panel === "answer" ? null : "answer")}>{t("ai.modelAnswer")}</Button>}
            </div>
          )}
          {panel === "explain" && <AiPanel title={t("ai.explainTitle")} url={`/api/topics/${id}/explain`} onClose={() => setPanel(null)} />}
          {panel === "answer" && <AiPanel title={t("ai.answerTitle")} url={`/api/topics/${id}/model-answer`} onClose={() => setPanel(null)} />}

          <div className="reading">
            {topic.content.trim() ? <Content text={topic.content} format={topic.content_format} /> : <p className="muted">{t("noContent")}</p>}
          </div>

          {hasExam && (
            <details className="disclosure card">
              <summary>{t("exam.title")}</summary>
              <div className="stack" style={{ marginBlockStart: 12 }}>
                {topic.question_pattern && <div className="stack tight"><strong className="small">{t("exam.pattern")}</strong><Content text={topic.question_pattern} /></div>}
                {topic.answer_guide && <div className="stack tight"><strong className="small">{t("exam.guide")}</strong><Content text={topic.answer_guide} /></div>}
                {topic.sample_answer && <div className="stack tight"><strong className="small">{t("exam.sample")}</strong><Content text={topic.sample_answer} /></div>}
              </div>
            </details>
          )}

          <nav className="pager" aria-label={t("pager")}>
            {topic.prev && (
              <Link to={`/topics/${topic.prev.id}`}>
                <span className="tiny muted">{t("common:actions.previous")}</span>
                <span className="clip">{topic.prev.title}</span>
              </Link>
            )}
            {topic.next && (
              <Link className="next" to={`/topics/${topic.next.id}`}>
                <span className="tiny muted">{t("common:actions.next")}</span>
                <span className="clip">{topic.next.title}</span>
              </Link>
            )}
          </nav>
        </article>
        <StudyTools topic={topic} ai={ai.data} />
      </div>
    </div>
  );
}
