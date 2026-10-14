/**
 * i18n: every word the app shows lives in src/i18n/locales/<lang>/<namespace>.json as an ICU message.
 * Adding a language = adding a folder with the same files and listing it in LANGUAGES. Direction (RTL) and
 * number/date formats follow the language automatically.
 */
import i18n from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";

const files = import.meta.glob("./locales/*/*.json", { eager: true, import: "default" }) as Record<string, Record<string, unknown>>;

export const LANGUAGES: Record<string, { name: string; dir: "ltr" | "rtl" }> = {
  en: { name: "English", dir: "ltr" },
  ar: { name: "العربية", dir: "rtl" },
};

const resources: Record<string, Record<string, Record<string, unknown>>> = {};
for (const [path, messages] of Object.entries(files)) {
  const [, lang, ns] = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/)!;
  (resources[lang] ??= {})[ns] = messages;
}
export const NAMESPACES = Object.keys(resources.en);

function stored(): string {
  try {
    return localStorage.getItem("lang") || "";
  } catch {
    return "";
  }
}

function pick(): string {
  const wanted = [stored(), ...navigator.languages].map((l) => l.split("-")[0]);
  return wanted.find((l) => l in LANGUAGES) ?? "en";
}

/** Remembered when someone picks a language before signing in, so their account can take it. */
export function pickedBeforeSignIn(): string | null {
  try { return sessionStorage.getItem("lang-picked"); } catch { return null; }
}
export function choose(lang: string) {
  try { sessionStorage.setItem("lang-picked", lang); } catch { /* ignore */ }
  return applyLanguage(lang);
}

export function applyLanguage(lang: string) {
  const l = lang in LANGUAGES ? lang : "en";
  document.documentElement.lang = l;
  document.documentElement.dir = LANGUAGES[l].dir;
  try {
    localStorage.setItem("lang", l);
  } catch {
    /* private mode: the choice lasts for this visit */
  }
  return i18n.changeLanguage(l);
}

void i18n
  .use(ICU)
  .use(initReactI18next)
  .init({
    resources,
    lng: pick(),
    fallbackLng: "en",
    ns: NAMESPACES,
    defaultNS: "common",
    interpolation: { escapeValue: false },
    returnNull: false,
  });
document.documentElement.lang = i18n.language;
document.documentElement.dir = LANGUAGES[i18n.language]?.dir ?? "ltr";

export default i18n;
