import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Ende-til-ende mot en ekte agent-prosess: CORS, rate-limiting, innlogging,
 * krypterte hemmeligheter og sikkerhetskopi.
 */
const HER = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "test-token-som-er-langt-nok-1234567890";

let proc;
let rot;

const api = (sti, init = {}, token) =>
  fetch(`${BASE}/api${sti}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

beforeAll(async () => {
  rot = mkdtempSync(path.join(tmpdir(), "jarvis-e2e-"));
  proc = spawn(process.execPath, [path.join(HER, "server.mjs")], {
    env: {
      ...process.env,
      AGENT_PORT: String(PORT),
      AGENT_HOST: "127.0.0.1",
      AGENT_TOKEN: TOKEN,
      AGENT_DATA: path.join(rot, "data"),
      AGENT_SANDBOX: path.join(rot, "sandbox"),
      AGENT_INSECURE: "1",
      AGENT_LOG: "0",
      AGENT_BACKUP_HOURS: "0",
      AGENT_RATE_AUTH: "5",
    },
    stdio: "ignore",
  });

  for (let i = 0; i < 60; i++) {
    try {
      if ((await api("/status")).ok) return;
    } catch {
      /* venter på oppstart */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Agenten startet ikke i tide");
}, 30_000);

afterAll(() => {
  proc?.kill("SIGKILL");
  if (rot) rmSync(rot, { recursive: true, force: true });
});

describe("agent ende-til-ende", () => {
  let sesjon = "";

  it("svarer på status uten innlogging", async () => {
    const r = await api("/status");
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b.trengerOppsett).toBe(true);
  });

  it("blokkerer ukjent origin", async () => {
    const r = await api("/status", { headers: { origin: "https://ondsinnet.no" } });
    expect(r.status).toBe(403);
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("ekko-er kun godkjent origin", async () => {
    const r = await api("/status", { headers: { origin: "http://localhost:5173" } });
    expect(r.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("krever innlogging på beskyttede ruter", async () => {
    expect((await api("/regler")).status).toBe(401);
  });

  it("oppretter første bruker som admin og logger inn", async () => {
    const r = await api("/auth/register", {
      method: "POST",
      body: JSON.stringify({ epost: "sjef@jarvis.no", passord: "hemmelig123" }),
    });
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b.user.role).toBe("admin");
    sesjon = b.token;

    const me = await (await api("/auth/me", {}, sesjon)).json();
    expect(me.user.email).toBe("sjef@jarvis.no");
  });

  it("returnerer aldri AI-nøkkelen i klartekst", async () => {
    await api("/ai", {
      method: "PUT",
      body: JSON.stringify({ baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1", apiKey: "sk-topphemmelig-42" }),
    }, sesjon);

    const r = await api("/ai", {}, sesjon);
    const tekst = await r.text();
    expect(tekst).not.toContain("sk-topphemmelig-42");
    const b = JSON.parse(tekst);
    expect(b.harNokkel).toBe(true);
    expect(b.apiKey).toBeUndefined();
  });

  it("avviser ugyldige målinger", async () => {
    const r = await api("/maalinger", { method: "POST", body: JSON.stringify({ emne: "" }) }, sesjon);
    expect(r.status).toBe(400);
  });

  it("lagrer og oppsummerer målinger", async () => {
    for (const v of [10, 20, 30]) {
      const r = await api("/maalinger", { method: "POST", body: JSON.stringify({ emne: "hus/temp", verdi: v }) }, sesjon);
      expect(r.status).toBe(200);
    }
    const b = await (await api("/maalinger?emne=hus/temp", {}, sesjon)).json();
    expect(b.antall).toBe(3);
    expect(b.oppsummering[0].maks).toBe(30);
  });

  it("tar sikkerhetskopi på forespørsel", async () => {
    const laget = await (await api("/backup", { method: "POST" }, sesjon)).json();
    expect(laget.navn).toMatch(/^jarvis-backup-/);
    const liste = await (await api("/backup", {}, sesjon)).json();
    expect(liste.kopier.length).toBeGreaterThan(0);
  });

  it("rate-limiter innloggingsforsøk", async () => {
    let siste = 0;
    for (let i = 0; i < 12; i++) {
      siste = (
        await api("/auth/login", { method: "POST", body: JSON.stringify({ epost: "sjef@jarvis.no", passord: "feil" }) })
      ).status;
    }
    expect(siste).toBe(429);
  }, 20_000);

  it("krever agent-token på OS-endepunktene", async () => {
    expect((await fetch(`${BASE}/health`)).status).toBe(401);
    expect((await fetch(`${BASE}/health`, { headers: { authorization: `Bearer ${TOKEN}` } })).ok).toBe(true);
  });

  it("har ikke nettilgang i sandkassen som standard", async () => {
    const r = await fetch(`${BASE}/health`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const b = await r.json();
    expect(b.network).toBe(false);
  });
});
