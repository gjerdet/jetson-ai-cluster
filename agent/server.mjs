/**
 * Jarvis lokal agent
 * -------------------
 * Kjører på Jetson/Pi og gir HUD-en kontrollert tilgang til operativsystemet:
 *  - hvitelistede kommandoer (ingen fritt shell)
 *  - sandkasse for skript (egen mappe, tidsgrense, minne-/output-grense)
 *
 * Start:  AGENT_TOKEN=hemmelig node server.mjs
 * Ingen npm-avhengigheter.
 */
import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { handleApi } from "./lib/api.mjs";
import { addSample, doc, flushNow, initStore, latest, pruneSamples, warmLatest } from "./lib/store.mjs";
import { MqttClient, parseMqttUrl } from "./lib/mqtt.mjs";
import { evaluate, rulesStatus } from "./lib/rules.mjs";
import { notifyAll, startTelegram } from "./lib/telegram.mjs";
import { corsBlocked, corsHeaders, rateLimit, validateEnv, withRequestLog, allowedOrigins, logDir } from "./lib/security.mjs";
import { startBackups } from "./lib/backup.mjs";

const PORT = Number(process.env.AGENT_PORT || 8787);
const HOST = process.env.AGENT_HOST || "0.0.0.0";
const TOKEN = process.env.AGENT_TOKEN || "";
const SANDBOX = path.resolve(process.env.AGENT_SANDBOX || "./sandbox");
const MAX_TIMEOUT = Number(process.env.AGENT_MAX_TIMEOUT || 60_000);
const MAX_OUTPUT = Number(process.env.AGENT_MAX_OUTPUT || 200_000);
// Nettverk i sandkassen er AV som standard – slå på bevisst med AGENT_ALLOW_NETWORK=1.
const ALLOW_NETWORK = process.env.AGENT_ALLOW_NETWORK === "1";

// --- TLS ------------------------------------------------------------------
// AGENT_TLS_CERT + AGENT_TLS_KEY slår på HTTPS. Mangler de, kjører agenten
// vanlig HTTP (greit på et lukket LAN, men bruk TLS når HUD-en er på HTTPS).
const TLS_CERT = process.env.AGENT_TLS_CERT || "";
const TLS_KEY = process.env.AGENT_TLS_KEY || "";
const TLS_CA = process.env.AGENT_TLS_CA || "";

function readTls() {
  if (!TLS_CERT || !TLS_KEY) return null;
  try {
    const opts = {
      cert: fsSync.readFileSync(TLS_CERT),
      key: fsSync.readFileSync(TLS_KEY),
      minVersion: "TLSv1.2",
    };
    if (TLS_CA) opts.ca = fsSync.readFileSync(TLS_CA);
    return opts;
  } catch (e) {
    console.error(`[jarvis-agent] Klarte ikke å lese TLS-sertifikat: ${e?.message}`);
    console.error("[jarvis-agent] Starter uten TLS. Sjekk AGENT_TLS_CERT / AGENT_TLS_KEY.");
    return null;
  }
}

const TLS_OPTIONS = readTls();
export const tlsEnabled = () => !!TLS_OPTIONS;



/** Kommandoer agenten får kjøre. Utvid bevisst – dette er sikkerhetsgrensen. */
const DEFAULT_ALLOW = [
  "uptime", "uname", "whoami", "hostname", "date",
  "df", "du", "free", "top", "ps", "lsblk", "lscpu", "ip", "ping",
  "systemctl", "journalctl", "docker", "nvidia-smi", "tegrastats",
  "ollama", "mosquitto_pub", "mosquitto_sub",
  "ls", "cat", "head", "tail", "grep", "wc", "stat", "echo",
  "python3", "node", "bash", "sh",
];
const ALLOW = new Set(
  (process.env.AGENT_ALLOW ? process.env.AGENT_ALLOW.split(",") : DEFAULT_ALLOW)
    .map((s) => s.trim())
    .filter(Boolean),
);

/** systemctl/journalctl/docker begrenses til lesende underkommandoer som standard. */
const READONLY_SUBCOMMANDS = {
  systemctl: ["status", "is-active", "is-enabled", "list-units", "list-timers", "show", "cat"],
  journalctl: null, // journalctl er lesende
  docker: ["ps", "images", "stats", "logs", "inspect", "version", "info"],
};
const ALLOW_WRITE_SUBCOMMANDS = process.env.AGENT_ALLOW_WRITE === "1";

