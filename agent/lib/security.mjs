/**
 * Sikkerhetslag for Jarvis-agenten:
 *  - CORS med hviteliste (aldri «*»)
 *  - rate-limiting per IP + rute
 *  - forespørselslogg med rotasjon
 *  - validering av miljøvariabler ved oppstart
 * Ingen npm-avhengigheter.
 */
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

/**
 * AGENT_ORIGINS = komma-separert liste med tillatte origins.
 * Jokertegn er støttet i vertsnavn, f.eks. https://*.lovable.app
 * Standard: lokal maskin + Lovable-HUD-en. Aldri «*».
 */
const DEFAULT_ORIGINS = [
  "http://localhost:*",
  "http://127.0.0.1:*",
  "https://localhost:*",
  "https://127.0.0.1:*",
  "https://*.lovable.app",
  "https://*.lovableproject.com",
];

const ORIGIN_PATTERNS = (process.env.AGENT_ORIGINS
  ? process.env.AGENT_ORIGINS.split(",")
  : DEFAULT_ORIGINS
)
  .map((s) => s.trim())
  .filter(Boolean);

const toRegex = (pattern) =>
  new RegExp(
    `^${pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^/]*")}$`,
    "i",
  );

const ORIGIN_REGEX = ORIGIN_PATTERNS.map(toRegex);

export const originAllowed = (origin) =>
  !!origin && ORIGIN_REGEX.some((re) => re.test(origin));

export const allowedOrigins = () => [...ORIGIN_PATTERNS];

const BASE_HEADERS = {
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-allow-credentials": "true",
  "access-control-max-age": "600",
  vary: "Origin",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

/** CORS-hoder for én konkret forespørsel. Ukjent origin får ingen tilgang. */
export function corsHeaders(req) {
  const origin = req?.headers?.origin;
  if (!origin) return { ...BASE_HEADERS }; // samme-origin / curl
  if (!originAllowed(origin)) return { ...BASE_HEADERS };
  return { ...BASE_HEADERS, "access-control-allow-origin": origin };
}

/** true når forespørselen kommer fra en nettleser med ikke-godkjent origin. */
export function corsBlocked(req) {
  const origin = req?.headers?.origin;
  return !!origin && !originAllowed(origin);
}

// ---------------------------------------------------------------------------
// Rate-limiting (token bucket per IP + gruppe)
// ---------------------------------------------------------------------------

const buckets = new Map();

export const RATE_RULES = {
  auth: { limit: Number(process.env.AGENT_RATE_AUTH || 10), windowMs: 60_000 },
  exec: { limit: Number(process.env.AGENT_RATE_EXEC || 30), windowMs: 60_000 },
  api: { limit: Number(process.env.AGENT_RATE_API || 300), windowMs: 60_000 },
};

export function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0]?.trim();
  return fwd || req.socket?.remoteAddress || "ukjent";
}

/**
 * Returnerer null når kallet er greit, ellers { retryAfter } i sekunder.
 */
export function rateLimit(req, group = "api") {
  const rule = RATE_RULES[group] ?? RATE_RULES.api;
  const key = `${group}:${clientIp(req)}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { count: 1, reset: now + rule.windowMs });
    return null;
  }
  b.count++;
  if (b.count > rule.limit) return { retryAfter: Math.ceil((b.reset - now) / 1000) };
  return null;
}

// rydder gamle bøtter så minnet ikke vokser
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 60_000).unref?.();

// ---------------------------------------------------------------------------
// Forespørselslogg med rotasjon
// ---------------------------------------------------------------------------

const LOG_DIR = path.resolve(process.env.AGENT_LOG_DIR || path.join(process.env.AGENT_DATA || "./data", "logs"));
const LOG_FILE = path.join(LOG_DIR, "requests.log");
const LOG_MAX_BYTES = Number(process.env.AGENT_LOG_MAX_BYTES || 5_000_000);
const LOG_KEEP = Number(process.env.AGENT_LOG_KEEP || 5);
const LOG_ENABLED = process.env.AGENT_LOG !== "0";

function rotateIfNeeded() {
  try {
    const st = fs.statSync(LOG_FILE);
    if (st.size < LOG_MAX_BYTES) return;
    for (let i = LOG_KEEP - 1; i >= 1; i--) {
      const from = `${LOG_FILE}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${LOG_FILE}.${i + 1}`);
    }
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    const oldest = `${LOG_FILE}.${LOG_KEEP + 1}`;
    if (fs.existsSync(oldest)) fs.rmSync(oldest, { force: true });
  } catch {
    /* fila finnes ikke ennå */
  }
}

/** Skriver én linje til requests.log (og til stdout ved feil). */
export function logRequest(entry) {
  if (!LOG_ENABLED) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, `${JSON.stringify({ tid: new Date().toISOString(), ...entry })}\n`, "utf8");
  } catch {
    /* logging skal aldri velte agenten */
  }
  if (entry.status >= 400) console.warn(`[jarvis-agent] ${entry.status} ${entry.metode} ${entry.rute} fra ${entry.ip}`);
}

export const logDir = () => LOG_DIR;

/** Kobler logging på en respons uten å endre handler-koden. */
export function withRequestLog(req, res) {
  const started = Date.now();
  const ip = clientIp(req);
  res.on("finish", () =>
    logRequest({
      ip,
      metode: req.method,
      rute: (req.url || "").split("?")[0],
      status: res.statusCode,
      ms: Date.now() - started,
      origin: req.headers.origin || undefined,
    }),
  );
}

// ---------------------------------------------------------------------------
// Validering av miljøvariabler
// ---------------------------------------------------------------------------

/** Kaster hvis oppsettet er utrygt (med mindre AGENT_INSECURE=1). */
export function validateEnv({ token, dataDir, sandbox }) {
  const feil = [];
  const advarsler = [];

  if (!token) feil.push("AGENT_TOKEN mangler – da kan hvem som helst kjøre OS-kommandoer.");
  else if (token.length < 24) feil.push("AGENT_TOKEN er for kort (minst 24 tegn).");

  if (!path.isAbsolute(dataDir)) advarsler.push(`AGENT_DATA er relativ (${dataDir}). Sett en absolutt sti.`);
  if (!path.isAbsolute(sandbox)) advarsler.push(`AGENT_SANDBOX er relativ (${sandbox}). Sett en absolutt sti.`);
  if (process.getuid?.() === 0) advarsler.push("Agenten kjører som root. Bruk en egen bruker med få rettigheter.");
  if (process.env.AGENT_ALLOW_NETWORK === "1")
    advarsler.push("AGENT_ALLOW_NETWORK=1: skript i sandkassen har nettilgang.");

  advarsler.forEach((a) => console.warn(`[jarvis-agent] advarsel: ${a}`));

  if (feil.length) {
    feil.forEach((f) => console.error(`[jarvis-agent] FEIL: ${f}`));
    if (process.env.AGENT_INSECURE === "1") {
      console.warn("[jarvis-agent] AGENT_INSECURE=1 – starter likevel. Ikke bruk dette utenfor testing.");
      return { ok: false, feil, advarsler };
    }
    throw new Error(`Utrygt oppsett: ${feil.join(" ")}`);
  }
  return { ok: true, feil, advarsler };
}
