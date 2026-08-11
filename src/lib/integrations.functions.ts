import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Proxy mot lokale systemer (TrueNAS, Proxmox, UniFi, Homey …).
 * Kalles fra nettleseren for å unngå CORS-blokkering.
 */
export const fetchIntegration = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        baseUrl: z.string().url(),
        path: z.string().max(300).default("/"),
        token: z.string().max(2000).optional(),
        kind: z.string().max(40).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const url = `${data.baseUrl.replace(/\/$/, "")}/${data.path.replace(/^\//, "")}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (data.token) {
      headers["Authorization"] =
        data.kind === "proxmox" ? `PVEAPIToken=${data.token}` : `Bearer ${data.token}`;
      headers["X-API-KEY"] = data.token;
    }
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
      const text = await res.text();
      if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
      try {
        return { ok: true as const, data: JSON.parse(text) as unknown };
      } catch {
        return { ok: true as const, data: text.slice(0, 4000) as unknown };
      }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "Ukjent nettverksfeil",
      };
    }
  });
