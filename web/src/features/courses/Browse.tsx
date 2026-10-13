import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import type { Browse as BrowseData, CourseCard, Program } from "@/api/types";
import { useSession } from "@/app/session";
import { Button, Field, useAction } from "@/ui/controls";
import { Empty, LoadError, PageHead, PageLoading } from "@/ui/display";
import { useErrorText, useFieldError } from "@/ui/errors";
import { Icon } from "@/ui/icons";

function Card({ c }: { c: CourseCard }) {
  const { t } = useTranslation("courses");
  const setup = c.status === "setup";
  return (
    <Link className="card link stack tight" to={setup && c.can_edit ? `/studio/${c.id}` : `/courses/${c.id}`}>
      <div className="row between nowrap">
        <strong className="clip">{c.title}</strong>
        {setup ? <span className="pill warn">{t("card.setup")}</span> : c.can_edit && <span className="pill accent">{t("card.canEdit")}</span>}
      </div>
      {c.description && <p className="small muted" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{c.description}</p>}
      <span className="tiny faint">
        {c.kind === "personal" ? (c.mine ? t("card.yours") : t("card.sharedBy", { name: c.owner })) : c.owner ? t("card.teacher", { name: c.owner }) : t("card.noTeacher")}
        {c.shared_from && <> · {t("card.sharedFrom", { term: c.shared_from })}</>}
      </span>
    </Link>
  );
}

/** Admins add a catalog course right here: title, term, teacher. */
function NewCourse({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("courses");
  const qc = useQueryClient();
  const nav = useNavigate();
  const programs = useQuery({ queryKey: ["programs"], queryFn: () => api.get<Program[]>("/api/programs") });
  const faculty = useQuery({ queryKey: ["faculty"], queryFn: () => api.get<{ id: number; name: string }[]>("/api/users/faculty") });
  const [title, setTitle] = useState("");
  const [term, setTerm] = useState("");
  const [owner, setOwner] = useState("");
  const fe = useFieldError();
  const err = useErrorText();
  const create = useAction(() => api.post<CourseCard>("/api/courses", { title: title.trim(), term_id: Number(term), owner_id: owner ? Number(owner) : null }), {
    onDone: (c) => { void qc.invalidateQueries({ queryKey: ["browse"] }); nav(`/courses/${c.id}`); },
  });
  return (
    <form className="card stack fade-in" onSubmit={(e) => { e.preventDefault(); void create.run(); }}>
      <div className="row between"><h2>{t("new.title")}</h2><Button variant="ghost" size="small" icon="x" aria-label={t("common:actions.close")} onClick={onClose} /></div>
      <div className="grid">
        <Field label={t("new.name")} error={fe(create.error, "title")}>
          {(id) => <input id={id} type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus maxLength={200} />}
        </Field>
        <Field label={t("new.term")} error={fe(create.error, "term_id")}>
          {(id) => (
            <select id={id} value={term} onChange={(e) => setTerm(e.target.value)}>
              <option value="">{t("new.pickTerm")}</option>
              {(programs.data ?? []).filter((p) => !p.archived).map((p) => (
                <optgroup key={p.id} label={p.name}>
                  {p.terms.filter((x) => !x.archived).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </optgroup>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("new.teacher")} hint={t("new.teacherHint")}>
          {(id) => (
            <select id={id} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">{t("new.noTeacher")}</option>
              {(faculty.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
        </Field>
      </div>
      {programs.data?.length === 0 && <p className="small muted">{t("new.noPrograms")} <Link to="/admin/programs">{t("new.addProgram")}</Link></p>}
      <div className="row">
        <Button type="submit" variant="primary" busy={create.busy} disabled={!title.trim() || !term}>{t("new.create")}</Button>
        {create.state === "error" && !fe(create.error, "title") && <span className="status err">{err(create.error)}</span>}
      </div>
    </form>
  );
}

export default function Browse() {
  const { t } = useTranslation("courses");
  const { isAdmin } = useSession();
  const q = useQuery({ queryKey: ["browse"], queryFn: () => api.get<BrowseData>("/api/browse") });
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const f = filter.trim().toLowerCase();
  const match = (c: CourseCard) => !f || c.title.toLowerCase().includes(f) || c.owner.toLowerCase().includes(f);
  const groups = useMemo(() => (q.data?.terms ?? []).map((g) => ({ ...g, courses: g.courses.filter(match) })).filter((g) => g.courses.length), [q.data, f]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = (q.data?.personal ?? []).filter((c) => c.mine && match(c));
  const shared = (q.data?.personal ?? []).filter((c) => !c.mine && match(c));
  const total = (q.data?.terms ?? []).reduce((n, g) => n + g.courses.length, 0) + (q.data?.personal.length ?? 0);
  const programs = new Set(groups.map((g) => g.program_id)).size;

  return (
    <div className="page">
      <PageHead title={t("browse.title")} sub={t("browse.sub")} actions={
        <>
          {total > 6 && (
            <input type="search" placeholder={t("browse.filter")} aria-label={t("browse.filter")} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ inlineSize: 220 }} />
          )}
          {isAdmin && !adding && <Button icon="plus" onClick={() => setAdding(true)}>{t("browse.newCatalog")}</Button>}
          <Link className="btn primary" to="/studio/new"><Icon name="sparkle" /> {t("browse.fromNotes")}</Link>
        </>
      } />
      {adding && <div style={{ marginBlockEnd: 24 }}><NewCourse onClose={() => setAdding(false)} /></div>}
      {q.isPending ? <PageLoading /> : q.isError ? <LoadError error={q.error} retry={() => void q.refetch()} /> : (
        <div className="stack loose">
          {total === 0 && (
            <Empty icon="book" title={t("browse.emptyTitle")} action={<Link className="btn primary" to="/studio/new">{t("browse.fromNotes")}</Link>}>{t("browse.empty")}</Empty>
          )}
          {mine.length > 0 && (
            <section className="stack">
              <h2>{t("browse.mine")}</h2>
              <div className="grid">{mine.map((c) => <Card key={c.id} c={c} />)}</div>
            </section>
          )}
          {groups.map((g) => (
            <section key={g.term_id} className="stack">
              <h2>
                {programs > 1 && <span className="muted">{g.program} · </span>}
                {g.term}
                {g.current && <span className="pill accent" style={{ marginInlineStart: 8, verticalAlign: "middle" }}>{t("browse.current")}</span>}
              </h2>
              <div className="grid">{g.courses.map((c) => <Card key={c.id} c={c} />)}</div>
            </section>
          ))}
          {shared.length > 0 && (
            <section className="stack">
              <h2>{t("browse.classmates")}</h2>
              <div className="grid">{shared.map((c) => <Card key={c.id} c={c} />)}</div>
            </section>
          )}
          {f && !groups.length && !mine.length && !shared.length && <p className="muted">{t("browse.noMatch", { q: filter })}</p>}
        </div>
      )}
    </div>
  );
}
