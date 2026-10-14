import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "@/api/client";
import type { AiStatus, Me } from "@/api/types";
import { useMe, useSession } from "@/app/session";
import { getTheme, setTheme, type Theme } from "@/app/theme";
import { PasswordInput } from "@/features/auth/PasswordInput";
import { applyLanguage, LANGUAGES } from "@/i18n";
import { ActionButton, Button, Field, InlineText, SaveStatus, Segmented, useAction } from "@/ui/controls";
import { Avatar, Notice, PageHead } from "@/ui/display";
import { useFieldError } from "@/ui/errors";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card stack">
      <div className="stack tight"><h2>{title}</h2>{hint && <p className="small muted">{hint}</p>}</div>
      {children}
    </section>
  );
}

export default function Profile() {
  const { t } = useTranslation("profile");
  const me = useMe();
  const { signedIn } = useSession();
  const qc = useQueryClient();
  const fe = useFieldError();
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [key, setKey] = useState("");
  const ai = useQuery({ queryKey: ["ai-status"], queryFn: () => api.get<AiStatus>("/api/ai/status") });

  const lang = useAction(async (locale: string) => {
    const m = await api.patch<Me>("/api/auth/me", { locale });
    signedIn(m);
    await applyLanguage(locale);
  });
  const password = useAction(async () => {
    const m = await api.post<Me>("/api/auth/password", { current, new: next });
    qc.setQueryData(["me"], m);
    setCurrent("");
    setNext("");
  }, { doneFor: 4000 });
  const saveKey = async (value: string) => {
    const m = await api.put<Me>("/api/auth/me/ai-key", { key: value });
    qc.setQueryData(["me"], m);
    setKey("");
    void qc.invalidateQueries({ queryKey: ["ai-status"] });
  };

  return (
    <div className="page narrow">
      <PageHead title={t("title")} />
      <div className="stack">
        <section className="card row" style={{ gap: 16 }}>
          <Avatar name={me.name} />
          <div className="grow stack tight">
            <InlineText as="h2" value={me.name} label={t("name")} maxLength={120} onSave={async (name) => qc.setQueryData(["me"], await api.patch<Me>("/api/auth/me", { name }))} />
            <span className="small muted">{me.email} · {t(`common:roles.${me.role}`)}</span>
          </div>
        </section>

        <Section title={t("look.title")}>
          <div className="row between">
            <span>{t("look.theme")}</span>
            <Segmented label={t("look.theme")} value={theme} onChange={(v) => { setTheme(v); setThemeState(v); }}
                       options={[{ value: "system", label: t("look.system") }, { value: "light", label: t("look.light") }, { value: "dark", label: t("look.dark") }]} />
          </div>
          <div className="row between">
            <label htmlFor="lang">{t("look.language")}</label>
            <span className="row tight">
              <select id="lang" value={me.locale} onChange={(e) => void lang.run(e.target.value)} style={{ inlineSize: "auto" }}>
                {Object.entries(LANGUAGES).map(([code, l]) => <option key={code} value={code}>{l.name}</option>)}
              </select>
              <SaveStatus state={lang.state} error={lang.error} />
            </span>
          </div>
        </Section>

        <Section title={t("password.title")} hint={t("password.hint")}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void password.run(); }}>
            <Field label={t("password.current")} error={fe(password.error, "current")}>
              {(id) => <PasswordInput id={id} value={current} onChange={setCurrent} autoComplete="current-password" />}
            </Field>
            <Field label={t("password.new")} hint={t("password.newHint")} error={fe(password.error, "new")}>
              {(id, d) => <PasswordInput id={id} value={next} onChange={setNext} autoComplete="new-password" describedBy={d} />}
            </Field>
            <div className="row">
              <Button type="submit" variant="primary" busy={password.busy} disabled={!current || next.length < 8}>{t("password.save")}</Button>
              {password.state === "done" && <span className="status ok fade-in">{t("password.saved")}</span>}
              {password.state === "error" && !fe(password.error, "new") && <SaveStatus state="error" error={password.error} />}
            </div>
          </form>
        </Section>

        <Section title={t("ai.title")} hint={me.self_registered ? t("ai.ownHint") : t("ai.instHint")}>
          {ai.data && !me.self_registered && (
            <Notice tone={ai.data.available ? "good" : "warn"} icon="sparkle">
              {ai.data.available ? (ai.data.left != null ? t("ai.left", { n: ai.data.left, limit: ai.data.limit ?? 0 }) : t("ai.on")) : t("ai.off")}
            </Notice>
          )}
          {me.self_registered && (
            <div className="stack">
              {me.own_ai_key ? (
                <div className="row between">
                  <span className="status ok">{t("ai.keySet")}</span>
                  <ActionButton variant="danger" size="small" icon="trash" action={() => saveKey("")}>{t("ai.removeKey")}</ActionButton>
                </div>
              ) : <p className="small muted">{t("ai.noKey")}</p>}
              <form className="row nowrap" onSubmit={(e) => e.preventDefault()}>
                <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t("ai.keyPlaceholder")} aria-label={t("ai.key")} autoComplete="off" />
                <ActionButton variant="primary" disabled={!key.trim()} action={() => saveKey(key.trim())}>{me.own_ai_key ? t("ai.replaceKey") : t("ai.saveKey")}</ActionButton>
              </form>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
