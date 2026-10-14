import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, ApiError } from "@/api/client";
import type { Settings as SettingsData } from "@/api/types";
import { Button, ConfirmButton, Field, SaveStatus, SavingSwitch, useAction, useAutosave } from "@/ui/controls";
import { LoadError, PageHead, PageLoading } from "@/ui/display";
import { useErrorText } from "@/ui/errors";
import { Icon } from "@/ui/icons";

import { Section } from "./parts";

const KEY = ["admin-settings"] as const;
type Patch = Partial<Omit<SettingsData, "self_registration" | "prompts" | "ai_key_set">> & { self_registration?: boolean; ai_key?: string; prompts?: Record<string, string> };

/** Every section saves through here: send the change, keep the answer, and let the shell know when branding changed. */
function useSave() {
  const qc = useQueryClient();
  return async (patch: Patch) => {
    const fresh = await api.patch<SettingsData>("/api/admin/settings", patch);
    qc.setQueryData(KEY, fresh);
    if ("app_name" in patch || "logo" in patch || "self_registration" in patch) void qc.invalidateQueries({ queryKey: ["config"] });
    return fresh;
  };
}

const codeOf = (e: unknown) => (e instanceof ApiError ? e.code : "");

function Branding({ s }: { s: SettingsData }) {
  const { t } = useTranslation("admin");
  const save = useSave();
  const err = useErrorText();
  const [name, setName] = useState(s.app_name);
  const auto = useAutosave(name.trim(), (v) => save({ app_name: v }), { enabled: !!name.trim() });
  const file = useRef<HTMLInputElement>(null);
  const logo = useAction(async (f: File | null) => {
    const url = f ? (await api.upload<{ url: string }>("/api/uploads", f)).url : "";
    await save({ logo: url });
  });
  return (
    <Section id="branding" title={t("settings.branding.title")} hint={t("settings.branding.hint")} status={<SaveStatus state={auto.state} error={auto.error} onRetry={() => void auto.retry()} />}>
      <Field label={t("settings.branding.name")} error={!name.trim() ? t("settings.branding.nameRequired") : undefined}>
        {(id, d) => <input id={id} aria-describedby={d} type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-invalid={!name.trim() || undefined} />}
      </Field>
      <div className="stack tight">
        <span style={{ fontWeight: 560, fontSize: "0.9rem" }}>{t("settings.branding.logo")}</span>
        <div className="row">
          {s.logo ? (
            <img src={s.logo} alt={t("settings.branding.logoAlt")} style={{ inlineSize: 56, blockSize: 56, objectFit: "contain", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-2)" }} />
          ) : (
            <span className="brand" style={{ padding: 0 }}><span className="mark" aria-hidden>{(name.trim() || s.app_name).slice(0, 1).toUpperCase()}</span><span className="small muted">{t("settings.branding.noLogo")}</span></span>
          )}
          <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" tabIndex={-1} aria-hidden
                 onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void logo.run(f); }} />
          <Button size="small" icon="upload" busy={logo.busy} onClick={() => file.current?.click()}>{s.logo ? t("settings.branding.replaceLogo") : t("settings.branding.uploadLogo")}</Button>
          {s.logo && <Button size="small" variant="ghost" icon="x" disabled={logo.busy} onClick={() => void logo.run(null)}>{t("settings.branding.removeLogo")}</Button>}
          <span role="status" className={logo.state === "error" ? "status err" : logo.state === "done" ? "status ok" : "sr-only"}>
            {logo.state === "error" ? err(logo.error) : logo.state === "done" ? <><Icon name="check" /> {t("common:status.saved")}</> : ""}
          </span>
        </div>
        <span className="small muted">{t("settings.branding.logoHint")}</span>
      </div>
    </Section>
  );
}

function SignUp({ s }: { s: SettingsData }) {
  const { t } = useTranslation("admin");
  const save = useSave();
  const [domains, setDomains] = useState(s.allowed_domains);
  const auto = useAutosave(domains, (v) => save({ allowed_domains: v }));
  const open = s.self_registration === "1";
  return (
    <Section id="signup" title={t("settings.signup.title")} hint={t("settings.signup.hint")} status={<SaveStatus state={auto.state} error={auto.error} onRetry={() => void auto.retry()} />}>
      <SavingSwitch checked={open} label={t("settings.signup.open")} save={(v) => save({ self_registration: v })} />
      <Field label={t("settings.signup.domains")} hint={t("settings.signup.domainsHint")}>
        {(id, d) => <input id={id} aria-describedby={d} type="text" value={domains} maxLength={1000} placeholder={t("settings.signup.domainsPlaceholder")}
                           onChange={(e) => setDomains(e.target.value)} />}
      </Field>
    </Section>
  );
}

function AiKey({ s }: { s: SettingsData }) {
  const { t } = useTranslation("admin");
  const save = useSave();
  const err = useErrorText();
  const [key, setKey] = useState("");
  const set = useAction(() => save({ ai_key: key.trim() }), { onDone: () => setKey("") });
  const submit = (e: FormEvent) => { e.preventDefault(); if (key.trim()) void set.run(); };
  return (
    <div className="stack tight">
      <div className="row">
        <strong style={{ fontSize: "0.9rem" }}>{t("settings.ai.key")}</strong>
        {s.ai_key_set
          ? <span className="pill good"><Icon name="check" style={{ inlineSize: 12, blockSize: 12 }} /> {t("settings.ai.keySet")}</span>
          : <span className="pill warn">{t("settings.ai.noKey")}</span>}
      </div>
      <form className="row" onSubmit={submit}>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="new-password" maxLength={300} spellCheck={false}
               aria-label={s.ai_key_set ? t("settings.ai.replaceKey") : t("settings.ai.newKey")}
               placeholder={s.ai_key_set ? t("settings.ai.replaceKey") : t("settings.ai.newKey")} style={{ flex: 1, minInlineSize: 200, inlineSize: "auto" }} />
        <Button type="submit" variant="primary" icon={set.state === "done" ? "check" : "key"} busy={set.busy} disabled={!key.trim()}>
          {set.state === "done" ? t("common:status.saved") : t("common:actions.save")}
        </Button>
        {s.ai_key_set && (
          <ConfirmButton confirmLabel={t("settings.ai.removeConfirm")} action={() => save({ ai_key: "" })}>{t("settings.ai.removeKey")}</ConfirmButton>
        )}
        <span role="status" className={set.state === "error" ? "status err" : "sr-only"}>{set.state === "error" ? err(set.error) : ""}</span>
      </form>
      <span className="small muted">{t("settings.ai.keyHint")}</span>
    </div>
  );
}

