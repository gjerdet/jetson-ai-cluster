import { useEffect, useState } from "react";
import { BackendError, backendUrl, onBackendState } from "@/lib/backend";

/**
 * Diskret indikator i HUD-headeren: viser når kontakten med den lokale
 * backend-en ryker, med konkret råd fra feilkontrakten.
 */
export function BackendStatusBadge() {
  const [state, setState] = useState<{ online: boolean; error: BackendError | null }>({
    online: true,
    error: null,
  });

  useEffect(() => {
    const av = onBackendState(setState);
    return () => {
      av();
    };
  }, []);

  if (state.online) return null;

  const e = state.error;
  return (
    <div
      className="max-w-[42ch] rounded-full border border-destructive/30 bg-destructive/[0.08] px-3 py-1 text-[9px] leading-relaxed tracking-[0.1em] text-destructive/80"
      title={`${e?.message ?? ""} ${e?.raad ?? ""}`.trim() || backendUrl()}
    >
      BACKEND OFFLINE{e?.code ? ` · ${e.code.toUpperCase()}` : ""}
    </div>
  );
}
