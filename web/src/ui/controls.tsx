/**
 * Interaction primitives. The rules they enforce (ARCHITECTURE "interaction principles"):
 * - feedback appears where the action happened (inside the button, next to the field) — never a popup or toast;
 * - nothing asks "are you sure?" in a dialog: reversible actions offer Undo in place, irreversible ones confirm inline;
 * - edits save themselves; the status says so quietly.
 */
import {
  type ButtonHTMLAttributes,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { useErrorText } from "./errors";
import { Icon, type IconName } from "./icons";

type Variant = "primary" | "ghost" | "danger" | "default";

export function Button({
  variant = "default", size, icon, busy, block, children, className = "", ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "small" | "lg"; icon?: IconName; busy?: boolean; block?: boolean }) {
  const cls = ["btn", variant !== "default" && variant, size, block && "block", !children && "icon-only", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} aria-busy={busy || undefined} disabled={busy || rest.disabled} {...rest}>
      {busy ? <span className="spin" aria-hidden /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export type ActionState = "idle" | "busy" | "done" | "error";

/** Runs an async action and remembers how it went, so the control that started it can show the result. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, opts: { onDone?: (r: R) => void; doneFor?: number } = {}) {
  const [state, setState] = useState<ActionState>("idle");
  const [error, setError] = useState<unknown>(null);
  const timer = useRef<number>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; window.clearTimeout(timer.current); };
  }, []);
  const latest = useRef({ fn, opts });
  latest.current = { fn, opts };
  /** Resolves to true when the action succeeded. */
  const run = useCallback(async (...args: A): Promise<boolean> => {
    window.clearTimeout(timer.current);
    setState("busy");
    setError(null);
    try {
      const r = await latest.current.fn(...args);
      if (!alive.current) return true;
      setState("done");
      latest.current.opts.onDone?.(r);
      timer.current = window.setTimeout(() => alive.current && setState("idle"), latest.current.opts.doneFor ?? 1800);
      return true;
    } catch (e) {
      if (alive.current) {
        setState("error");
        setError(e);
      }
      return false;
    }
  }, []);
  const reset = useCallback(() => { setState("idle"); setError(null); }, []);
  return { run, state, error, busy: state === "busy", reset };
}

/** A button whose own label reports progress and success; a failure is written right beside it. */
export function ActionButton({
  action, children, doneLabel, variant, size, icon, block, disabled, className, title, onDone, type = "button",
}: {
  action: () => Promise<unknown>; children: ReactNode; doneLabel?: ReactNode; variant?: Variant; size?: "small" | "lg"; icon?: IconName;
  block?: boolean; disabled?: boolean; className?: string; title?: string; onDone?: (r: unknown) => void; type?: "button" | "submit";
}) {
  const { t } = useTranslation();
  const a = useAction(action, { onDone });
  const err = useErrorText();
  return (
    <span className={`row tight ${block ? "grow" : ""}`} style={{ display: block ? "flex" : "inline-flex" }}>
      <Button type={type} variant={variant} size={size} icon={a.state === "done" ? "check" : icon} busy={a.busy} block={block} disabled={disabled}
              className={`${a.state === "done" ? "done" : ""} ${className ?? ""}`} title={title} onClick={() => void a.run()}>
        {a.state === "done" && doneLabel !== undefined ? doneLabel : children}
      </Button>
      <span role="status" aria-live="polite" className={a.state === "error" ? "status err fade-in" : "sr-only"}>
        {a.state === "error" ? err(a.error) : a.state === "done" ? t("status.done") : ""}
      </span>
    </span>
  );
}

/** "Saving…", "Saved", or what went wrong — the quiet status line of autosaving things. */
export function SaveStatus({ state, error, onRetry }: { state: ActionState; error?: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const err = useErrorText();
  return (
    <span role="status" aria-live="polite" className={`status ${state === "done" ? "ok" : state === "error" ? "err" : ""}`}>
      {state === "busy" && <><span className="spin" style={{ inlineSize: 12, blockSize: 12 }} aria-hidden /> {t("status.saving")}</>}
      {state === "done" && <><Icon name="check" /> {t("status.saved")}</>}
      {state === "error" && (
        <>
          {err(error)}
          {onRetry && <button type="button" className="btn ghost small" onClick={onRetry}>{t("actions.retry")}</button>}
        </>
      )}
    </span>
  );
}

/** Saves `value` a moment after the person stops typing, and when they leave the page. */
export function useAutosave<T>(value: T, save: (v: T) => Promise<unknown>, { delay = 800, enabled = true } = {}) {
  const [state, setState] = useState<ActionState>("idle");
  const [error, setError] = useState<unknown>(null);
  const last = useRef(JSON.stringify(value));
  const pending = useRef<T | null>(null);
  const saving = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(async () => {
    if (saving.current || pending.current === null) return;
    const v = pending.current;
    pending.current = null;
    saving.current = true;
    setState("busy");
    let ok = false;
    try {
      await saveRef.current(v);
      last.current = JSON.stringify(v);
      setState("done");
      setError(null);
      ok = true;
    } catch (e) {
      pending.current = pending.current ?? v; // keep it so a retry (or the next edit) sends it again
      setState("error");
      setError(e);
    } finally {
      saving.current = false;
      if (ok && pending.current !== null) window.setTimeout(() => void flush(), 0); // edits made while saving
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const s = JSON.stringify(value);
    if (s === last.current) return;
    pending.current = value;
    const id = window.setTimeout(() => void flush(), delay);
    return () => window.clearTimeout(id);
  }, [value, enabled, delay, flush]);

  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (pending.current !== null || saving.current) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => {
      window.removeEventListener("beforeunload", leave);
      void flush(); // leaving the screen inside the app
    };
  }, [flush]);

  const dirty = JSON.stringify(value) !== last.current;
  return { state: dirty && state !== "busy" && state !== "error" ? ("idle" as ActionState) : state, error, retry: flush, dirty };
}

/** Text that turns into an input when clicked; Enter or leaving saves, Escape cancels. */
export function InlineText({
  value, onSave, placeholder, label, as: Tag = "span", className = "", maxLength = 200, multiline, disabled,
}: {
  value: string; onSave: (v: string) => Promise<unknown>; placeholder?: string; label: string; as?: "span" | "h1" | "h2" | "h3" | "p";
  className?: string; maxLength?: number; multiline?: boolean; disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const a = useAction(onSave, { doneFor: 1200 });
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select(); } }, [editing]);
  if (disabled) return <Tag className={className}>{value || <span className="faint">{placeholder}</span>}</Tag>;

  const commit = async () => {
    const v = draft.trim();
    if (v === value.trim()) { setEditing(false); return; }
    if (!v && !multiline) { setDraft(value); setEditing(false); return; }
    if (await a.run(v)) setEditing(false);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") { setDraft(value); setEditing(false); a.reset(); }
    if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); void commit(); }
  };
  if (editing) {
    const props = {
      ref, value: draft, maxLength, "aria-label": label, className: "inline-input",
      onChange: (e: { target: { value: string } }) => setDraft(e.target.value), onKeyDown: key, onBlur: () => void commit(),
    };
    return (
      <Tag className={className} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {multiline ? <textarea rows={3} {...props} /> : <input type="text" {...props} />}
        {a.state === "error" && <SaveStatus state="error" error={a.error} />}
      </Tag>
    );
  }
  return (
    <Tag className={className}>
      <span
        role="button" tabIndex={0} title={label} aria-label={`${label}: ${value || placeholder || ""}`}
        className={`editable ${value ? "" : "placeholder"}`}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditing(true); } }}
      >
        {value || placeholder}
      </span>
      {a.state === "busy" && <span className="spin" style={{ inlineSize: 12, blockSize: 12, marginInlineStart: 8 }} aria-hidden />}
      {a.state === "done" && <span className="status ok fade-in" style={{ marginInlineStart: 8 }}><Icon name="check" /></span>}
    </Tag>
  );
}

