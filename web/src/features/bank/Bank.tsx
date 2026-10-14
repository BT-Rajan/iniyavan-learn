import { type InfiniteData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { api, ApiError, qs } from "@/api/client";
import { TagChips } from "@/features/tests/BankPanels";
import {
  type BankItem, type BankPage, blankQuestion, LETTERS, problemOf, type QDraft, QuestionFields, toPayload, useDebounced,
} from "@/features/tests/parts";
import { ActionButton, Button, ConfirmButton, SaveStatus, Switch, useAutosave } from "@/ui/controls";
import { Empty, LoadError, PageHead, PageLoading } from "@/ui/display";
import { useErrorText } from "@/ui/errors";
import { Icon } from "@/ui/icons";

const PAGE = 30;
type Pages = InfiniteData<BankPage, number>;

const toDraft = (x: BankItem): QDraft => ({
  text: x.text, image: "", options: x.options.map((o) => ({ text: o.text, image: o.image ?? "" })), correct: x.correct, explanation: x.explanation, topic_id: null, area: "",
});

/** Editing one of your own questions in place; it saves itself whenever it is complete. */
function EditItem({ item, onSaved, onDone }: { item: BankItem; onSaved: (x: BankItem) => void; onDone: () => void }) {
  const { t } = useTranslation("tests");
  const err = useErrorText();
  const [draft, setDraft] = useState<QDraft>(() => toDraft(item));
  const [tags, setTags] = useState(item.tags.join(", "));
  const problem = problemOf(draft);
  const value = { ...toPayload(draft), tags };
  const auto = useAutosave(value, async (v) => {
    const body = { text: v.text, options: v.options, correct: v.correct, explanation: v.explanation, tags: v.tags };
    await api.patch(`/api/bank/${item.id}`, body);
    onSaved({ ...item, ...body, tags: v.tags.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) });
  }, { enabled: !problem });
  return (
    <div className="stack tight fade-in" style={{ marginBlockStart: 10 }}>
      <QuestionFields value={draft} onChange={setDraft} number={1} images={false} problem={problem} head={null} />
      <label className="field">
        <span className="label">{t("bank.tagsLabel")}</span>
        <input type="text" value={tags} maxLength={200} onChange={(e) => setTags(e.target.value)} placeholder={t("bank.tagsPlaceholder")} />
      </label>
      <div className="row between">
        {problem
          ? <span className="status warn" role="status">{t("editor.notSaved", { reason: err(new ApiError(400, problem, { number: 1 })) })}</span>
          : <SaveStatus state={auto.dirty && auto.state === "idle" ? "busy" : auto.state} error={auto.error} onRetry={() => void auto.retry()} />}
        <Button size="small" icon="check" onClick={() => { void auto.retry(); onDone(); }}>{t("common:actions.done")}</Button>
      </div>
    </div>
  );
}

function Item({ item, onChange, onRemove }: { item: BankItem; onChange: (x: BankItem) => void; onRemove: () => void }) {
  const { t } = useTranslation("tests");
  const [editing, setEditing] = useState(false);
  return (
    <li className="card" style={{ padding: 14 }}>
      <details className="disclosure" open={editing || undefined}>
        <summary>
          <span className="grow">{item.text}</span>
        </summary>
        {!editing && (
          <div className="stack tight" style={{ marginBlockStart: 10 }}>
            <ol style={{ margin: 0, padding: 0, listStyle: "none" }} className="stack tight">
              {item.options.map((o, i) => (
                <li key={i} className="row tight" style={i === item.correct ? { color: "var(--good)", fontWeight: 600 } : undefined}>
                  <span className={`pill ${i === item.correct ? "good" : ""}`}>{i === item.correct ? <Icon name="check" style={{ inlineSize: 12, blockSize: 12 }} /> : LETTERS[i]}</span>
                  {o.text}
                  {i === item.correct && <span className="sr-only"> ({t("results.correct")})</span>}
                </li>
              ))}
            </ol>
            {item.explanation && <p className="small muted">{item.explanation}</p>}
          </div>
        )}
        {editing && <EditItem item={item} onSaved={onChange} onDone={() => setEditing(false)} />}
      </details>
      <div className="row between" style={{ marginBlockStart: 8 }}>
        <span className="row tight">
          {item.tags.map((tg) => <span key={tg} className="pill">{tg}</span>)}
          <span className="tiny muted">{t("bank.meta", { owner: item.owner || "—", uses: item.uses })}</span>
        </span>
        {item.can_edit && !editing && (
          <span className="row tight">
            <Button size="small" variant="ghost" icon="edit" onClick={() => setEditing(true)}>{t("common:actions.edit")}<span className="sr-only"> {item.text}</span></Button>
            <ConfirmButton confirmLabel={t("bank.deleteConfirm")} action={async () => { await api.del(`/api/bank/${item.id}`); onRemove(); }}>
              {t("common:actions.delete")}<span className="sr-only"> {item.text}</span>
            </ConfirmButton>
          </span>
        )}
      </div>
    </li>
  );
}

