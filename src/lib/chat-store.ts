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