const RUNNERS = {
  bash: { file: "run.sh", cmd: "bash" },
  sh: { file: "run.sh", cmd: "sh" },
  python: { file: "run.py", cmd: "python3" },
  node: { file: "run.mjs", cmd: "node" },
};

const json = (req, res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...corsHeaders(req) });
  res.end(payload);
};

const clip = (s) => (s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n…[avkortet]` : s);

async function ensureSandbox() {
  await fs.mkdir(SANDBOX, { recursive: true });
}

function safeScriptPath(name) {
  const clean = path.basename(String(name || "")).replace(/[^\w.\-]/g, "_");
  if (!clean || clean.startsWith(".")) throw new Error("Ugyldig filnavn");
  const full = path.join(SANDBOX, clean);
  if (!full.startsWith(SANDBOX + path.sep)) throw new Error("Utenfor sandkassen");
  return { name: clean, full };
}

function checkCommand(cmd, args) {
  if (!ALLOW.has(cmd)) return `Kommandoen «${cmd}» er ikke hvitelistet på agenten.`;
  if (/[;&|`$><]/.test(cmd)) return "Ugyldig kommandonavn.";
  const sub = READONLY_SUBCOMMANDS[cmd];
  if (sub && !ALLOW_WRITE_SUBCOMMANDS) {
    const first = args.find((a) => !a.startsWith("-"));
    if (first && !sub.includes(first))
      return `«${cmd} ${first}» er blokkert. Kun lesende underkommandoer er tillatt (${sub.join(", ")}).`;
  }
  return null;
}

function execute(cmd, args, { timeoutMs, cwd, stdin }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const env = {
      PATH: process.env.PATH,
      HOME: SANDBOX,
      LANG: "C.UTF-8",
      TMPDIR: SANDBOX,
      ...(ALLOW_NETWORK ? {} : { http_proxy: "http://127.0.0.1:1", https_proxy: "http://127.0.0.1:1" }),
    };
    let child;
    try {
      child = spawn(cmd, args, { cwd: cwd || SANDBOX, env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      resolve({ ok: false, error: String(e?.message || e) });
      return;
    }
    let out = "";
    let err = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, Math.min(Math.max(Number(timeoutMs) || 15_000, 1000), MAX_TIMEOUT));

    child.stdout.on("data", (d) => {
      if (out.length < MAX_OUTPUT) out += d.toString();
    });
    child.stderr.on("data", (d) => {
      if (err.length < MAX_OUTPUT) err += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: String(e?.message || e) });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        ok: !killed && code === 0,
        code,
        signal,
        timedOut: killed,
        ms: Date.now() - started,
        stdout: clip(out),
        stderr: clip(err),
      });
    });
    if (stdin) child.stdin.write(String(stdin));
    child.stdin.end();
  });
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 2_000_000) throw new Error("For stor forespørsel");
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Ugyldig JSON");
  }
}

