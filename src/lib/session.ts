/**
 * Økt mot den lokale Jarvis-backend-en (agent/server.mjs).
 * Tokenet ligger i sessionStorage – her holder vi bare styr på brukeren.
 */
import { useCallback, useEffect, useState } from "react";
import { backend, backendToken, safe, type BackendStatus, type BackendUser } from "@/lib/backend";
import { KREV_INNLOGGING, LOKAL_BRUKER } from "@/lib/auth-mode";

export type SessionState = "sjekker" | "inne" | "ute";

export function useSession() {
  const [state, setState] = useState<SessionState>("sjekker");
  const [user, setUser] = useState<BackendUser | null>(null);
  const [status, setStatus] = useState<BackendStatus | null>(null);

  const refresh = useCallback(async () => {
    const s = await safe(() => backend.status());
    setStatus(s.data);
    if (!KREV_INNLOGGING) {
      // Innlogging er slått av (lokalt miljø): alle regnes som lokal admin.
      setUser((LOKAL_BRUKER as unknown) as BackendUser);
      setState("inne");
      return;
    }
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
