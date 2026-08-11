import type { ChatMsg } from "./hud-client";

const KEY = "hud.chat.v1";
const MAX = 200;

/** Leser samtalen som ble lagret lokalt sist (overlever omstart av nettleseren). */
export function loadChat(): ChatMsg[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMsg[];
    return Array.isArray(parsed) ? parsed.slice(-MAX) : [];
  } catch {
    return [];
  }
}

export function saveChat(messages: ChatMsg[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(messages.slice(-MAX)));
  } catch {
    /* full lagring – ignorer */
  }
}

export function clearChat() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// ---- Delt historikk via den lokale backend-en (agenten på Jetson) ----------
// Når du er logget inn mot backend-en lagres samtalen der også, slik at den
// er den samme på alle maskiner og i Telegram-boten. Lokal lagring beholdes
// som reserve når agenten er nede.

const THREAD_ID = "hud-main";

/** Henter samtalen fra backend-en. Returnerer null når agenten ikke svarer. */
export async function loadChatRemote(): Promise<ChatMsg[] | null> {
  const { backend, backendToken, safe } = await import("./backend");
  if (!backendToken()) return null;
  const r = await safe(() => backend.hentSamtale(THREAD_ID));
  if (r.error || !r.data) return null;
  const msgs = r.data.samtale?.meldinger;
  return Array.isArray(msgs) ? (msgs as ChatMsg[]).slice(-MAX) : [];
}

/** Lagrer samtalen i backend-en. Feiler stille når agenten er utilgjengelig. */
export async function saveChatRemote(messages: ChatMsg[]): Promise<boolean> {
  const { backend, backendToken, safe } = await import("./backend");
  if (!backendToken()) return false;
  const r = await safe(() =>
    backend.lagreSamtale({
      id: THREAD_ID,
      tittel: "HUD-samtale",
      meldinger: messages.slice(-MAX),
    }),
  );
  return !r.error;
}
