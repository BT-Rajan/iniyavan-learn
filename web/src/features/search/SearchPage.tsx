import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { api } from "@/api/client";
import type { AiStatus, AiText, SearchHit } from "@/api/types";
import { Button } from "@/ui/controls";
import { Content, Empty, LoadError, PageHead, Skeleton } from "@/ui/display";
import { useErrorText } from "@/ui/errors";
import { Icon } from "@/ui/icons";

/** Marks the searched words inside a snippet, without any HTML. */
function Marked({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return <>{text.split(re).map((part, i) => (i % 2 ? <mark key={i} style={{ background: "var(--accent-soft)", color: "inherit", borderRadius: 3 }}>{part}</mark> : <Fragment key={i}>{part}</Fragment>))}</>;
}

function AiAnswer({ q }: { q: string }) {
  const { t } = useTranslation("search");
  const err = useErrorText();
  const a = useQuery({ queryKey: ["search-answer", q], queryFn: () => api.get<AiText>(`/api/search/answer?q=${encodeURIComponent(q)}`), staleTime: Infinity, retry: false });
  return (
    <section className="card panel stack fade-in" aria-live="polite" aria-busy={a.isPending}>
      <h2 className="row tight"><Icon name="sparkle" style={{ color: "var(--accent)" }} /> {t("ai.title", { q })}</h2>
      {a.isPending ? <div className="stack tight"><Skeleton w="60%" /><Skeleton /><Skeleton w="80%" /></div>
        : a.isError ? <div className="row"><span className="status err">{err(a.error)}</span><Button size="small" icon="refresh" onClick={() => void a.refetch()}>{t("common:actions.retry")}</Button></div>
        : <><Content text={a.data.text} /><p className="tiny faint">{t("ai.disclaimer")}</p></>}
    </section>
  );
}

export default function SearchPage() {
  const { t } = useTranslation("search");
  const [params] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const [ask, setAsk] = useState<string | null>(null);
  const r = useQuery({ queryKey: ["search", q], queryFn: () => api.get<{ results: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`), enabled: !!q });
  const ai = useQuery({ queryKey: ["ai-status"], queryFn: () => api.get<AiStatus>("/api/ai/status"), staleTime: 60_000 });
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const hits = r.data?.results ?? [];

  return (
    <div className="page narrow">
      <PageHead title={q ? t("title", { q }) : t("empty")} sub={q && r.data ? t("count", { n: hits.length }) : undefined} />
      {!q ? <Empty icon="search" title={t("empty")}>{t("emptyHint")}</Empty>
        : r.isPending ? <div className="stack"><Skeleton h={70} /><Skeleton h={70} /><Skeleton h={70} /></div>
        : r.isError ? <LoadError error={r.error} retry={() => void r.refetch()} />
        : (
          <div className="stack">
            {hits.length === 0 && <p className="muted">{t("none", { q })}</p>}
            {hits.map((h) => (
              <Link key={h.topic_id} to={`/topics/${h.topic_id}`} className="card link stack tight">
                <strong><Marked text={h.title} words={words} /></strong>
                <span className="tiny muted">{h.course} · {h.unit}</span>
                <p className="small"><Marked text={h.snippet} words={words} /></p>
              </Link>
            ))}
            {ai.data?.available && ask !== q && (
              <div className="row" style={{ marginBlockStart: 8 }}>
                <span className="small muted">{hits.length ? t("ai.notEnough") : t("ai.nothing")}</span>
                <Button icon="sparkle" onClick={() => setAsk(q)}>{t("ai.ask")}</Button>
              </div>
            )}
            {ask === q && <AiAnswer q={q} />}
          </div>
        )}
    </div>
  );
}
