// Checks the words of the app:
// 1. every message in every locale file is valid ICU;
// 2. every language has exactly the keys English has;
// 3. every literal t("key") / t("ns:key") in the source exists in English.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { IntlMessageFormat } from "intl-messageformat";

const root = new URL("../src/", import.meta.url).pathname;
const locales = join(root, "i18n/locales");
const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]]));
const problems = [];
const langs = {};
for (const lang of readdirSync(locales)) {
  langs[lang] = {};
  for (const f of readdirSync(join(locales, lang))) {
    const ns = f.replace(/\.json$/, "");
    for (const [k, v] of flat(JSON.parse(readFileSync(join(locales, lang, f), "utf8")))) {
      langs[lang][`${ns}:${k}`] = v;
      try { new IntlMessageFormat(v, lang); } catch (e) { problems.push(`${lang}/${ns}: "${k}" is not valid ICU (${e.message})`); }
    }
  }
}
const en = langs.en;
for (const [lang, keys] of Object.entries(langs)) {
  if (lang === "en") continue;
  for (const k of Object.keys(en)) if (!(k in keys)) problems.push(`${lang}: missing ${k}`);
  for (const k of Object.keys(keys)) if (!(k in en)) problems.push(`${lang}: extra ${k}`);
}
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.tsx?$/.test(f) ? [join(d, f)] : []));
const plural = (k) => [k, `${k}_one`, `${k}_other`];
for (const file of walk(root)) {
  const src = readFileSync(file, "utf8");
  const scopes = [...src.matchAll(/useTranslation\(\s*(?:"([^"]+)")?/g)].map((m) => [m.index, m[1] || "common"]);
  for (const m of src.matchAll(/\bt\(\s*"([^"]+)"/g)) {
    if (m[1].includes("…")) continue; // examples in comments
    const ns = scopes.filter(([at]) => at < m.index).pop()?.[1] ?? "common";
    const key = m[1].includes(":") ? m[1] : `${ns}:${m[1]}`;
    if (!plural(key).some((k) => k in en) && !Object.keys(en).some((k) => k.startsWith(`${key}.`))) {
      problems.push(`${file.replace(root, "src/")}: no English text for "${key}"`);
    }
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log(`i18n ok: ${Object.keys(en).length} messages, ${Object.keys(langs).length} language(s).`);