const requestHandler = async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const route = url.pathname.replace(/\/+$/, "") || "/";
  withRequestLog(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(corsBlocked(req) ? 403 : 204, corsHeaders(req));
    res.end();
    return;
  }

  if (corsBlocked(req))
    return json(req, res, 403, { error: "Origin er ikke tillatt. Sett AGENT_ORIGINS på agenten." });

  // Backend-API (egen innlogging – ikke agent-tokenet)
  if (route.startsWith("/api")) {
    await handleApi(req, res, route, url, apiDeps);
    return;
  }

  // OS-/sandkasse-endepunktene: streng rate-limiting og token-krav.
  const begrenset = rateLimit(req, route === "/health" || route === "/" ? "api" : "exec");
  if (begrenset) {
    res.setHeader("retry-after", String(begrenset.retryAfter));
    return json(req, res, 429, { error: `For mange forespørsler. Prøv igjen om ${begrenset.retryAfter} sekunder.` });
  }

  if (TOKEN) {
    const auth = req.headers.authorization || "";
    const forventet = `Bearer ${TOKEN}`;
    const ok =
      auth.length === forventet.length &&
      crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(forventet));
    if (!ok) return json(req, res, 401, { error: "Ugyldig token" });
  }


  try {
    if (req.method === "GET" && (route === "/" || route === "/health")) {
      return json(req, res, 200, {
        ok: true,
        agent: "jarvis-local-agent",
        version: "1.0.0",
        host: os.hostname(),
        platform: `${os.type()} ${os.release()} ${os.arch()}`,
        uptimeSec: Math.round(os.uptime()),
        loadavg: os.loadavg().map((n) => Number(n.toFixed(2))),
        memFreeMb: Math.round(os.freemem() / 1e6),
        memTotalMb: Math.round(os.totalmem() / 1e6),
        sandbox: SANDBOX,
        network: ALLOW_NETWORK,
        origins: allowedOrigins(),
        logg: logDir(),
        maxTimeoutMs: MAX_TIMEOUT,
        allowed: [...ALLOW],
      });
    }

    if (req.method === "POST" && route === "/exec") {
      const body = await readBody(req);
      const cmd = String(body.cmd || "").trim();
      const args = Array.isArray(body.args) ? body.args.map(String) : [];
      const problem = checkCommand(cmd, args);
      if (problem) return json(req, res, 403, { error: problem });
      const result = await execute(cmd, args, { timeoutMs: body.timeoutMs });
      return json(req, res, 200, result);
    }

    if (req.method === "GET" && route === "/scripts") {
      await ensureSandbox();
      const files = await fs.readdir(SANDBOX, { withFileTypes: true });
      const list = [];
      for (const f of files) {
        if (!f.isFile()) continue;
        const st = await fs.stat(path.join(SANDBOX, f.name));
        list.push({ name: f.name, bytes: st.size, modified: st.mtime.toISOString() });
      }
      return json(req, res, 200, { sandbox: SANDBOX, files: list });
    }

    if (req.method === "POST" && route === "/scripts") {
      await ensureSandbox();
      const body = await readBody(req);
      const { name, full } = safeScriptPath(body.name);
      await fs.writeFile(full, String(body.content ?? ""), "utf8");
      return json(req, res, 200, { ok: true, name, path: full, bytes: Buffer.byteLength(String(body.content ?? "")) });
    }

    if (req.method === "GET" && route.startsWith("/scripts/")) {
      const { name, full } = safeScriptPath(decodeURIComponent(route.slice("/scripts/".length)));
      const content = await fs.readFile(full, "utf8");
      return json(req, res, 200, { name, content: clip(content) });
    }

    if (req.method === "DELETE" && route.startsWith("/scripts/")) {
      const { name, full } = safeScriptPath(decodeURIComponent(route.slice("/scripts/".length)));
      await fs.unlink(full);
      return json(req, res, 200, { ok: true, name });
    }

    if (req.method === "POST" && route === "/run") {
      await ensureSandbox();
      const body = await readBody(req);
      const lang = String(body.lang || "bash").toLowerCase();
      const runner = RUNNERS[lang];
      if (!runner) return json(req, res, 400, { error: `Ukjent språk «${lang}». Bruk bash, python eller node.` });
      if (!ALLOW.has(runner.cmd)) return json(req, res, 403, { error: `${runner.cmd} er ikke hvitelistet.` });

      let scriptPath;
      let temporary = false;
      if (body.name) {
        scriptPath = safeScriptPath(body.name).full;
        if (body.content != null) await fs.writeFile(scriptPath, String(body.content), "utf8");
      } else {
        const tmp = safeScriptPath(`_tmp_${Date.now()}_${runner.file}`);
        scriptPath = tmp.full;
        temporary = true;
        await fs.writeFile(scriptPath, String(body.content ?? ""), "utf8");
      }

      const args = [scriptPath, ...(Array.isArray(body.args) ? body.args.map(String) : [])];
      const result = await execute(runner.cmd, args, { timeoutMs: body.timeoutMs, stdin: body.stdin });
      if (temporary && body.keep !== true) await fs.unlink(scriptPath).catch(() => {});
      return json(req, res, 200, { ...result, lang, script: path.basename(scriptPath), sandbox: SANDBOX });
    }

    return json(req, res, 404, { error: `Ukjent endepunkt ${route}` });
  } catch (e) {
    return json(req, res, 400, { error: String(e?.message || e) });
  }
};

