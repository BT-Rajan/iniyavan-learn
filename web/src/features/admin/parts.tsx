/**
 * Small pieces the admin screens share: copying text, client-side CSV files, the list of new sign-in details,
 * the programs query and the program patterns. Kept here (not in src/ui) because only admin screens use them.
 */
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "@/api/client";
import type { Program } from "@/api/types";
import { Button } from "@/ui/controls";
import { Notice } from "@/ui/display";

export const usePrograms = () => useQuery({ queryKey: ["programs"], queryFn: () => api.get<Program[]>("/api/programs") });

/** R-PROG-1/2: the most terms a pattern allows, and how many a new program gets by default. */
export const PATTERNS = { semester: { max: 8, def: 8 }, year: { max: 8, def: 4 }, grade: { max: 12, def: 12 } } as const;
export type Pattern = keyof typeof PATTERNS;

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* not allowed here (plain http, older browser): fall back to a hidden textarea */
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand("copy");
  el.remove();
  if (!ok) throw new Error("copy");
}

/** A button that copies `text` and says so in its own label; if the browser refuses, it says that beside it. */
export function CopyButton({ text, label, size = "small", variant = "default" }: { text: string; label?: ReactNode; size?: "small" | "lg"; variant?: "default" | "ghost" }) {
  const { t } = useTranslation("admin");
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    window.clearTimeout(timer.current);
    try {
      await writeClipboard(text);
      setState("done");
    } catch {
      setState("error");
    }
    timer.current = window.setTimeout(() => setState("idle"), 2200);
  };
  return (
    <span className="row tight" style={{ display: "inline-flex" }}>
      <Button size={size} variant={variant} icon={state === "done" ? "check" : "copy"} className={state === "done" ? "done" : ""} onClick={() => void copy()}>
        {state === "done" ? t("common:actions.copied") : label ?? t("common:actions.copy")}
      </Button>
      <span role="status" aria-live="polite" className={state === "error" ? "status err fade-in" : "sr-only"}>
        {state === "error" ? t("copy.failed") : state === "done" ? t("common:actions.copied") : ""}
      </span>
    </span>
  );
}

/** One CSV cell: quoted when needed, and never read as a formula by a spreadsheet (R-REP-1). */
function cell(v: string | number | null | undefined) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | null | undefined)[][]) {
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Saves text as a file on the viewer's device, without a round trip to the server. */
export function downloadFile(name: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface Credential { name: string; email: string; password: string }

/** New sign-in details, shown once: copy them all, or save them as a CSV file. */
export function Credentials({ items, file = "sign-in-details.csv" }: { items: Credential[]; file?: string }) {
  const { t } = useTranslation("admin");
  if (!items.length) return null;
  const header = [t("credentials.name"), t("credentials.email"), t("credentials.password")];
  const asText = [header, ...items.map((c) => [c.name, c.email, c.password])].map((r) => r.join("\t")).join("\n");
  return (
    <div className="stack tight fade-in">
      <Notice tone="warn" icon="key" title={t("credentials.title", { n: items.length })}>{t("credentials.once")}</Notice>
      <div className="table-wrap" style={{ position: "relative", maxBlockSize: 320, overflowY: "auto" }}>
        <table className="table">
          <thead><tr>{header.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.email}>
                <td>{c.name}</td>
                <td className="muted">{c.email}</td>
                <td><code style={{ fontFamily: "var(--mono)" }}>{c.password}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <CopyButton text={asText} label={t("credentials.copyAll")} />
        <Button size="small" icon="download" onClick={() => downloadFile(file, toCsv([["name", "email", "password"], ...items.map((c) => [c.name, c.email, c.password])]))}>
          {t("common:actions.downloadCsv")}
        </Button>
      </div>
    </div>
  );
}

/** A titled card with an optional hint and a status slot on the end. */
export function Section({ title, hint, status, children, id }: { title: ReactNode; hint?: ReactNode; status?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="card stack" aria-labelledby={id}>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div className="stack tight grow">
          <h2 id={id}>{title}</h2>
          {hint && <p className="small muted">{hint}</p>}
        </div>
        {status}
      </div>
      {children}
    </section>
  );
}
