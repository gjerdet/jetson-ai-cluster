/**
 * Økt mot den lokale Jarvis-backend-en (agent/server.mjs).
 * Tokenet ligger i sessionStorage – her holder vi bare styr på brukeren.
 */
import { useCallback, useEffect, useState } from "react";
import { backend, backendToken, safe, type BackendStatus, type BackendUser } from "@/lib/backend";

export type SessionState = "sjekker" | "inne" | "ute";

const LOKAL_KEY = "jarvis.lokal-modus";

/** Lokal modus: bruk HUD-en uten at agenten kjører (alt lagres i nettleseren). */
export function lokalModus() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(LOKAL_KEY) === "1";
}

export function settLokalModus(på: boolean) {
  if (typeof window === "undefined") return;
  if (på) window.localStorage.setItem(LOKAL_KEY, "1");
  else window.localStorage.removeItem(LOKAL_KEY);
}

const LOKAL_BRUKER: BackendUser = {
  id: "lokal",
  email: "lokal@jarvis",
  role: "admin",
};

export function useSession() {
  const [state, setState] = useState<SessionState>("sjekker");
  const [user, setUser] = useState<BackendUser | null>(null);
  const [status, setStatus] = useState<BackendStatus | null>(null);

  const refresh = useCallback(async () => {
    if (lokalModus()) {
      setUser(LOKAL_BRUKER);
      setState("inne");
      const sl = await safe(() => backend.status());
      setStatus(sl.data);
      return;
    }
    const s = await safe(() => backend.status());
    setStatus(s.data);
    if (!backendToken()) {
      setUser(null);
      setState("ute");
      return;
    }
    const m = await safe(() => backend.me());
    setUser(m.data);
    setState(m.data ? "inne" : "ute");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loggUt = useCallback(async () => {
    await safe(() => backend.logout());
    setUser(null);
    setState("ute");
  }, []);

  return { state, user, status, refresh, loggUt };
}
