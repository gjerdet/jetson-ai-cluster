/**
 * Felles synk-lag mellom HUD-panelene og den lokale backend-en.
 *
 * Regel: alle paneler leser og lagrer via backend-rutene når du er innlogget.
 * Feiler en rute (nede, uten tilgang, tidsavbrudd), faller panelet automatisk
 * tilbake til lokal tilstand i stedet for å vise en tom eller ødelagt skjerm.
 */
import { backend, backendToken, safe, type BackendRule, type Sample as BackendSample } from "@/lib/backend";
import type { AlertRule, RuleAction } from "@/lib/hud-store";
import type { Sample as LocalSample } from "@/lib/mqtt-bridge";

export type Kilde = "backend" | "lokal";

export type SyncResult<T> = {
  data: T;
  kilde: Kilde;
  /** norsk feiltekst når backend-ruten feilet og vi falt tilbake lokalt */
  feil: string | null;
};

/** Er vi innlogget mot backend-en? Uten token gir rutene 401. */
export const paalogget = () => !!backendToken();

/**
 * Kjør et backend-kall med lokal reserve. Kaster aldri – panelene får
 * alltid noe å vise, sammen med kilden dataene kom fra.
 */
export async function medFallback<T>(hent: () => Promise<T>, lokal: () => T): Promise<SyncResult<T>> {
  if (!paalogget()) return { data: lokal(), kilde: "lokal", feil: null };
  const r = await safe(hent);
  if (r.error) return { data: lokal(), kilde: "lokal", feil: `${r.error.message} ${r.error.raad}`.trim() };
  return { data: r.data, kilde: "backend", feil: null };
}

// ---- regler: AlertRule (HUD) <-> BackendRule (agent) ----

type AgentAction = BackendRule["handlinger"][number];

const OPERATOR: Record<AlertRule["kind"], BackendRule["operator"]> = {
  above: "over",
  below: "under",
  equals: "lik",
  stale: "endres",
};
const KIND: Record<string, AlertRule["kind"]> = {
  over: "above",
  under: "below",
  lik: "equals",
  endres: "stale",
};

const tilAgentHandling = (a: RuleAction): AgentAction => {
  if (a.kind === "mqtt") return { type: "mqtt", emne: a.topic, payload: a.payload };
  if (a.kind === "telegram") return { type: "telegram", tekst: a.text };
  return { type: "logg", tekst: a.text };
};

const fraAgentHandling = (a: AgentAction, i: number): RuleAction => {
  const id = `a-${i}-${Math.random().toString(36).slice(2, 6)}`;
  if (a.type === "mqtt") return { id, kind: "mqtt", topic: a.emne ?? "", payload: a.payload ?? "" };
  if (a.type === "telegram") return { id, kind: "telegram", text: a.tekst ?? "" };
  return { id, kind: "notify", text: a.tekst ?? "" };
};

export function tilBackendRegel(r: AlertRule): BackendRule {
  return {
    id: r.id,
    navn: r.name,
    aktiv: r.enabled,
    emne: r.topic,
    operator: OPERATOR[r.kind] ?? "over",
    verdi: r.kind === "stale" ? (r.minutes ?? 15) : r.value,
    pauseSek: Math.round((r.cooldownMin ?? 10) * 60),
    handlinger: (r.actions ?? []).map(tilAgentHandling),
  };
}

export function fraBackendRegel(r: BackendRule): AlertRule {
  const kind = KIND[String(r.operator)] ?? "above";
  return {
    id: r.id ?? `r-${Math.random().toString(36).slice(2, 8)}`,
    name: r.navn,
    topic: r.emne,
    kind,
    value: String(r.verdi ?? ""),
    ...(kind === "stale" ? { minutes: Number(r.verdi) || 15 } : {}),
    cooldownMin: Math.max(1, Math.round((r.pauseSek ?? 600) / 60)),
    enabled: r.aktiv,
    actions: (r.handlinger ?? []).map(fraAgentHandling),
  };
}


/** Hent regler fra backend-en (regelmotoren som kjører 24/7), ellers lokale. */
export const hentRegler = (lokale: AlertRule[]) =>
  medFallback(async () => (await backend.hentRegler()).regler.map(fraBackendRegel), () => lokale);

/** Lagre regler til backend-en. Returnerer feiltekst hvis den ikke tok imot. */
export async function lagreRegler(regler: AlertRule[]): Promise<string | null> {
  if (!paalogget()) return null;
  const r = await safe(() => backend.lagreRegler(regler.map(tilBackendRegel)));
  return r.error ? `${r.error.message} ${r.error.raad}`.trim() : null;
}

// ---- målinger ----

const tilLokal = (s: BackendSample): LocalSample => ({ t: s.t, v: Number(s.v ?? Number(s.s)) });

/**
 * Tidsserie for et emne: varig historikk fra backend-en (90 dagers retensjon),
 * med nettleserens korttidsminne som reserve.
 */
export const hentSerie = (emne: string, lokal: () => LocalSample[], maks = 500) =>
  medFallback(async () => {
    const r = await backend.maalinger({ emne, maks });
    const rader = r.rader.map(tilLokal).filter((s) => Number.isFinite(s.v));
    // tom serie i backend = bruk det nettleseren har sett
    if (!rader.length) throw new Error("ingen lagrede målinger");
    return rader;
  }, lokal);
