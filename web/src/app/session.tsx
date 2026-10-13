/** Who is signed in, and the institution's public settings. One query each; everything else reads them from here. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect } from "react";

import { api, ApiError } from "@/api/client";
import type { Me, PublicConfig } from "@/api/types";
import { applyLanguage } from "@/i18n";

interface Session {
  me: Me | null;
  config: PublicConfig;
  loading: boolean;
  signedIn: (me: Me) => void;
  signOut: () => Promise<void>;
  isStaff: boolean;
  isAdmin: boolean;
}

const Ctx = createContext<Session | null>(null);
const FALLBACK: PublicConfig = { app_name: "Iniyavan Learn", logo: "", registration: false, password_reset: false, locales: ["en"] };

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ["config"], queryFn: () => api.get<PublicConfig>("/api/auth/config"), staleTime: 5 * 60_000 });
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.get<Me>("/api/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  });

  useEffect(() => {
    const lost = () => qc.setQueryData(["me"], null);
    window.addEventListener("auth:lost", lost);
    return () => window.removeEventListener("auth:lost", lost);
  }, [qc]);

  useEffect(() => { if (me.data?.locale) void applyLanguage(me.data.locale); }, [me.data?.locale]);
  useEffect(() => { document.title = config.data?.app_name ?? FALLBACK.app_name; }, [config.data?.app_name]);

  /** Another person's data must not linger in the cache; the session queries themselves stay subscribed. */
  const forgetData = () => qc.removeQueries({ predicate: (q) => !["me", "config"].includes(String(q.queryKey[0])) });

  const value: Session = {
    me: me.data ?? null,
    config: config.data ?? FALLBACK,
    loading: me.isPending,
    signedIn: (m) => { forgetData(); qc.setQueryData(["me"], m); },
    signOut: async () => {
      await api.post("/api/auth/logout").catch(() => undefined);
      forgetData();
      qc.setQueryData(["me"], null);
    },
    isStaff: me.data?.role === "admin" || me.data?.role === "faculty",
    isAdmin: me.data?.role === "admin",
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

/** The signed-in person (screens behind RequireAuth only). */
export function useMe(): Me {
  const { me } = useSession();
  if (!me) throw new Error("useMe without a session");
  return me;
}
