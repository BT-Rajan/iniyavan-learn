import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useParams } from "react-router-dom";

import { api } from "@/api/client";
import { useSession } from "@/app/session";
import { InlineText } from "@/ui/controls";
import { Crumbs, LoadError, PageLoading, Ring } from "@/ui/display";

import { useCourseQuery, usePatchCourse } from "./useCourse";

export default function CoursePage() {
  const { t } = useTranslation("courses");
  const id = Number(useParams().courseId);
  const { isStaff } = useSession();
  const q = useCourseQuery(id);
  const patch = usePatchCourse(id);
  const qc = useQueryClient();
  if (q.isPending) return <div className="page"><PageLoading /></div>;
  if (q.isError) return <div className="page"><LoadError error={q.error} retry={() => void q.refetch()} /></div>;
  const c = q.data;
  const save = (field: "title" | "description") => async (v: string) => {
    await api.patch(`/api/courses/${id}`, { [field]: v });
    patch.set((x) => ({ ...x, [field]: v }));
    void qc.invalidateQueries({ queryKey: ["browse"] });
  };
  const p = c.progress;
  const staffView = isStaff && c.kind === "catalog" && c.can_edit;
  const tabs = [
    { to: "", label: t("tabs.outline"), end: true },
    { to: "tests", label: t("tabs.tests") },
    ...(staffView ? [{ to: "gradebook", label: t("tabs.gradebook") }, { to: "report", label: t("tabs.report") }] : []),
    ...(c.can_edit ? [{ to: "settings", label: t("tabs.settings") }] : []),
  ];
  return (
    <div className="page">
      <header className="page-head" style={{ alignItems: "center" }}>
        <div className="titles stack tight">
          <Crumbs items={[{ to: "/courses", label: t("browse.title") }, { label: c.kind === "personal" ? t("card.personal") : c.owner || t("card.noTeacher") }]} />
          <InlineText as="h1" value={c.title} onSave={save("title")} label={t("course.rename")} disabled={!c.can_edit} />
          <InlineText as="p" className="muted" value={c.description} onSave={save("description")} label={t("course.describe")}
                      placeholder={c.can_edit ? t("course.addDescription") : ""} multiline maxLength={2000} disabled={!c.can_edit} />
          {c.archived && <span className="pill warn" style={{ alignSelf: "flex-start" }}>{t("common:status.archived")}</span>}
        </div>
        {p && p.topics > 0 && (
          <div className="row nowrap" style={{ gap: 14 }}>
            <Ring value={(100 * p.completed) / p.topics} size={64} label={t("common:progress.topicsDone", { done: p.completed, total: p.topics })} />
            <div className="stack tight small">
              <strong>{t("common:progress.topicsDone", { done: p.completed, total: p.topics })}</strong>
              <span className="muted">{t("course.mastery", { n: p.mastery })}</span>
            </div>
          </div>
        )}
      </header>
      <nav className="segmented" aria-label={t("tabs.label")} style={{ marginBlockEnd: 20, overflowX: "auto", maxInlineSize: "100%" }}>
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => (isActive ? "active" : "")}
                   style={({ isActive }) => ({ padding: "6px 14px", borderRadius: 8, fontWeight: 560, fontSize: "0.9rem", whiteSpace: "nowrap",
                     color: isActive ? "var(--text)" : "var(--muted)", background: isActive ? "var(--surface)" : "transparent",
                     boxShadow: isActive ? "var(--shadow)" : "none", textDecoration: "none" })}>
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet context={{ course: c }} />
    </div>
  );
}
