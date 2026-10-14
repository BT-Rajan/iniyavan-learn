import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import { Button, Field, useAction } from "@/ui/controls";
import { useErrorText, useFieldError } from "@/ui/errors";
import { Icon } from "@/ui/icons";

/** Step zero: a name. Everything else happens on the course's builder page. */
export default function StudioNew() {
  const { t } = useTranslation("studio");
  const nav = useNavigate();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const fe = useFieldError();
  const err = useErrorText();
  const create = useAction(() => api.post<{ course_id: number }>("/api/studio", { title: title.trim() }), {
    onDone: (r) => { void qc.invalidateQueries({ queryKey: ["browse"] }); nav(`/studio/${r.course_id}`, { replace: true }); },
  });
  return (
    <div className="page narrow">
      <form className="card pad-lg stack" onSubmit={(e) => { e.preventDefault(); if (title.trim()) void create.run(); }} style={{ marginBlockStart: 24 }}>
        <span className="row tight" style={{ color: "var(--accent)" }}><Icon name="sparkle" /> <strong>{t("new.kicker")}</strong></span>
        <h1>{t("new.title")}</h1>
        <p className="muted">{t("new.sub")}</p>
        <ol className="small muted" style={{ paddingInlineStart: 20, margin: 0, display: "grid", gap: 4 }}>
          <li>{t("new.step1")}</li>
          <li>{t("new.step2")}</li>
          <li>{t("new.step3")}</li>
        </ol>
        <Field label={t("new.name")} hint={t("new.nameHint")} error={fe(create.error, "title")}>
          {(id, d) => <input id={id} type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus aria-describedby={d} />}
        </Field>
        <div className="row">
          <Button type="submit" variant="primary" size="lg" busy={create.busy} disabled={!title.trim()}>{t("new.go")}</Button>
          {create.state === "error" && !fe(create.error, "title") && <span className="status err">{err(create.error)}</span>}
        </div>
      </form>
    </div>
  );
}
