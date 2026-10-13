/** Numbers, dates and durations through Intl, in the current language. */
import i18n from "./index";

const lang = () => i18n.language || "en";

export function fmtNumber(n: number, opts?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(lang(), opts).format(n);
}

export function fmtPercent(n: number | null | undefined) {
  return n == null ? "—" : new Intl.NumberFormat(lang(), { style: "percent", maximumFractionDigits: 0 }).format(n / 100);
}

export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) {
  return iso ? new Intl.DateTimeFormat(lang(), opts).format(new Date(iso)) : "—";
}

export function fmtDateTime(iso: string | null | undefined) {
  return fmtDate(iso, { dateStyle: "medium", timeStyle: "short" });
}

export function fmtWeekday(iso: string) {
  return new Intl.DateTimeFormat(lang(), { weekday: "narrow" }).format(new Date(iso + "T12:00:00"));
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60],
];

/** "3 days ago", "in 2 hours", "now". */
export function fmtRelative(iso: string | null | undefined) {
  if (!iso) return "—";
  const secs = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang(), { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit);
  }
  return rtf.format(0, "second");
}

/** "Water, Air and Land" in the current language. */
export function fmtList(items: string[]) {
  return new Intl.ListFormat(lang(), { style: "long", type: "conjunction" }).format(items);
}
