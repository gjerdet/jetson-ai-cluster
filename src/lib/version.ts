/**
 * Versjonsinfo for HUD-en og hjelpere for konfig-pakker.
 *
 * En konfig-pakke inneholder både backend-dokumentene (fra agenten) og
 * HUD-ens lokale oppsett, slik at en ny Jetson-node kan hente ned alt
 * i én operasjon i stedet for at du setter opp på nytt.
 */
import { CONFIG_BUNDLE_VERSION } from "./contract";
import type { ConfigBundle } from "./backend";

/** Versjonen på HUD-en (frontend). Økes ved funksjonsendringer. */
export const APP_VERSION = "2.2.0";

/** Nøkkelen HUD-ens eget oppsett ligger på i localStorage. */
export const HUD_STORAGE_KEY = "hud.config.v1";

/** Nøkler i localStorage som følger med i en konfig-pakke. */
export const HUD_KEYS = [
  HUD_STORAGE_KEY,
  "hud.backend.url",
  "hud.voice.v1",
  "hud.map.layers.v1",
];

export type FullBundle = ConfigBundle & {
  hud?: { versjon: string; nokler: Record<string, unknown> };
};

export function lesHudDel(): FullBundle["hud"] {
  if (typeof window === "undefined") return { versjon: APP_VERSION, nokler: {} };
  const nokler: Record<string, unknown> = {};
  for (const k of HUD_KEYS) {
    const raw = localStorage.getItem(k);
    if (raw == null) continue;
    try {
      nokler[k] = JSON.parse(raw);
    } catch {
      nokler[k] = raw;
    }
  }
  return { versjon: APP_VERSION, nokler };
}

/** Skriver HUD-delen av en pakke tilbake til localStorage. Returnerer antall nøkler. */
export function skrivHudDel(hud: FullBundle["hud"]): number {
  if (!hud?.nokler || typeof window === "undefined") return 0;
  let n = 0;
  for (const [k, v] of Object.entries(hud.nokler)) {
    if (!HUD_KEYS.includes(k)) continue;
    localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
    n++;
  }
  return n;
}

/** Tom pakke – brukes når backend er nede og bare HUD-en eksporteres. */
export function tomPakke(): FullBundle {
  return {
    type: "jarvis-konfig",
    pakkeversjon: CONFIG_BUNDLE_VERSION,
    laget: new Date().toISOString(),
    dokumenter: {},
  };
}

export function lastNedPakke(pakke: FullBundle) {
  const navn = `jarvis-konfig-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  const blob = new Blob([JSON.stringify(pakke, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = navn;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return navn;
}

export async function lesPakkeFraFil(file: File): Promise<FullBundle> {
  const tekst = await file.text();
  const pakke = JSON.parse(tekst) as FullBundle;
  if (pakke?.type !== "jarvis-konfig") throw new Error("Filen er ikke en Jarvis konfig-pakke.");
  if (Number(pakke.pakkeversjon) > CONFIG_BUNDLE_VERSION)
    throw new Error(`Pakken er laget av en nyere versjon (${pakke.pakkeversjon}). Oppdater HUD-en først.`);
  return pakke;
}
