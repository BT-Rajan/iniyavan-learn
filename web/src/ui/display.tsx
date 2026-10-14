import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import { Link } from "react-router-dom";
import remarkGfm from "remark-gfm";

import type { AreaStatus } from "@/api/types";
import { fmtPercent } from "@/i18n/format";

import { Button } from "./controls";
import { useErrorText } from "./errors";
import { Icon, type IconName } from "./icons";

export function Stars({ n, of = 3 }: { n: number; of?: number }) {
  const { t } = useTranslation();
  return (
    <span className="stars" role="img" aria-label={t("progress.stars", { n })}>
      {Array.from({ length: of }, (_, i) => <Icon key={i} name="star" className={i < n ? "on" : ""} />)}
    </span>
  );
}

export function Bar({ value, tone, label }: { value: number; tone?: "good" | "warn" | "bad"; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={`bar ${tone ?? ""}`} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ inlineSize: `${v}%` }} />
    </div>
  );
}

export function Ring({ value, size = 56, label, children }: { value: number; size?: number; label?: string; children?: ReactNode }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <span className="ring" role="img" aria-label={label ?? fmtPercent(v)} style={{ inlineSize: size, blockSize: size }}>
      <svg width={size} height={size} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round"
                strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} style={{ transition: "stroke-dashoffset .6s ease" }} />
      </svg>
      <span className="val">{children ?? fmtPercent(v)}</span>
    </span>
  );
}

export function tone(status: AreaStatus) {
  return status === "strong" ? "good" : status === "getting_there" ? "warn" : "bad";
}

export function AreaPill({ status }: { status: AreaStatus }) {
  const { t } = useTranslation();
  return <span className={`pill ${tone(status)}`}>{t(`progress.area.${status}`)}</span>;
}

export function Skeleton({ h = 18, w = "100%", style }: { h?: number; w?: number | string; style?: CSSProperties }) {
  return <div className="skeleton" style={{ blockSize: h, inlineSize: w, ...style }} aria-hidden />;
}

export function PageLoading() {
  const { t } = useTranslation();
  return (
    <div className="stack" aria-busy="true" aria-label={t("status.loading")}>
      <Skeleton h={14} w={160} />
      <Skeleton h={30} w="45%" />
      <Skeleton h={120} />
      <Skeleton h={120} />
    </div>
  );
}

export function LoadError({ error, retry }: { error: unknown; retry?: () => void }) {
  const { t } = useTranslation();
  const err = useErrorText();
  return (
    <div className="empty">
      <h3>{err(error)}</h3>
      <div className="row" style={{ justifyContent: "center", marginBlockStart: 12 }}>
        {retry && <Button icon="refresh" onClick={retry}>{t("actions.retry")}</Button>}
        <Link className="btn ghost" to="/">{t("nav.home")}</Link>
      </div>
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: IconName; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <Icon name={icon} style={{ inlineSize: 34, blockSize: 34, color: "var(--faint)", marginBlockEnd: 8 }} />}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style={{ marginBlockStart: 14 }}>{action}</div>}
    </div>
  );
}

export function Crumbs({ items }: { items: { to?: string; label: ReactNode }[] }) {
  const { t } = useTranslation();
  return (
    <nav className="crumbs" aria-label={t("nav.breadcrumbs")}>
      {items.map((c, i) => (
        <span key={i} className="row tight">
          {i > 0 && <Icon name="chevronRight" className="flip" style={{ inlineSize: 14, blockSize: 14 }} />}
          {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function PageHead({ title, sub, crumbs, actions }: { title: ReactNode; sub?: ReactNode; crumbs?: { to?: string; label: ReactNode }[]; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="titles">
        {crumbs && <Crumbs items={crumbs} />}
        {typeof title === "string" ? <h1>{title}</h1> : title}
        {sub && <p className="muted" style={{ marginBlockStart: 6 }}>{sub}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}

export function Notice({ tone = "info", icon, title, children, action }: { tone?: "info" | "warn" | "bad" | "good"; icon?: IconName; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice ${tone}`} role={tone === "bad" ? "alert" : undefined}>
      {icon && <Icon name={icon} />}
      <div className="grow">
        {title && <strong>{title}</strong>}
        {children && <span>{children}</span>}
      </div>
      {action}
    </div>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  return <span className="avatar" aria-hidden>{initials || "?"}</span>;
}

/** Topic content: Markdown (no raw HTML), or HTML the server has already cleaned. */
export function Content({ text, format = "markdown" }: { text: string; format?: "markdown" | "html" }) {
  // dir="auto": a topic written in Arabic reads right-to-left even in the English interface, and the reverse.
  if (format === "html") return <div className="prose" dir="auto" dangerouslySetInnerHTML={{ __html: text }} />;
  return (
    <div className="prose" dir="auto">
      <Markdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a> }}>
        {text}
      </Markdown>
    </div>
  );
}