const server = TLS_OPTIONS
  ? https.createServer(TLS_OPTIONS, requestHandler)
  : http.createServer(requestHandler);

// Uventede feil skal aldri drepe agenten – den skal kjøre døgnet rundt.
process.on("uncaughtException", (e) => console.error("[jarvis-agent] uventet feil:", e?.stack || e));
process.on("unhandledRejection", (e) => console.error("[jarvis-agent] ubehandlet løfte:", e));


// ---------------------------------------------------------------------------
// Backend: lagring, MQTT-lytter, regelmotor og Telegram
// ---------------------------------------------------------------------------
let mqtt = null;
let mqttConnected = false;
const previousValues = new Map();

function mqttStatus() {
  const cfg = doc("mqtt", { url: "", enabled: false, topics: ["#"] });
  return {
    tilkoblet: mqttConnected,
    url: cfg.url,
    aktiv: !!cfg.enabled,
    emner: cfg.topics,
    kjente: latest.size,
    ...(mqtt?.state?.() ?? {}),
  };
}

async function publish(topic, payload) {
  if (!mqtt || !mqttConnected) throw new Error("MQTT er ikke tilkoblet");
  mqtt.publish(topic, payload);
  return true;
}

function startMqtt() {
  mqtt?.stop();
  mqtt = null;
  mqttConnected = false;
  const cfg = doc("mqtt", { url: "mqtt://127.0.0.1:1883", topics: ["#"], enabled: false });
  if (!cfg.enabled) return;
  mqtt = new MqttClient({ ...parseMqttUrl(cfg.url), clientId: `jarvis-agent-${process.pid}` });
  mqtt.on("connect", () => {
    mqttConnected = true;
    mqtt.subscribe(cfg.topics?.length ? cfg.topics : ["#"]);
    console.log("[jarvis-agent] MQTT tilkoblet", cfg.url);
  });
  mqtt.on("close", () => {
    mqttConnected = false;
  });
  mqtt.on("error", (e) => console.error("[jarvis-agent] MQTT-feil:", e?.message));
  mqtt.on("reconnect", ({ forsok, ventMs }) =>
    console.warn(`[jarvis-agent] MQTT frakoblet – nytt forsøk #${forsok} om ${Math.round(ventMs / 1000)} s`),
  );
  mqtt.on("message", async (topic, message) => {
    const row = addSample({ topic, value: message, time: Date.now() });
    const previous = previousValues.get(topic);
    previousValues.set(topic, row.v ?? row.s);
    try {
      await evaluate({ topic, value: row.v ?? row.s, previous }, { publish, notify: notifyAll });
    } catch (e) {
      console.error("[jarvis-agent] regelfeil:", e?.message);
    }
  });
  mqtt.connect();
}

const apiDeps = { publish, mqttStatus, restartMqtt: startMqtt, rulesStatus, tls: !!TLS_OPTIONS };

validateEnv({ token: TOKEN, dataDir: path.resolve(process.env.AGENT_DATA || "./data"), sandbox: SANDBOX });

await ensureSandbox();
await initStore();
await warmLatest();
startMqtt();
startTelegram({ rulesStatus });
startBackups();
setInterval(() => pruneSamples().catch(() => {}), 6 * 60 * 60 * 1000);
setInterval(() => flushNow(), 30_000).unref();

const scheme = TLS_OPTIONS ? "https" : "http";
server.listen(PORT, HOST, () => {
  console.log(`[jarvis-agent] lytter på ${scheme}://${HOST}:${PORT}`);
  console.log(`[jarvis-agent] sandkasse: ${SANDBOX}`);
  console.log(`[jarvis-agent] backend-API: ${scheme}://${HOST}:${PORT}/api/status`);
  if (!TLS_OPTIONS) console.warn("[jarvis-agent] Kjører uten TLS. Sett AGENT_TLS_CERT/AGENT_TLS_KEY for HTTPS.");
  console.log(`[jarvis-agent] tillatte origins: ${allowedOrigins().join(", ")}`);
  console.log(`[jarvis-agent] forespørselslogg: ${logDir()}/requests.log`);
});

// Ryddig avslutning slik at systemd/Docker kan restarte uten datatap.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[jarvis-agent] avslutter (${sig}) …`);
    try {
      mqtt?.stop();
      flushNow();
    } catch {
      /* ignorert */
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}


