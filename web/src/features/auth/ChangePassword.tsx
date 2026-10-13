import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { useMe, useSession } from "@/app/session";
import { Field, useAction } from "@/ui/controls";
import { useFieldError } from "@/ui/errors";

import { AuthForm, AuthFrame } from "./AuthFrame";
import { PasswordInput } from "./PasswordInput";

/** Shown once after an admin created the account or reset the password. */
export default function ChangePassword() {
  const { t } = useTranslation("auth");
  const me = useMe();
  const { signedIn, signOut } = useSession();
  const nav = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const fe = useFieldError();
  const change = useAction(() => api.post<Me>("/api/auth/password", { current, new: next }), {
    onDone: (m) => { signedIn(m); nav("/", { replace: true }); },
  });
  return (
    <AuthFrame title={t("change.title", { name: me.name.split(" ")[0] })} sub={t("change.sub")}
               footer={<button type="button" className="btn ghost small" onClick={() => void signOut()}>{t("change.notYou")}</button>}>
      <AuthForm onSubmit={() => void change.run()} busy={change.busy} error={fe(change.error, "new") ? null : change.error} submit={t("change.submit")}>
        <Field label={t("change.current")}>
          {(id) => <PasswordInput id={id} value={current} onChange={setCurrent} autoComplete="current-password" />}
        </Field>
        <Field label={t("newPassword")} hint={t("passwordHint")} error={fe(change.error, "new")}>
          {(id, d) => <PasswordInput id={id} value={next} onChange={setNext} autoComplete="new-password" describedBy={d} />}
        </Field>
      </AuthForm>
    </AuthFrame>
  );
}