/** For things that cannot be undone: the first press arms the button, the second does it. It disarms itself. */
export function ConfirmButton({
  action, children, confirmLabel, icon = "trash", size = "small", onDone,
}: { action: () => Promise<unknown>; children: ReactNode; confirmLabel: ReactNode; icon?: IconName; size?: "small" | "lg"; onDone?: () => void }) {
  const { t } = useTranslation();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(id);
  }, [armed]);
  if (!armed) return <Button variant="danger" size={size} icon={icon} onClick={() => setArmed(true)}>{children}</Button>;
  return (
    <span className="row tight fade-in">
      <ActionButton variant="danger" className="solid" size={size} icon={icon} action={action} onDone={() => { setArmed(false); onDone?.(); }}>
        {confirmLabel}
      </ActionButton>
      <Button variant="ghost" size={size} onClick={() => setArmed(false)}>{t("actions.keep")}</Button>
    </span>
  );
}

/**
 * Reversible removals: do it now, and leave an Undo in its place for a few seconds.
 * `const undo = useUndo(); undo.offer(t("…archived"), () => api.put(…, {archived:false}))` and render `<UndoBar undo={undo}/>`.
 */
export function useUndo(ms = 8000) {
  const [offer, setOffer] = useState<{ id: number; message: string; revert: () => Promise<unknown> } | null>(null);
  useEffect(() => {
    if (!offer) return;
    const id = window.setTimeout(() => setOffer(null), ms);
    return () => window.clearTimeout(id);
  }, [offer, ms]);
  return {
    offer: (message: string, revert: () => Promise<unknown>) => setOffer({ id: Date.now(), message, revert }),
    current: offer,
    clear: () => setOffer(null),
  };
}

