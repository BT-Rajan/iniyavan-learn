import type { FormEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Brand } from "@/app/Shell";
import { choose, LANGUAGES } from "@/i18n";
import { Button } from "@/ui/controls";
import { useErrorText } from "@/ui/errors";

/** The calm, centred card every signed-out screen uses. Errors appear inside the form, under the button. */
export function AuthFrame({ title, sub, children, footer }: { title: string; sub?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="auth">
      <div className="stack" style={{ inlineSize: "100%", maxInlineSize: 400 }}>
        <div className="card stack">
          <Brand />
          <div className="stack tight" style={{ textAlign: "center" }}>
            <h1 style={{ fontSize: "1.35rem" }}>{title}</h1>
            {sub && <p className="muted small">{sub}</p>}
          </div>
          {children}
        </div>
        {footer && <div className="small muted" style={{ textAlign: "center" }}>{footer}</div>}
        <LanguageSwitch />
      </div>
    </main>
  );
}

export function AuthForm({ onSubmit, busy, error, submit, children }: {
  onSubmit: () => void; busy: boolean; error: unknown; submit: string; children: ReactNode;
}) {
  const err = useErrorText();
  return (
    <form className="stack" noValidate onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(); }}>
      {children}
      <Button type="submit" variant="primary" size="lg" block busy={busy}>{submit}</Button>
      <p role="alert" aria-live="assertive" className="field-error" style={{ textAlign: "center", minBlockSize: "1.2em" }}>
        {error ? err(error) : ""}
      </p>
    </form>
  );
}

/** Every signed-out screen offers the languages; the choice carries into the account after signing in. */
function LanguageSwitch() {
  const { i18n } = useTranslation();
  const langs = Object.entries(LANGUAGES);
  if (langs.length < 2) return null;
  return (
    <nav className="row" style={{ justifyContent: "center" }} aria-label="Language / اللغة">
      {langs.map(([code, l]) => (
        <button key={code} type="button" lang={code} className="btn ghost small" aria-pressed={i18n.language === code}
                style={i18n.language === code ? { color: "var(--accent)" } : undefined} onClick={() => void choose(code)}>
          {l.name}
        </button>
      ))}
    </nav>
  );
}
