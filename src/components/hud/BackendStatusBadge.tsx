import { useEffect, useState } from "react";
import { BackendError, backendUrl, onBackendState, safe, backend } from "@/lib/backend";
import { ERROR_CODES } from "@/lib/contract";
import { TlsHjelp } from "@/components/hud/TlsHjelp";

/**
 * Diskret indikator i HUD-headeren: viser når kontakten med den lokale
 * backend-en ryker, med konkret råd fra feilkontrakten.
 */
export function BackendStatusBadge() {
  const [state, setState] = useState<{ online: boolean; error: BackendError | null }>({
    online: true,
    error: null,
  });
  const [apen, setApen] = useState(false);

  useEffect(() => {
    const av = onBackendState(setState);
    return () => {
      av();
    };
  }, []);

  if (state.online) return null;

  const e = state.error;
  const erTls = e?.code === ERROR_CODES.TLS;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setApen((v) => !v)}
        className="max-w-[42ch] rounded-full border border-destructive/30 bg-destructive/[0.08] px-3 py-1 text-[9px] leading-relaxed tracking-[0.1em] text-destructive/80"
        title={`${e?.message ?? ""} ${e?.raad ?? ""}`.trim() || backendUrl()}
      >
        BACKEND OFFLINE{e?.code ? ` · ${e.code.toUpperCase()}` : ""}
      </button>

      {apen ? (
        <div className="absolute right-0 z-50 mt-2 w-[34rem] max-w-[90vw] rounded-2xl border border-primary/20 bg-background/85 p-4 backdrop-blur-xl">
          <div className="text-[10px] leading-relaxed text-foreground/70">{e?.message}</div>
          {e?.raad ? (
            <div className="mt-1 text-[9px] leading-relaxed text-foreground/45">{e.raad}</div>
          ) : null}
          <div className="mt-3">
            {erTls ? (
              <TlsHjelp
                onRetry={() => {
                  void safe(() => backend.status());
                }}
              />
            ) : (
              <div className="text-[9px] leading-relaxed text-foreground/45">
                Adresse: {backendUrl()}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
