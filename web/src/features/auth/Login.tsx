import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { useSession } from "@/app/session";
import { pickedBeforeSignIn } from "@/i18n";
import { Field, useAction } from "@/ui/controls";
import { useFieldError } from "@/ui/errors";

import { AuthForm, AuthFrame } from "./AuthFrame";
import { PasswordInput } from "./PasswordInput";

export default function Login() {
  const { t } = useTranslation("auth");
  const { config, signedIn } = useSession();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const fieldError = useFieldError();
  const next = params.get("next");
  const login = useAction(async () => {
    let me = await api.post<Me>("/api/auth/login", { email: email.trim(), password });
    const picked = pickedBeforeSignIn();
    if (picked && picked !== me.locale) me = await api.patch<Me>("/api/auth/me", { locale: picked }); // the language they just chose wins
    return me;
  }, {
    onDone: (me) => { signedIn(me); nav(next && next.startsWith("/") ? next : "/", { replace: true }); },
  });
  return (
    <AuthFrame
      title={t("login.title", { app: config.app_name })}
      footer={config.registration && <>{t("login.noAccount")} <Link to="/register">{t("login.register")}</Link></>}
    >
      <AuthForm onSubmit={() => void login.run()} busy={login.busy} error={login.state === "error" && !fieldError(login.error, "email") ? login.error : null} submit={t("login.submit")}>
        <Field label={t("email")} error={fieldError(login.error, "email")}>
          {(id, d) => <input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus aria-describedby={d} required />}
        </Field>
        <Field label={t("password")}>
          {(id, d) => <PasswordInput id={id} value={password} onChange={setPassword} autoComplete="current-password" describedBy={d} />}
        </Field>
        {config.password_reset && <Link to="/forgot" className="small" style={{ alignSelf: "flex-end", marginBlockStart: -8 }}>{t("login.forgot")}</Link>}
      </AuthForm>
    </AuthFrame>
  );
}
