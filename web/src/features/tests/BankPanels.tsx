/** The test editor's two question-bank panels: copy questions in from the bank, and save this test's questions to it. */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { api, qs } from "@/api/client";
import { ActionButton, Button } from "@/ui/controls";
import { Empty } from "@/ui/display";
import { Icon } from "@/ui/icons";

import { type BankItem, type BankPage, LETTERS, useDebounced } from "./parts";

export function TagChips({ tags, value, onChange }: { tags: string[]; value: string; onChange: (tag: string) => void }) {
  const { t } = useTranslation("tests");
  if (!tags.length) return null;
  return (
    <div className="row tight" role="group" aria-label={t("bank.tags")}>
      {tags.map((tag) => (
        <button key={tag} type="button" className={`pill ${value === tag ? "accent" : ""}`} aria-pressed={value === tag}
                style={{ border: 0, cursor: "pointer", font: "inherit", fontSize: "0.78rem", fontWeight: 600 }}
                onClick={() => onChange(value === tag ? "" : tag)}>
          {tag}
        </button>
      ))}
    </div>
  );
}

export function FromBank({ room, onAdd, onClose }: { room: number; onAdd: (items: BankItem[]) => Promise<unknown>; onClose: () => void }) {
  const { t } = useTranslation("tests");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const query = useDebounced(q);
  const list = useQuery({ queryKey: ["bank", query, tag, false, 0], queryFn: () => api.get<BankPage>(`/api/bank${qs({ q: query, tag, limit: 50 })}`) });
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <section className="card stack panel" aria-labelledby="from-bank-h">
      <div className="row between">
        <h3 id="from-bank-h">{t("bank.fromTitle")}</h3>
        <Button size="small" variant="ghost" icon="x" onClick={onClose}>{t("common:actions.close")}</Button>
      </div>
      <div className="searchbox" style={{ maxInlineSize: "none" }}>
        <Icon name="search" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("bank.search")} aria-label={t("bank.search")} />
      </div>
      <TagChips tags={list.data?.tags ?? []} value={tag} onChange={setTag} />
      {list.isPending ? <span className="status"><span className="spin" style={{ inlineSize: 12, blockSize: 12 }} aria-hidden /> {t("common:status.loading")}</span> : null}
      {list.data && !list.data.items.length && <Empty icon="search" title={t("bank.noneTitle")}>{q || tag ? t("bank.noMatch") : t("bank.emptyBank")}</Empty>}
      {list.data && list.data.items.length > 0 && (
        <ul className="stack tight" style={{ listStyle: "none", padding: 0, margin: 0, maxBlockSize: 380, overflowY: "auto" }}>
          {list.data.items.map((x) => (
            <li key={x.id}>
              <label className="check" style={{ alignItems: "flex-start", padding: "8px 10px", borderRadius: 8, background: picked.includes(x.id) ? "var(--accent-soft)" : "var(--surface-2)", display: "flex" }}>
                <input type="checkbox" checked={picked.includes(x.id)} onChange={() => toggle(x.id)} style={{ marginBlockStart: 3 }} />
                <span className="stack" style={{ gap: 2 }}>
                  <span>{x.text}</span>
                  <span className="small muted">
                    {x.options.map((o, i) => `${LETTERS[i]}. ${o.text}`).join(" · ")}
                  </span>
                  <span className="row tight">
                    <span className="tiny muted">{t("bank.correctIs", { letter: LETTERS[x.correct] })}</span>
                    {x.tags.map((tg) => <span key={tg} className="pill">{tg}</span>)}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {list.data && list.data.total > list.data.items.length && <p className="tiny muted">{t("bank.refine", { shown: list.data.items.length, total: list.data.total })}</p>}
      <div className="row">
        <ActionButton variant="primary" icon="plus" disabled={!picked.length || picked.length > room}
                      action={async () => { await onAdd((list.data?.items ?? []).filter((x) => picked.includes(x.id))); setPicked([]); }}>
          {t("bank.addPicked", { n: picked.length })}
        </ActionButton>
        {picked.length > room && <span className="status warn">{t("csv.noRoom", { n: room })}</span>}
      </div>
    </section>
  );
}

export function ToBank({ quizId, before, onClose }: { quizId: number; before: () => Promise<unknown>; onClose: () => void }) {
  const { t } = useTranslation("tests");
  const [tags, setTags] = useState("");
  const [done, setDone] = useState<{ added: number; skipped: number } | null>(null);
  return (
    <section className="card stack panel" aria-labelledby="to-bank-h">
      <div className="row between">
        <h3 id="to-bank-h">{t("bank.toTitle")}</h3>
        <Button size="small" variant="ghost" icon="x" onClick={onClose}>{t("common:actions.close")}</Button>
      </div>
      <p className="small muted">{t("bank.toHint")}</p>
      <label className="field">
        <span className="label">{t("bank.tagsLabel")}</span>
        <input type="text" value={tags} maxLength={200} onChange={(e) => setTags(e.target.value)} placeholder={t("bank.tagsPlaceholder")} />
      </label>
      <div className="row">
        <ActionButton variant="primary" icon="upload" action={async () => {
          await before();
          setDone(await api.post<{ added: number; skipped: number }>(`/api/tests/${quizId}/to-bank`, { tags }));
        }}>{t("bank.saveAll")}</ActionButton>
        {done && <span className="status ok" role="status">{t("bank.saved", { added: done.added, skipped: done.skipped })}</span>}
      </div>
    </section>
  );
}
