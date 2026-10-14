import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { useSession } from "@/app/session";
import { Field, useAction } from "@/ui/controls";
import { useFieldError } from "@/ui/errors";

import { AuthForm, AuthFrame } from "./AuthFrame";
import { PasswordInput } from "./PasswordInput";

/** Two steps on one screen: details, then the 6-digit code we emailed. */
export default function Register() {
  const { t, i18n } = useTranslation("auth");
  const { config, signedIn } = useSession();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const fe = useFieldError();
  const start = useAction(() => api.post("/api/auth/register", { name: name.trim(), email: email.trim(), password, locale: i18n.language }), { onDone: () => setSent(true) });
  const verify = useAction(() => api.post<Me>("/api/auth/register/verify", { email: email.trim(), code: code.trim() }), {
    onDone: (me) => { signedIn(me); nav("/", { replace: true }); },
  });

  if (!config.registration) {
    return <AuthFrame title={t("register.closedTitle")} sub={t("register.closed")} footer={<Link to="/login">{t("backToLogin")}</Link>}>{null}</AuthFrame>;
  }
  if (sent) {
    return (
      <AuthFrame title={t("register.codeTitle")} sub={t("register.codeSent", { email })}
                 footer={<button type="button" className="btn ghost small" onClick={() => { setSent(false); setCode(""); verify.reset(); }}>{t("register.changeEmail")}</button>}>
        <AuthForm onSubmit={() => void verify.run()} busy={verify.busy} error={verify.error} submit={t("register.verify")}>
          <Field label={t("register.code")}>
            {(id) => <input id={id} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} autoFocus
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} style={{ letterSpacing: "0.4em", fontSize: "1.3rem", textAlign: "center" }} />}
          </Field>
        </AuthForm>
      </AuthFrame>
    );
  }
  const fieldErr = (f: string) => fe(start.error, f);
  return (
    <AuthFrame title={t("register.title")} sub={t("register.sub")} footer={<>{t("register.haveAccount")} <Link to="/login">{t("register.signIn")}</Link></>}>
      <AuthForm onSubmit={() => void start.run()} busy={start.busy} error={start.state === "error" && !fieldErr("email") && !fieldErr("password") && !fieldErr("name") ? start.error : null} submit={t("register.submit")}>
        <Field label={t("name")} error={fieldErr("name")}>
          {(id) => <input id={id} type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />}
        </Field>
        <Field label={t("email")} error={fieldErr("email")}>
          {(id) => <input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />}
        </Field>
        <Field label={t("password")} hint={t("passwordHint")} error={fieldErr("password")}>
          {(id, d) => <PasswordInput id={id} value={password} onChange={setPassword} autoComplete="new-password" describedBy={d} />}
        </Field>
      </AuthForm>
    </AuthFrame>
  );
}
