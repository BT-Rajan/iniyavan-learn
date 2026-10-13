import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { Avatar } from "@/ui/display";
import { Icon, type IconName } from "@/ui/icons";

import { useMe, useSession } from "./session";

function Item({ to, icon, label, end }: { to: string; icon: IconName; label: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `item ${isActive ? "active" : ""}`}>
      <Icon name={icon} />
      <span>{label}</span>
    </NavLink>
  );
}

export function Brand() {
  const { config } = useSession();
  return (
    <span className="brand">
      {config.logo ? <img src={config.logo} alt="" /> : <span className="mark" aria-hidden>{config.app_name.slice(0, 1)}</span>}
      <span>{config.app_name}</span>
    </span>
  );
}

/** The search field in the top bar. "/" focuses it from anywhere. */
function SearchBox() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const [q, setQ] = useState(loc.pathname === "/search" ? params.get("q") ?? "" : "");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (loc.pathname === "/search") setQ(params.get("q") ?? ""); }, [loc.pathname, params]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`);
  };
  return (
    <form className="searchbox" role="search" onSubmit={submit}>
      <Icon name="search" />
      <input ref={ref} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search.placeholder")} aria-label={t("search.label")} />
      {!q && <kbd aria-hidden>/</kbd>}
    </form>
  );
}

export function Shell() {
  const { t } = useTranslation();
  const me = useMe();
  const { signOut, isStaff, isAdmin } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => { document.querySelector<HTMLElement>(".main")?.focus({ preventScroll: true }); window.scrollTo(0, 0); }, [loc.pathname]);

  return (
    <div className="shell">
      <a href="#main" className="sr-only">{t("nav.skip")}</a>
      <nav className="nav" aria-label={t("nav.main")}>
        <Brand />
        <Item to="/" end icon="home" label={t("nav.home")} />
        <Item to="/courses" icon="book" label={t("nav.courses")} />
        <Item to="/studio/new" icon="sparkle" label={t("nav.newCourse")} />
        {isStaff && (
          <>
            <div className="section">{t("nav.teaching")}</div>
            <Item to="/bank" icon="layers" label={t("nav.bank")} />
          </>
        )}
        {isAdmin && (
          <>
            <div className="section">{t("nav.admin")}</div>
            <Item to="/admin/people" icon="users" label={t("nav.people")} />
            <Item to="/admin/programs" icon="calendar" label={t("nav.programs")} />
            <Item to="/admin/settings" icon="settings" label={t("nav.settings")} />
            <Item to="/admin/audit" icon="log" label={t("nav.audit")} />
          </>
        )}
        <div className="foot stack tight">
          <NavLink to="/profile" className={({ isActive }) => `item ${isActive ? "active" : ""}`}>
            <Avatar name={me.name} />
            <span className="grow">
              <span className="clip" style={{ display: "block", color: "var(--text)" }}>{me.name}</span>
              <span className="tiny muted">{t(`roles.${me.role}`)}</span>
            </span>
          </NavLink>
          <button type="button" className="btn ghost small" style={{ justifyContent: "flex-start" }} onClick={async () => { await signOut(); nav("/login"); }}>
            <Icon name="logout" className="flip" /> {t("auth.signOut")}
          </button>
        </div>
      </nav>
      <div className="main" id="main" tabIndex={-1} style={{ outline: "none" }}>
        <div className="topbar">
          <SearchBox />
        </div>
        <Outlet />
      </div>
      <nav className="tabbar" aria-label={t("nav.main")}>
        <NavLink to="/" end><Icon name="home" />{t("nav.home")}</NavLink>
        <NavLink to="/courses"><Icon name="book" />{t("nav.courses")}</NavLink>
        <NavLink to="/studio/new"><Icon name="sparkle" />{t("nav.newShort")}</NavLink>
        {isAdmin && <NavLink to="/admin/people"><Icon name="users" />{t("nav.admin")}</NavLink>}
        <NavLink to="/profile"><Icon name="user" />{t("nav.me")}</NavLink>
      </nav>
    </div>
  );
}
