/**
 * Client-side håndtering av forhåndsvisnings-token.
 * Tokenet lagres i sessionStorage og forsvinner når fanen lukkes.
 */
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { verifyPreviewToken } from "./preview-gate.functions";

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

export function usePreviewSession() {
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(true);
  const verify = useServerFn(verifyPreviewToken);

  const check = useCallback(async () => {
    if (!isPreviewHost()) {
      setUnlocked(false);
      setChecking(false);
      return;
    }
    const token = getPreviewToken();
    if (!token) {
      setUnlocked(false);
      setChecking(false);
      return;
    }
    try {
      const r = await verify({ data: { token } });
      setUnlocked(r.ok);
    } catch {
      setUnlocked(false);
    } finally {
      setChecking(false);
    }
  }, [verify]);

  useEffect(() => {
    void check();
  }, [check]);

  const lock = useCallback(() => {
    clearPreviewToken();
    setUnlocked(false);
  }, [check]);

  return { isPreview: isPreviewHost(), unlocked, checking, refresh: check, lock };
}
