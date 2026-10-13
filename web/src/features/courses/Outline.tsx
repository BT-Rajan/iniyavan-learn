import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import type { Course, OutlineTopic, OutlineUnit, Quiz } from "@/api/types";
import { fmtDate } from "@/i18n/format";
import { ActionButton, Button, InlineText, SaveStatus, Segmented, Switch, useAction, UndoBar, useSortable, useUndo } from "@/ui/controls";
import { Empty, Stars } from "@/ui/display";
import { Icon } from "@/ui/icons";

import { useCourse, usePatchCourse } from "./useCourse";

type Patch = ReturnType<typeof usePatchCourse>;

function mapUnits(c: Course, fn: (u: OutlineUnit) => OutlineUnit): Course {
  return { ...c, units: c.units.map(fn) };
}

function TopicState({ t: topic, n }: { t: OutlineTopic; n: number }) {
  const { t } = useTranslation();
  const s = topic.status ?? "not_started";
  return (
    <span className={`state ${s}`} aria-label={t(`progress.topicStatus.${s}`)} role="img">
      {s === "completed" ? <Icon name="check" style={{ inlineSize: 14, blockSize: 14 }} /> : n}
    </span>
  );
}

function DeadlinePill({ t: topic }: { t: OutlineTopic }) {
  const { t } = useTranslation();
  if (!topic.deadline || topic.deadline === "on_time") return null;
  const tone = topic.deadline === "overdue" ? "bad" : topic.deadline === "upcoming" ? "" : "warn";
  return <span className={`pill ${tone}`}>{t(`progress.deadline.${topic.deadline}`, { date: fmtDate(topic.due_at) })}</span>;
}

/** What a learner sees: their place in the course and one obvious next step. */
function StudyUnit({ unit, start }: { unit: OutlineUnit; start: number }) {
  const { t } = useTranslation("courses");
  const topics = unit.topics.filter((x) => x.published && !x.archived);
  if (!topics.length) return null;
  const done = topics.filter((x) => x.status === "completed").length;
  return (
    <section className="unit" aria-labelledby={`u${unit.id}`}>
      <div className="unit-head">
        <h2 id={`u${unit.id}`}>{unit.title}</h2>
        <span className="small muted num">{t("outline.unitDone", { done, total: topics.length })}</span>
      </div>
      {topics.map((x, i) => (
        <Link key={x.id} to={`/topics/${x.id}`} className="topic-row">
          <TopicState t={x} n={start + i} />
          <span className="grow stack" style={{ gap: 0 }}>
            <span className="title">{x.title}</span>
            {x.summary && <span className="small muted clip">{x.summary}</span>}
          </span>
          {x.review_now && <span className="pill accent"><Icon name="refresh" style={{ inlineSize: 12, blockSize: 12 }} /> {t("outline.review")}</span>}
          <DeadlinePill t={x} />
          {(x.stars ?? 0) > 0 && <Stars n={x.stars ?? 0} />}
        </Link>
      ))}
    </section>
  );
}

/** One line to add something: type, Enter, keep typing the next one. */
function QuickAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (title: string) => Promise<unknown> }) {
  const { t } = useTranslation();
  const [v, setV] = useState("");
  const a = useAction(onAdd, { doneFor: 900 });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (v.trim() && (await a.run(v.trim()))) setV("");
  };
  return (
    <form className="add-row" onSubmit={submit}>
      <Icon name="plus" style={{ color: "var(--faint)", alignSelf: "center" }} />
      <input type="text" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={placeholder} maxLength={200}
             style={{ border: "1px dashed var(--line-strong)", background: "transparent" }} />
      {v.trim() && <Button type="submit" size="small" variant="primary" busy={a.busy}>{t("actions.add")}</Button>}
      {a.state === "error" && <SaveStatus state="error" error={a.error} />}
    </form>
  );
}

