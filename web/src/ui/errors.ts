/** Turns an error from the API into words in the user's language. */
import { useTranslation } from "react-i18next";

import { ApiError } from "@/api/client";

export function useErrorText() {
  const { t, i18n } = useTranslation("errors");
  return (err: unknown): string => {
    if (!err) return "";
    if (err instanceof ApiError) {
      const key = `errors:${err.code}`;
      if (i18n.exists(key)) return t(err.code, err.params as Record<string, string>);
      const [what, kind] = err.code.split(".");
      if (kind === "not_found") return t("generic.not_found");
      if (kind === "title_required") return t("generic.title_required");
      if (what === "validation") return t("validation.failed");
      if (err.status >= 500) return t("generic.server");
      return t("generic.failed");
    }
    return t("generic.failed");
  };
}

/** The message for one form field, from a validation error. */
export function useFieldError() {
  const { t, i18n } = useTranslation("errors");
  return (err: unknown, field: string): string | undefined => {
    if (!(err instanceof ApiError)) return undefined;
    const code = err.fields?.[field];
    if (!code) return undefined;
    return i18n.exists(`errors:${code}`) ? t(code) : t("validation.invalid");
  };
}
