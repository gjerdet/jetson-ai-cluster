/**
 * Passord-beskyttet forhåndsvisningsmodus for Lovable-preview.
 * Kun aktiv på localhost og *.lovable.app. På Jetson kreves vanlig
 * backend-innlogging. Hemmeligheter leses fra runtime secrets.
 */
import { createServerFn } from "@tanstack/react-start";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isPreviewHostname } from "./preview-hosts";

const PREVIEW_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 dager

function isPreviewHost(host: string) {
  return isPreviewHostname(host);
}

function sign(data: string, secret: string) {
  return createHmac("sha256", secret).update(data).digest("hex");
}

function makeToken(secret: string) {
  const expires = Date.now() + PREVIEW_MAX_AGE_MS;
  const payload = String(expires);
  return `${payload}.${sign(payload, secret)}`;
}

function verifyToken(token: string, secret: string) {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = sign(payload, secret);
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  } catch {
    return false;
  }
  const expires = Number(payload);
  return !Number.isNaN(expires) && Date.now() < expires;
}

function isLocalhost(host: string) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export const unlockPreview = createServerFn({ method: "POST" })
  .inputValidator((data: { password: string; host: string }) => data)
  .handler(async ({ data }) => {
    if (!isPreviewHost(data.host)) {
      return {
        ok: false,
        error: "Forhåndsvisningsmodus er kun tilgjengelig i Lovable-preview.",
      };
    }
    const password = process.env["PREVIEW_PASSWORD"];
    const secret = process.env["PREVIEW_SECRET"];
    // På localhost slipper vi deg inn automatisk hvis passord ikke er satt,
    // slik at lokal utvikling ikke blir hemmet.
    if (!password || !secret) {
      if (isLocalhost(data.host)) {
        return { ok: true, token: makeToken(secret || "localhost-dev-secret") };
      }
      return {
        ok: false,
        error:
          "Preview er ikke konfigurert. Be utvikleren sette PREVIEW_PASSWORD og PREVIEW_SECRET i Lovable Secrets.",
      };
    }
    const expected = createHmac("sha256", secret).update(password).digest("hex");
    const actual = createHmac("sha256", secret).update(data.password).digest("hex");
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) {
      return { ok: false, error: "Feil passord." };
    }
    return { ok: true, token: makeToken(secret) };
  });


export const verifyPreviewToken = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const secret = process.env["PREVIEW_SECRET"];
    if (!secret) return { ok: false };
    return { ok: verifyToken(data.token, secret) };
  });