function EditUnit({ unit, course, patch, undo, showArchived, onError }: {
  unit: OutlineUnit; course: Course; patch: Patch; undo: ReturnType<typeof useUndo>; showArchived: boolean; onError: (e: unknown) => void;
}) {
  const { t } = useTranslation("courses");
  const visible = unit.topics.filter((x) => showArchived || !x.archived);
  const sort = useSortable(visible.map((x) => x.id), async (ids) => {
    const order = [...ids, ...unit.topics.filter((x) => !ids.includes(x.id)).map((x) => x.id)];
    patch.set((c) => mapUnits(c, (u) => (u.id === unit.id ? { ...u, topics: order.map((id) => u.topics.find((x) => x.id === id)!) } : u)));
    try {
      await api.put(`/api/units/${unit.id}/topics/order`, { ids: order });
    } catch (e) {
      onError(e);
      void patch.refresh();
    }
  });
  const setTopic = (id: number, change: Partial<OutlineTopic>) =>
    patch.set((c) => mapUnits(c, (u) => (u.id === unit.id ? { ...u, topics: u.topics.map((x) => (x.id === id ? { ...x, ...change } : x)) } : u)));

  const archiveTopic = async (x: OutlineTopic) => {
    await api.put(`/api/topics/${x.id}/archive`, { archived: true });
    setTopic(x.id, { archived: true });
    undo.offer(t("outline.topicArchived", { title: x.title }), async () => {
      await api.put(`/api/topics/${x.id}/archive`, { archived: false });
      setTopic(x.id, { archived: false });
    });
  };
  const publish = async (x: OutlineTopic, published: boolean) => {
    setTopic(x.id, { published });
    try {
      await api.patch(`/api/topics/${x.id}`, { published });
    } catch (e) {
      setTopic(x.id, { published: !published });
      onError(e);
    }
  };

  return (
    <>
      {visible.map((x) => {
        const row = sort.row(x.id);
        return (
          <div key={x.id} {...row} className={`topic-row ${x.published ? "" : "draft"} ${row.className}`} style={{ opacity: x.archived ? 0.55 : 1 }}>
            <button type="button" {...sort.handle(x.id, t("common:actions.reorder"))}><Icon name="grip" /></button>
            <span className="grow stack" style={{ gap: 0 }}>
              <Link to={`/topics/${x.id}`} className="title" style={{ color: "inherit" }}>{x.title}</Link>
              {x.summary && <span className="small muted clip">{x.summary}</span>}
            </span>
            {x.due_at && <span className="pill">{t("common:progress.deadline.upcoming", { date: fmtDate(x.due_at) })}</span>}
            {x.archived ? (
              <ActionButton size="small" variant="ghost" icon="undo" action={async () => { await api.put(`/api/topics/${x.id}/archive`, { archived: false }); setTopic(x.id, { archived: false }); }}>
                {t("common:actions.restore")}
              </ActionButton>
            ) : (
              <>
                {course.kind === "catalog" && (
                  <Switch checked={x.published} onChange={(v) => void publish(x, v)}
                          label={<span className="small muted">{x.published ? t("common:status.published") : t("common:status.draft")}</span>} />
                )}
                <Link className="btn small ghost icon-only" to={`/topics/${x.id}?edit=1`} aria-label={t("outline.editTopic", { title: x.title })} title={t("common:actions.edit")}>
                  <Icon name="edit" />
                </Link>
                <ActionButton size="small" variant="ghost" icon="archive" title={t("common:actions.archive")} action={() => archiveTopic(x)}>{null}</ActionButton>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

function EditOutline({ course }: { course: Course }) {
  const { t } = useTranslation("courses");
  const patch = usePatchCourse(course.id);
  const qc = useQueryClient();
  const undo = useUndo();
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const units = course.units.filter((u) => showArchived || !u.archived);
  const anyArchived = course.units.some((u) => u.archived || u.topics.some((x) => x.archived));
  const sortUnits = useSortable(units.map((u) => u.id), async (ids) => {
    const order = [...ids, ...course.units.filter((u) => !ids.includes(u.id)).map((u) => u.id)];
    patch.set((c) => ({ ...c, units: order.map((id) => c.units.find((u) => u.id === id)!) }));
    try {
      await api.put(`/api/courses/${course.id}/units/order`, { ids: order });
    } catch (e) {
      setError(e);
      void patch.refresh();
    }
  });
  const setUnit = (id: number, change: Partial<OutlineUnit>) => patch.set((c) => mapUnits(c, (u) => (u.id === id ? { ...u, ...change } : u)));
  const addTopic = (unit: OutlineUnit) => async (title: string) => {
    const r = await api.post<{ id: number; published?: boolean }>(`/api/units/${unit.id}/topics`, { title });
    patch.set((c) => mapUnits(c, (u) => (u.id === unit.id
      ? { ...u, topics: [...u.topics, { id: r.id, title, summary: "", published: r.published ?? course.kind === "personal", archived: false, due_at: null }] }
      : u)));
    void qc.invalidateQueries({ queryKey: ["course", course.id] });
  };
  const addUnit = async (title: string) => {
    const u = await api.post<OutlineUnit>(`/api/courses/${course.id}/units`, { title });
    patch.set((c) => ({ ...c, units: [...c.units, u] }));
  };
  const archiveUnit = async (u: OutlineUnit) => {
    await api.put(`/api/units/${u.id}/archive`, { archived: true });
    setUnit(u.id, { archived: true });
    undo.offer(t("outline.unitArchived", { title: u.title }), async () => {
      await api.put(`/api/units/${u.id}/archive`, { archived: false });
      setUnit(u.id, { archived: false });
    });
  };

  return (
    <div className="stack">
      <div className="row between">
        <p className="small muted">{course.kind === "catalog" ? t("outline.editHintCatalog") : t("outline.editHint")}</p>
        {anyArchived && <Switch checked={showArchived} onChange={setShowArchived} label={<span className="small">{t("outline.showArchived")}</span>} />}
      </div>
      {error ? <SaveStatus state="error" error={error} /> : null}
      <UndoBar undo={undo} />
      {units.map((u) => {
        const row = sortUnits.row(u.id);
        return (
          <section key={u.id} {...row} className={`unit ${row.className}`} style={{ opacity: u.archived ? 0.6 : 1 }}>
            <div className="unit-head">
              <button type="button" {...sortUnits.handle(u.id, t("common:actions.reorder"))}><Icon name="grip" /></button>
              <InlineText as="h2" value={u.title} label={t("outline.renameUnit")}
                          onSave={async (title) => { await api.patch(`/api/units/${u.id}`, { title }); setUnit(u.id, { title }); }} />
              {u.archived ? (
                <ActionButton size="small" variant="ghost" icon="undo" action={async () => { await api.put(`/api/units/${u.id}/archive`, { archived: false }); setUnit(u.id, { archived: false }); }}>
                  {t("common:actions.restore")}
                </ActionButton>
              ) : (
                <ActionButton size="small" variant="ghost" icon="archive" title={t("outline.archiveUnit")} action={() => archiveUnit(u)}>{null}</ActionButton>
              )}
            </div>
            <EditUnit unit={u} course={course} patch={patch} undo={undo} showArchived={showArchived} onError={setError} />
            {!u.archived && <QuickAdd placeholder={t("outline.addTopic")} onAdd={addTopic(u)} />}
          </section>
        );
      })}
      <div className="unit" style={{ borderStyle: "dashed" }}>
        <QuickAdd placeholder={t("outline.addUnit")} onAdd={addUnit} />
      </div>
    </div>
  );
}

export default function Outline() {
  const { t } = useTranslation("courses");
  const { course } = useCourse();
  const nav = useNavigate();
  const [mode, setMode] = useState<"study" | "edit">(() => (course.can_edit && !course.progress ? "edit" : "study"));
  const editing = course.can_edit && mode === "edit";
  const p = course.progress;
  const empty = !course.units.some((u) => u.topics.some((x) => x.published && !x.archived));
  let n = 1;

  return (
    <div className="stack">
      <div className="row between">
        <div className="row">
          {p?.next && !editing && (
            <Link className="btn primary" to={`/topics/${p.next.id}`}><Icon name="play" className="flip" /> {p.completed ? t("outline.continue") : t("outline.start")}</Link>
          )}
          {p && p.reviews_due > 0 && !editing && (
            <ActionButton icon="refresh" action={async () => { const q = await api.post<Quiz>(`/api/courses/${course.id}/review`); nav(`/quiz/${q.id}`); }}>
              {t("outline.reviewDue", { n: p.reviews_due })}
            </ActionButton>
          )}
        </div>
        {course.can_edit && p && (
          <Segmented label={t("outline.mode")} value={mode} onChange={setMode}
                     options={[{ value: "study", label: t("outline.study") }, { value: "edit", label: t("outline.edit") }]} />
        )}
      </div>
      {editing ? <EditOutline course={course} /> : empty ? (
        <Empty icon="book" title={t("outline.emptyTitle")}>{course.can_edit ? t("outline.emptyEditor") : t("outline.empty")}</Empty>
      ) : (
        course.units.filter((u) => !u.archived).map((u) => {
          const start = n;
          n += u.topics.filter((x) => x.published && !x.archived).length;
          return <StudyUnit key={u.id} unit={u} start={start} />;
        })
      )}
    </div>
  );
}
