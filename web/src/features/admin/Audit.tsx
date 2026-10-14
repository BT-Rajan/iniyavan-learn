import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { api, qs } from "@/api/client";
import type { AuditItem } from "@/api/types";
import { fmtDate, fmtDateTime, fmtRelative } from "@/i18n/format";
import { Button } from "@/ui/controls";
import { Avatar, Empty, LoadError, PageHead, PageLoading } from "@/ui/display";
import { Icon } from "@/ui/icons";

const PREFIXES = ["user", "program", "term", "course", "unit", "topic", "test", "studio", "settings"] as const;
const LINKS: Partial<Record<string, (id: string) => string>> = {
  course: (id) => `/courses/${id}`,
  topic: (id) => `/topics/${id}`,
  quiz: (id) => `/tests/${id}/edit`,
};

interface Page { items: AuditItem[]; more: boolean }

/** "course:3" → a readable, and where possible clickable, name for what was changed. */
function Target({ target }: { target: string }) {
  const { t } = useTranslation("admin");
  if (!target) return null;
  const [kind, id] = target.split(":");
  const label = t("audit.target", { kind, id, defaultValue: target });
  const link = LINKS[kind];
  return link && id ? <Link to={link(id)}>{label}</Link> : <span>{label}</span>;
}

function Detail({ detail }: { detail: Record<string, unknown> }) {
  const { t } = useTranslation("admin");
  const entries = Object.entries(detail ?? {});
  if (!entries.length) return null;
  return (
    <details className="disclosure small" style={{ marginBlockStart: 4 }}>
      <summary className="muted">{t("audit.details")}</summary>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "2px 12px", margin: "6px 0 0" }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt className="muted">{t(`audit.fields.${k}`, { defaultValue: k })}</dt>
            <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{Array.isArray(v) ? v.join(", ") : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function Entry({ e, onPerson }: { e: AuditItem; onPerson: (id: number) => void }) {
  const { t, i18n } = useTranslation("admin");
  const who = e.user ?? t("audit.system");
  const key = `admin:audit.actions.${e.action}`;
  const what = i18n.exists(key) ? t(key, { who }) : t("audit.unknown", { who, action: e.action });
  return (
    <li className="topic-row" style={{ alignItems: "flex-start" }}>
      <Avatar name={who} />
      <div className="grow stack" style={{ gap: 2 }}>
        <span>{what}</span>
        <span className="small muted row tight">
          <time dateTime={e.at} title={fmtDateTime(e.at)}>{fmtRelative(e.at)}</time>
          {e.target && <>· <Target target={e.target} /></>}
          {e.user_id && (
            <>· <button type="button" className="btn ghost small" style={{ minBlockSize: 0, padding: "0 4px" }} onClick={() => onPerson(e.user_id!)}>
              {t("audit.onlyPerson", { name: who })}
            </button></>
          )}
        </span>
        <Detail detail={e.detail} />
      </div>
    </li>
  );
}

export default function Audit() {
  const { t } = useTranslation("admin");
  const [params, setParams] = useSearchParams();
  const action = params.get("action") ?? "";
  const user = params.get("user") ?? "";
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };
  const q = useInfiniteQuery({
    queryKey: ["audit", action, user],
    queryFn: ({ pageParam }) => api.get<Page>(`/api/admin/audit${qs({ action, user_id: user, before: pageParam, limit: 50 })}`),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.more && last.items.length ? last.items[last.items.length - 1].id : undefined),
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const days = useMemo(() => {
    const out: { day: string; items: AuditItem[] }[] = [];
    for (const e of items) {
      const day = fmtDate(e.at, { dateStyle: "full" });
      if (out[out.length - 1]?.day !== day) out.push({ day, items: [] });
      out[out.length - 1].items.push(e);
    }
    return out;
  }, [items]);
  const personName = items.find((e) => String(e.user_id) === user)?.user;

  return (
    <div className="page narrow">
      <PageHead title={t("audit.title")} sub={t("audit.sub")} />
      <div className="stack">
        <div className="row">
          <label className="row tight small">
            <span>{t("audit.filter")}</span>
            <select value={action} onChange={(e) => set("action", e.target.value)} style={{ inlineSize: "auto" }}>
              <option value="">{t("audit.prefix.all")}</option>
              {PREFIXES.map((p) => <option key={p} value={`${p}.`}>{t(`audit.prefix.${p}`)}</option>)}
            </select>
          </label>
          {user && (
            <span className="pill accent">
              {t("audit.byPerson", { name: personName ?? user })}
              <button type="button" className="btn ghost small icon-only" style={{ minBlockSize: 0, inlineSize: 20, blockSize: 20 }} aria-label={t("audit.clearPerson")} onClick={() => set("user", "")}>
                <Icon name="x" style={{ inlineSize: 12, blockSize: 12 }} />
              </button>
            </span>
          )}
        </div>
        {q.isPending ? <PageLoading /> : q.isError ? <LoadError error={q.error} retry={() => void q.refetch()} /> : items.length === 0 ? (
          <Empty icon="log" title={t("audit.emptyTitle")}>{action || user ? t("audit.emptyFiltered") : t("audit.empty")}</Empty>
        ) : (
          <>
            {days.map((d) => (
              <section key={d.day} className="unit" aria-label={d.day}>
                <div className="unit-head"><h2>{d.day}</h2></div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {d.items.map((e) => <Entry key={e.id} e={e} onPerson={(id) => set("user", String(id))} />)}
                </ul>
              </section>
            ))}
            {q.hasNextPage && (
              <div className="row" style={{ justifyContent: "center" }}>
                <Button busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{t("common:actions.showMore")}</Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
