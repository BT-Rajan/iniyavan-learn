import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/ui/icons";

export function PasswordInput({ id, value, onChange, autoComplete, describedBy, invalid }: {
  id: string; value: string; onChange: (v: string) => void; autoComplete: string; describedBy?: string; invalid?: boolean;
}) {
  const { t } = useTranslation("auth");
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input id={id} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete}
             aria-describedby={describedBy} aria-invalid={invalid || undefined} style={{ paddingInlineEnd: 44 }} />
      <button type="button" className="btn ghost small icon-only" onClick={() => setShow(!show)} aria-pressed={show}
              aria-label={show ? t("hidePassword") : t("showPassword")} style={{ position: "absolute", insetInlineEnd: 4, insetBlockStart: 5 }}>
        <Icon name={show ? "eyeOff" : "eye"} />
      </button>
    </div>
  );
}
