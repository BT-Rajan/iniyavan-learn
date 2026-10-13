import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { useSession } from "@/app/session";
import { Field, useAction } from "@/ui/controls";
import { useFieldError } from "@/ui/errors";

import { AuthForm, AuthFrame } from "./AuthFrame";
import { PasswordInput } from "./PasswordInput";

export default function Reset() {
  const { t } = useTranslation("auth");
  const [params] = useSearchParams();
  const { signedIn } = useSession();
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const fe = useFieldError();
  const reset = useAction(() => api.post<Me>("/api/auth/reset", { token: params.get("token") ?? "", password }), {
    onDone: (me) => { signedIn(me); nav("/", { replace: true }); },
  });
  return (
    <AuthFrame title={t("reset.title")} footer={<Link to="/login">{t("backToLogin")}</Link>}>
      <AuthForm onSubmit={() => void reset.run()} busy={reset.busy} error={fe(reset.error, "password") ? null : reset.error} submit={t("reset.submit")}>
        <Field label={t("newPassword")} hint={t("passwordHint")} error={fe(reset.error, "password")}>
          {(id, d) => <PasswordInput id={id} value={password} onChange={setPassword} autoComplete="new-password" describedBy={d} />}
        </Field>
      </AuthForm>
    </AuthFrame>
  );
}