function Ai({ s }: { s: SettingsData }) {
  const { t } = useTranslation("admin");
  const save = useSave();
  const err = useErrorText();
  const [draft, setDraft] = useState({ ai_model: s.ai_model, ai_daily_limit: s.ai_daily_limit });
  const auto = useAutosave(draft, (v) => save({ ai_model: v.ai_model.trim(), ai_daily_limit: v.ai_daily_limit.trim() }));
  const limitErr = auto.state === "error" && codeOf(auto.error).startsWith("settings.limit") ? err(auto.error) : undefined;
  return (
    <Section id="ai" title={t("settings.ai.title")} hint={t("settings.ai.hint")}
             status={<SaveStatus state={limitErr ? "idle" : auto.state} error={auto.error} onRetry={() => void auto.retry()} />}>
      <AiKey s={s} />
      <div className="divider" />
      <div className="grid">
        <Field label={t("settings.ai.model")} hint={t("settings.ai.modelHint")}>
          {(id, d) => <input id={id} aria-describedby={d} type="text" value={draft.ai_model} maxLength={80} spellCheck={false} placeholder={t("settings.ai.modelPlaceholder", { model: s.defaults?.ai_model ?? "" })}
                             onChange={(e) => setDraft({ ...draft, ai_model: e.target.value })} />}
        </Field>
        <Field label={t("settings.ai.limit")} hint={t("settings.ai.limitHint")} error={limitErr}>
          {(id, d) => <input id={id} aria-describedby={d} type="number" min={1} max={10000} inputMode="numeric" value={draft.ai_daily_limit} placeholder={t("settings.ai.limitPlaceholder", { limit: s.defaults?.ai_daily_limit ?? "" })}
                             aria-invalid={!!limitErr || undefined} onChange={(e) => setDraft({ ...draft, ai_daily_limit: e.target.value })} />}
        </Field>
      </div>
    </Section>
  );
}

function PromptEditor({ name, value, fallback }: { name: string; value: string; fallback: string }) {
  const { t } = useTranslation("admin");
  const save = useSave();
  const [text, setText] = useState(value);
  const auto = useAutosave(text, (v) => save({ prompts: { [name]: v } }));
  const custom = !!text.trim();
  const id = `prompt-${name}`;
  return (
    <div className="stack tight" style={{ paddingBlock: 8 }}>
      <div className="row between">
        <span className="row tight">
          <label htmlFor={id} style={{ fontWeight: 600 }}>{t(`settings.prompts.names.${name}`, { defaultValue: name })}</label>
          <span className={`pill ${custom ? "accent" : ""}`}>{custom ? t("settings.prompts.custom") : t("settings.prompts.default")}</span>
        </span>
        <span className="row tight">
          <SaveStatus state={auto.state} error={auto.error} onRetry={() => void auto.retry()} />
          {custom && <Button size="small" variant="ghost" icon="undo" onClick={() => setText("")}>{t("settings.prompts.useDefault")}</Button>}
        </span>
      </div>
      <span id={`${id}-hint`} className="small muted">{t(`settings.prompts.hints.${name}`, { defaultValue: "" })}</span>
      <textarea id={id} aria-describedby={`${id}-hint`} value={text} onChange={(e) => setText(e.target.value)} rows={custom ? 6 : 2}
                placeholder={t("settings.prompts.placeholder")} style={{ fontSize: "0.9rem" }} />
      <details className="disclosure small">
        <summary>{t("settings.prompts.showDefault")}</summary>
        <div className="stack tight" style={{ marginBlockStart: 8 }}>
          <p style={{ whiteSpace: "pre-wrap", background: "var(--surface-2)", padding: "10px 12px", borderRadius: "var(--radius-sm)" }}>{fallback}</p>
          <div><Button size="small" icon="edit" onClick={() => setText(fallback)}>{t("settings.prompts.startFromDefault")}</Button></div>
        </div>
      </details>
    </div>
  );
}

export default function Settings() {
  const { t } = useTranslation("admin");
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<SettingsData>("/api/admin/settings"), staleTime: Infinity });
  return (
    <div className="page narrow">
      <PageHead title={t("settings.title")} sub={t("settings.sub")} />
      {q.isPending ? <PageLoading /> : q.isError ? <LoadError error={q.error} retry={() => void q.refetch()} /> : (
        <div className="stack">
          <Branding s={q.data} />
          <SignUp s={q.data} />
          <Ai s={q.data} />
          <Section id="prompts" title={t("settings.prompts.title")} hint={t("settings.prompts.hint")}>
            <div className="stack" style={{ gap: 4 }}>
              {Object.entries(q.data.prompts).map(([name, p], i) => (
                <div key={name}>
                  {i > 0 && <div className="divider" />}
                  <PromptEditor name={name} value={p.value} fallback={p.default} />
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