export function UndoBar({ undo }: { undo: ReturnType<typeof useUndo> }) {
  const { t } = useTranslation();
  if (!undo.current) return null;
  const { message, revert } = undo.current;
  return (
    <div className="undo fade-in" role="status" aria-live="polite">
      <span className="grow">{message}</span>
      <ActionButton size="small" variant="ghost" icon="undo" action={async () => { await revert(); undo.clear(); }}>{t("actions.undo")}</ActionButton>
      <Button size="small" variant="ghost" icon="x" aria-label={t("actions.dismiss")} onClick={undo.clear} />
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled, busy }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; busy?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled || busy} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden />
      <span>{label}</span>
      {busy && <span className="spin" style={{ inlineSize: 12, blockSize: 12 }} aria-hidden />}
    </label>
  );
}

/** A switch that saves itself and shows how it went. */
export function SavingSwitch({ checked, save, label }: { checked: boolean; save: (v: boolean) => Promise<unknown>; label: ReactNode }) {
  const [v, setV] = useState(checked);
  const a = useAction(save);
  useEffect(() => setV(checked), [checked]);
  return (
    <span className="row tight">
      <Switch checked={v} busy={a.busy} label={label} onChange={async (next) => { setV(next); if (!(await a.run(next))) setV(!next); }} />
      {a.state === "error" && <SaveStatus state="error" error={a.error} />}
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: string; children: (id: string, describedBy?: string) => ReactNode }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className="field" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label htmlFor={id} className="label" style={{ fontWeight: 560, fontSize: "0.9rem" }}>{label}</label>
      {children(id, [hintId, errId].filter(Boolean).join(" ") || undefined)}
      {hint && <span id={hintId} className="hint small muted">{hint}</span>}
      {error && <span id={errId} className="field-error fade-in">{error}</span>}
    </div>
  );
}

/**
 * Reorder by dragging the handle, or with the keyboard (focus the handle, Alt+↑/↓).
 * `onMove` receives the new order of ids; the list updates at once and the caller saves it.
 */
export function useSortable(ids: number[], onMove: (ids: number[]) => void) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<{ id: number; after: boolean } | null>(null);
  const move = (from: number, to: number) => {
    const next = ids.filter((x) => x !== from);
    const i = next.indexOf(to);
    if (i < 0) return;
    next.splice(over?.after ? i + 1 : i, 0, from);
    if (next.join() !== ids.join()) onMove(next);
  };
  return {
    handle: (id: number, label: string) => ({
      draggable: true,
      "aria-label": label,
      className: "drag",
      onDragStart: (e: DragEvent) => { setDragging(id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(id)); },
      onDragEnd: () => { setDragging(null); setOver(null); },
      onKeyDown: (e: KeyboardEvent) => {
        if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        e.preventDefault();
        const i = ids.indexOf(id);
        const j = e.key === "ArrowUp" ? i - 1 : i + 1;
        if (j < 0 || j >= ids.length) return;
        const next = [...ids];
        [next[i], next[j]] = [next[j], next[i]];
        onMove(next);
      },
    }),
    row: (id: number) => ({
      className: dragging === id ? "dragging" : over?.id === id ? (over.after ? "drop-after" : "drop-before") : "",
      onDragOver: (e: DragEvent) => {
        if (dragging === null || dragging === id) return;
        e.preventDefault();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setOver({ id, after: e.clientY > r.top + r.height / 2 });
      },
      onDrop: (e: DragEvent) => { e.preventDefault(); if (dragging !== null) move(dragging, id); setDragging(null); setOver(null); },
    }),
  };
}
