import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import type { Program } from "@/api/types";
import { useSession } from "@/app/session";
import { ActionButton, ConfirmButton, SaveStatus, Segmented, useAction } from "@/ui/controls";
import { Icon } from "@/ui/icons";

import { useCourse, usePatchCourse } from "./useCourse";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card stack">
      <div className="stack tight">
        <h2>{title}</h2>
        {hint && <p className="small muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export default function CourseSettings() {
  const { t } = useTranslation("courses");
  const { course } = useCourse();
  const { isAdmin } = useSession();
  const patch = usePatchCourse(course.id);
  const qc = useQueryClient();
  const nav = useNavigate();
  const catalog = course.kind === "catalog";
  const programs = useQuery({ queryKey: ["programs"], queryFn: () => api.get<Program[]>("/api/programs"), enabled: catalog });
  const faculty = useQuery({ queryKey: ["faculty"], queryFn: () => api.get<{ id: number; name: string }[]>("/api/users/faculty"), enabled: catalog && isAdmin });
  const [shares, setShares] = useState<number[]>(course.shared_terms);

  const update = useAction(async (body: Record<string, unknown>) => {
    await api.patch(`/api/courses/${course.id}`, body);
    patch.set((c) => ({ ...c, ...body }));
    void patch.refresh();
    void qc.invalidateQueries({ queryKey: ["browse"] });
  });
  const saveShares = useAction(async (ids: number[]) => {
    await api.put(`/api/courses/${course.id}/shares`, { term_ids: ids });
    patch.set((c) => ({ ...c, shared_terms: ids }));
  });
  const archive = async (archived: boolean) => {
    await api.put(`/api/courses/${course.id}/archive`, { archived });
    patch.set((c) => ({ ...c, archived }));
    void qc.invalidateQueries({ queryKey: ["browse"] });
  };
  const home = programs.data?.find((p) => p.terms.some((x) => x.id === course.term_id));

  return (
    <div className="stack" style={{ maxInlineSize: 760 }}>
      {!catalog && (
        <Section title={t("settings.who")} hint={t("settings.privateHint")}>
          <div className="row">
            <Segmented label={t("settings.who")} value={course.visibility} onChange={(v) => void update.run({ visibility: v })}
                       options={[{ value: "private", label: t("settings.private") }, { value: "program", label: t("settings.program") }]} />
            <SaveStatus state={update.state} error={update.error} />
          </div>
        </Section>
      )}

      {catalog && isAdmin && (
        <Section title={t("settings.teacher")}>
          <div className="grid">
            <label className="field">
              <span className="label">{t("settings.teacher")}</span>
              <select value={course.owner_id ?? ""} onChange={(e) => void update.run({ owner_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">{t("settings.noTeacher")}</option>
                {(faculty.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="label">{t("settings.term")}</span>
              <select value={course.term_id ?? ""} onChange={(e) => void update.run({ term_id: Number(e.target.value) })}>
                {(programs.data ?? []).map((p) => (
                  <optgroup key={p.id} label={p.name}>{p.terms.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
                ))}
              </select>
            </label>
          </div>
          <SaveStatus state={update.state} error={update.error} />
        </Section>
      )}

      {catalog && home && (
        <Section title={t("settings.share")} hint={t("settings.shareHint")}>
          <div className="row" style={{ gap: 14 }}>
            {home.terms.filter((x) => x.id !== course.term_id && !x.archived).map((x) => (
              <label key={x.id} className="check">
                <input type="checkbox" checked={shares.includes(x.id)} onChange={(e) => {
                  const next = e.target.checked ? [...shares, x.id] : shares.filter((s) => s !== x.id);
                  setShares(next);
                  void saveShares.run(next);
                }} />
                {x.name}
              </label>
            ))}
          </div>
          <SaveStatus state={saveShares.state} error={saveShares.error} />
        </Section>
      )}

      <Section title={t("settings.rebuild")} hint={t("settings.rebuildHint")}>
        <Link className="btn" to={`/studio/${course.id}`} style={{ alignSelf: "flex-start" }}><Icon name="sparkle" /> {t("settings.rebuild")}</Link>
      </Section>

      <Section title={t("settings.danger")}>
        {course.archived ? (
          <div className="row between">
            <span className="muted">{t("settings.archived")}</span>
            <ActionButton icon="undo" action={() => archive(false)}>{t("settings.restore")}</ActionButton>
          </div>
        ) : (
          <div className="row between">
            <span className="small muted grow">{t("settings.archiveHint")}</span>
            <ActionButton icon="archive" action={() => archive(true)}>{t("settings.archive")}</ActionButton>
          </div>
        )}
        {(isAdmin || !catalog) && (
          <>
            <div className="divider" />
            <div className="row between">
              <span className="small muted grow">{t("settings.deleteHint")}</span>
              <ConfirmButton confirmLabel={t("settings.deleteConfirm")} action={async () => {
                await api.del(`/api/courses/${course.id}`);
                qc.removeQueries({ queryKey: ["course", course.id] });
                void qc.invalidateQueries({ queryKey: ["browse"] });
                nav("/courses", { replace: true });
              }}>{t("settings.delete")}</ConfirmButton>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