/** Writing a new bank question: an explicit Add, since it is something new being composed. */
function NewItem({ onAdded, onClose }: { onAdded: () => void; onClose: () => void }) {
  const { t } = useTranslation("tests");
  const [draft, setDraft] = useState<QDraft>(blankQuestion);
  const [tags, setTags] = useState("");
  const [tried, setTried] = useState(false);
  const problem = problemOf(draft);
  return (
    <section className="card stack panel" aria-labelledby="new-bank-h">
      <div className="row between">
        <h2 id="new-bank-h" style={{ fontSize: "1.05rem" }}>{t("bank.newTitle")}</h2>
        <Button size="small" variant="ghost" icon="x" onClick={onClose}>{t("common:actions.close")}</Button>
      </div>
      <QuestionFields value={draft} onChange={setDraft} number={1} images={false} problem={tried ? problem : null} />
      <label className="field">
        <span className="label">{t("bank.tagsLabel")}</span>
        <input type="text" value={tags} maxLength={200} onChange={(e) => setTags(e.target.value)} placeholder={t("bank.tagsPlaceholder")} />
      </label>
      <div className="row">
        <ActionButton variant="primary" icon="plus" action={async () => {
          setTried(true);
          if (problem) throw new ApiError(400, problem, { number: 1 });
          const p = toPayload(draft);
          await api.post("/api/bank", { text: p.text, options: p.options, correct: p.correct, explanation: p.explanation, tags });
          setDraft(blankQuestion());
          setTried(false);
          onAdded();
        }}>{t("bank.add")}</ActionButton>
      </div>
    </section>
  );
}

export default function Bank() {
  const { t } = useTranslation("tests");
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [mine, setMine] = useState(false);
  const [adding, setAdding] = useState(false);
  const query = useDebounced(q);
  const key = ["bank", query, tag, mine, "pages"] as const;
  const list = useInfiniteQuery({
    queryKey: key,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.get<BankPage>(`/api/bank${qs({ q: query, tag, mine: mine || undefined, limit: PAGE, offset: pageParam })}`),
    getNextPageParam: (last, pages) => {
      const have = pages.reduce((n, p) => n + p.items.length, 0);
      return have < last.total ? have : undefined;
    },
    placeholderData: (prev) => prev,
  });
  const edit = (fn: (items: BankItem[]) => BankItem[]) =>
    qc.setQueryData<Pages>(key, (d) => d && { ...d, pages: d.pages.map((p) => ({ ...p, items: fn(p.items) })) });

  const pages = list.data?.pages ?? [];
  const items = pages.flatMap((p) => p.items);
  const total = pages[0]?.total ?? 0;
  const tags = pages[0]?.tags ?? [];

  return (
    <div className="page narrow">
      <PageHead title={t("bank.title")} sub={t("bank.sub")}
                actions={!adding && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>{t("bank.newTitle")}</Button>} />
      <div className="stack">
        {adding && <NewItem onClose={() => setAdding(false)} onAdded={() => void qc.invalidateQueries({ queryKey: ["bank"] })} />}
        <div className="row">
          <div className="searchbox grow" style={{ maxInlineSize: "none" }}>
            <Icon name="search" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("bank.search")} aria-label={t("bank.search")} />
          </div>
          <Switch checked={mine} onChange={setMine} label={<span className="small">{t("bank.mine")}</span>} />
        </div>
        <TagChips tags={tags} value={tag} onChange={setTag} />
        {list.isPending ? <PageLoading /> : list.isError ? <LoadError error={list.error} retry={() => void list.refetch()} /> : (
          <>
            <p className="small muted" role="status">{t("bank.count", { n: total })}</p>
            {!items.length ? (
              <Empty icon="layers" title={t("bank.noneTitle")}>{q || tag || mine ? t("bank.noMatch") : t("bank.emptyBank")}</Empty>
            ) : (
              <ul className="stack tight" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {items.map((x) => (
                  <Item key={x.id} item={x}
                        onChange={(next) => edit((xs) => xs.map((y) => (y.id === next.id ? next : y)))}
                        onRemove={() => edit((xs) => xs.filter((y) => y.id !== x.id))} />
                ))}
              </ul>
            )}
            {list.hasNextPage && (
              <div className="row" style={{ justifyContent: "center" }}>
                <Button busy={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t("common:actions.showMore")}</Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
