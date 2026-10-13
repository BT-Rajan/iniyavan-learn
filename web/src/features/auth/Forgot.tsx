import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { api } from "@/api/client";
import { Field, useAction } from "@/ui/controls";
import { Notice } from "@/ui/display";

import { AuthForm, AuthFrame } from "./AuthFrame";

export default function Forgot() {
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState("");
  const send = useAction(() => api.post("/api/auth/forgot", { email: email.trim() }), { doneFor: 1e9 });
  return (
    <AuthFrame title={t("forgot.title")} sub={t("forgot.sub")} footer={<Link to="/login">{t("backToLogin")}</Link>}>
      {send.state === "done" ? (
        <Notice tone="good" icon="check" title={t("forgot.sentTitle")}>{t("forgot.sent", { email })}</Notice>
      ) : (
        <AuthForm onSubmit={() => void send.run()} busy={send.busy} error={send.error} submit={t("forgot.submit")}>
          <Field label={t("email")}>
            {(id) => <input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />}
          </Field>
        </AuthForm>
      )}
    </AuthFrame>
  );
}
