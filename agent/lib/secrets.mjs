/**
 * Kryptering av hemmeligheter i ro (API-nøkler, Telegram-token).
 * AES-256-GCM med nøkkel fra AGENT_SECRET_KEY, eller en nøkkelfil som
 * genereres automatisk i datamappen med rettigheter 0600.
 */
import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const PREFIX = "enc:v1:";
let key = null;

function keyFile() {
  return path.join(path.resolve(process.env.AGENT_DATA || "./data"), "secret.key");
}

function loadKey() {
  if (key) return key;
  const fromEnv = process.env.AGENT_SECRET_KEY;
  if (fromEnv) {
    key = createHash("sha256").update(fromEnv).digest();
    return key;
  }
  const file = keyFile();
  try {
    key = Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
    if (key.length === 32) return key;
  } catch {
    /* lages under */
  }
  key = randomBytes(32);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, key.toString("hex"), { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(file, 0o600);
  } catch (e) {
    console.error("[secrets] klarte ikke lagre nøkkelfil:", e?.message);
  }
  return key;
}

export const isEncrypted = (v) => typeof v === "string" && v.startsWith(PREFIX);

/** Krypterer en streng. Tomme verdier returneres uendret. */
export function encryptSecret(value) {
  const text = String(value ?? "");
  if (!text || isEncrypted(text)) return text;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", loadKey(), iv);
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return PREFIX + [iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

/** Dekrypterer. Ukrypterte verdier (fra eldre installasjoner) slippes gjennom. */
export function decryptSecret(value) {
  const text = String(value ?? "");
  if (!isEncrypted(text)) return text;
  try {
    const [iv, tag, data] = text.slice(PREFIX.length).split(".");
    const d = createDecipheriv("aes-256-gcm", loadKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch (e) {
    console.error("[secrets] klarte ikke dekryptere – er AGENT_SECRET_KEY endret?", e?.message);
    return "";
  }
}

/** Maskerer en hemmelighet for visning i UI: «sk-…f39a» eller tom. */
export function maskSecret(value) {
  const text = decryptSecret(value);
  if (!text) return "";
  return text.length <= 8 ? "••••" : `${text.slice(0, 3)}…${text.slice(-4)}`;
}
