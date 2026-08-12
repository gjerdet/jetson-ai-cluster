/**
 * Client-side håndtering av forhåndsvisnings-token.
 * Tokenet lagres i sessionStorage og forsvinner når fanen lukkes.
 */
const STORAGE_KEY = "jarvis-preview-token";

export function isPreviewHost() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host.endsWith(".lovable.app") || host.startsWith("localhost:");
}

export function getPreviewToken() {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(STORAGE_KEY);
}

export function setPreviewToken(token: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, token);
}

export function clearPreviewToken() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
}
