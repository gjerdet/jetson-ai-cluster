/**
 * REST-API for Jarvis-backend på Jetson.
 * Alt under /api. Innlogging kreves for alt bortsett fra /api/status,
 * /api/auth/login og førstegangsregistrering.
 */
import { randomUUID } from "node:crypto";
import os from "node:os";
import {
  addSample,
  doc,
  latest,
  pruneSamples,
  querySamples,
  saveDoc,
  summarize,
} from "./store.mjs";
import {
  changePassword,
  createUser,
  deleteUser,
  listUsers,
  login,
  logout,
  userCount,
  userFromRequest,
} from "./auth.mjs";
import { evaluate as evaluateRule, listRules, logDoc, saveRules, rulesStatus } from "./rules.mjs";
import { notifyAll, saveTelegram, sendMessage, telegramCfg } from "./telegram.mjs";
import { eksporterKonfig, importerKonfig, inspiserKonfig, versjonsinfo } from "./versjon.mjs";
import {
  API_VERSION,
  buildPersonalityPrompt,
  SETTINGS_DEFAULTS,
  SETTINGS_SCHEMA,
  validateCredentials,
  validateNode,
  validateSettings,
} from "./contract.mjs";

import { kjorBalansert, poolFor, poolStatus } from "./balancer.mjs";
import { lokalSnapshot } from "./gpu.mjs";
import { distribuerKonfig, klyngeHelse, tomKlyngeCache } from "./klynge.mjs";
import { hentJobb, hentJobber, startProvisjonering } from "./provisjonering.mjs";
import {
  addClip,
  clipDir,
  clipStats,
  deleteClip,
  listClips,
  piperStemmer,
  saveTtsConfig,
  syntetiser,
  trainingManifest,
  ttsConfig,
} from "./tts.mjs";

import {
  forget as forgetMemory,
  getMemory,
  memoryContext,
  memoryStats,
  recall,
  remember,
  rememberCurrent,
  timeline as memoryTimeline,
} from "./memory.mjs";
import {
  activePlanCount,
  cancelPlan,
  createPlan,
  getPlan,
  listPlans,
  loggPlan,
  markerPlanFerdig,
  nesteSteg,
  oppdaterSteg,
  resumePlan,
} from "./planner.mjs";
import { evaluate as evaluateReply, evaluateChatReply, evaluationStats, listEvaluations } from "./evaluator.mjs";
import {
  approveSuggestion,
  initiativeStatus,
  isActive as isInitiativeActive,
  laerteRegler,
  leggIKo,
  listAudit as listInitiativeAudit,
  listKo,
  listRevisjoner,
  listSuggestions as listInitiativeSuggestions,
  loggRevisjon,
  markerBrukeraktivitet,
  rejectSuggestion,
  rullTilbake,
  runNow as runInitiativeNow,
  setActive as setInitiativeActive,
} from "./initiative.mjs";
import {
  byggVerktoy,
  deleteGeneratedTool,
  enableTool,
  generateTool,
  getGeneratedTool,
  listGeneratedTools,
  rollbackTool,
  runGeneratedTool,
  testTool,
  toolStats,
} from "./toolgen.mjs";
import { kortTekst, maskinKort, selvtest } from "./identitet.mjs";
import { deleger, diagnoser, diagnoserAlle, kollegaProfiler, listKollegaer } from "./kollega.mjs";
import { runPlanOnce, runPlanUntilDone } from "./task-runner.mjs";

/** Gjeldende innstillinger = standardverdier overstyrt av lagrede verdier. */
const currentSettings = () => ({ ...SETTINGS_DEFAULTS, ...(doc("settings", {}) || {}) });

/** Noder som kan ta AI-oppgaver (aktive og med gyldig adresse). */
const chatNoder = (liste) => poolFor(liste, "chat");


import { hentLogg, loggKilder } from "./logger.mjs";
import { corsBlocked, corsHeaders, rateLimit } from "./security.mjs";

import { decryptSecret, encryptSecret, maskSecret } from "./secrets.mjs";
import { callChatEndpoint, listModels } from "./ai-endpoint.mjs";
import { listBackups, runBackup } from "./backup.mjs";
import { startUpdate, updateStatus } from "./update-runner.mjs";
import {
  addDocument,
  deleteDocument,
  listDocuments,
  ragConfig,
  ragStats,
  reindex,
  saveRagConfig,
  search,
} from "./rag.mjs";

const json = (req, res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...corsHeaders(req) });
  res.end(JSON.stringify(body));
  return true;
};

/** Enkel inndata-validering – kaster med norsk tekst. */
const str = (v, felt, { maks = 500, min = 0 } = {}) => {
  const t = String(v ?? "").trim();
  if (t.length < min) throw new Error(`${felt} er påkrevd.`);
  if (t.length > maks) throw new Error(`${felt} er for lang (maks ${maks} tegn).`);
  return t;
};
const num = (v, felt, { min = -Infinity, maks = Infinity, standard } = {}) => {
  if (v == null || v === "") return standard;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > maks) throw new Error(`${felt} må være et tall mellom ${min} og ${maks}.`);
  return n;
};

async function readBody(req, maks = 5_000_000) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > maks) throw new Error("For stor forespørsel");
    chunks.push(c);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Håndterer alle /api-ruter. Returnerer true når forespørselen er besvart.
 * `deps`: { publish(emne, payload), mqttStatus() }
 */
/** Rutene backend-API-et eier, med eller uten «/api»-prefiks. */
export const BACKEND_PREFIKSER = ["/auth", "/ai", "/config", "/klynge", "/noder", "/mqtt", "/regler", "/malinger", "/logger", "/versjon", "/rag", "/tts", "/telegram", "/verktoy", "/identitet", "/kollega", "/initiativ", "/minne", "/planer", "/evalueringer"];

/**
 * Innlogging kan slås av mens systemet kjører i et lukket lokalt miljø.
 * Standard er AV. Sett AGENT_KREV_INNLOGGING=1 for å kreve innlogging igjen.
 */
export const KREV_INNLOGGING = /^(1|ja|on|true|pa|på)$/i.test(
  String(process.env.AGENT_KREV_INNLOGGING ?? "0").trim(),
);

const LOKAL_ADMIN = { id: "lokal", email: "lokal@jarvis", role: "admin", created: 0 };

export function erApiRute(route) {
  if (route === "/api" || route.startsWith("/api/")) return true;
  return BACKEND_PREFIKSER.some((p) => route === p || route.startsWith(`${p}/`));
}

export async function handleApi(req, res, route, url, deps = {}) {
  // Både «/api/...» og de bare backend-rutene («/auth/...») håndteres her,
  // slik at eldre klienter og direkte kall mot /auth/logg-inn treffer riktig.
  if (!erApiRute(route)) return false;
  const path = (route.startsWith("/api") ? route.slice(4) : route) || "/";
  const method = req.method || "GET";

  if (method === "OPTIONS") {
    res.writeHead(corsBlocked(req) ? 403 : 204, corsHeaders(req));
    res.end();
    return true;
  }

  // Nettlesere fra ukjente domener slipper ikke inn i det hele tatt.
  if (corsBlocked(req))
    return json(req, res, 403, { error: "Origin er ikke tillatt. Sett AGENT_ORIGINS på agenten." });

  // Rate-limiting: strengt på innlogging, romsligere på resten.
  const gruppe = path.startsWith("/auth") ? "auth" : "api";
  const begrenset = rateLimit(req, gruppe);
  if (begrenset) {
    res.setHeader?.("retry-after", String(begrenset.retryAfter));
    return json(req, res, 429, {
      error: `For mange forespørsler. Prøv igjen om ${begrenset.retryAfter} sekunder.`,
    });
  }

  // ---- åpne endepunkter ------------------------------------------------
  if (path === "/status" && method === "GET") {
    return json(req, res, 200, {
      ok: true,
      backend: "jarvis-agent",
      versjon: API_VERSION,
      vert: os.hostname(),
      oppetidSek: Math.round(process.uptime()),
      brukere: userCount(),
      trengerOppsett: KREV_INNLOGGING && userCount() === 0,
      krevInnlogging: KREV_INNLOGGING,
      tls: deps.tls === true,
      mqtt: deps.mqttHelse?.() ?? deps.mqttStatus?.() ?? { tilkoblet: false },
      regler: rulesStatus(),
      emner: latest.size,
    });
  }

  if (path === "/auth/login" && method === "POST") {
    try {
      const b = await readBody(req);
      return json(req, res, 200, login(b.epost ?? b.email, b.passord ?? b.password));
    } catch (e) {
      return json(req, res, 401, { error: String(e?.message || e) });
    }
  }

  if (path === "/auth/register" && method === "POST") {
    const first = userCount() === 0;
    const actor = userFromRequest(req);
    if (!first && actor?.role !== "admin")
      return json(req, res, 403, { error: "Kun admin kan opprette nye brukere." });
    try {
      const b = await readBody(req);
      const cred = validateCredentials(b.epost ?? b.email, b.passord ?? b.password);
      const user = createUser({ email: cred.email, password: cred.password, role: b.rolle });
      return json(req, res, 200, first ? login(cred.email, cred.password) : { user });
    } catch (e) {
      return json(req, res, 400, { error: String(e?.message || e) });
    }
  }

  /**
   * Agent-til-agent: en annen Jarvis-node kan hente lokal maskinvarestatus
   * og motta konfig-pakker med det delte agent-tokenet. Innloggede brukere
   * slipper også inn (HUD-en bruker samme rute).
   */
  const agentTokenOk = () => {
    const forventet = String(process.env.AGENT_TOKEN || "");
    if (!forventet) return false;
    const oppgitt =
      String(req.headers["x-agent-token"] || "") ||
      String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    return oppgitt === forventet;
  };

  if (path === "/klynge/lokal" && method === "GET") {
    if (!userFromRequest(req) && !agentTokenOk())
      return json(req, res, 401, { error: "Krever innlogging eller agent-token." });
    return json(req, res, 200, { snapshot: await lokalSnapshot() });
  }

  // Konfigdistribusjon fra en annen node (verifikasjonen leser eksporten etterpå).
  if (agentTokenOk() && !userFromRequest(req)) {
    if (path === "/versjon" && method === "GET") return json(req, res, 200, versjonsinfo());
    if (path === "/config/eksport" && method === "GET") {
      const bare = (url.searchParams.get("bare") || "").split(",").filter(Boolean);
      return json(req, res, 200, eksporterKonfig(bare));
    }
    if (path === "/config/import" && method === "POST") {
      try {
        const b = await readBody(req);
        const pakke = b.pakke ?? b;
        if (b.kunSjekk) return json(req, res, 200, inspiserKonfig(pakke));
        return json(req, res, 200, importerKonfig(pakke, { modus: b.modus, bare: b.bare }));
      } catch (e) {
        return json(req, res, 400, { error: String(e?.message || e) });
      }
    }
  }

  /**
   * Selvregistrering av en node i klyngen.
   * Krever agent-tokenet (samme hemmelighet som OS-rutene) og at
   * «Tillat at noder melder seg inn selv» er på i innstillingene.
   */
  if (path === "/noder/registrer" && method === "POST") {
    const settings = currentSettings();
    if (!settings.autoRegistrering)
      return json(req, res, 403, { error: "Selvregistrering av noder er slått av." });
    const oppgitt = String(req.headers["x-agent-token"] || "");
    const forventet = String(process.env.AGENT_TOKEN || "");
    if (!forventet || oppgitt !== forventet)
      return json(req, res, 401, { error: "Ugyldig agent-token." });
    try {
      const b = await readBody(req);
      const node = validateNode({ ...b, kilde: "auto", sistSett: Date.now() });
      const db = doc("nodes", { list: [] });
      const eksisterende = db.list.find((n) => n.id === node.id || n.baseUrl === node.baseUrl);
      const neste = eksisterende ? { ...eksisterende, ...node, id: eksisterende.id } : node;
      db.list = [...db.list.filter((n) => n.id !== neste.id), neste];
      saveDoc("nodes", db);
      return json(req, res, 200, { node: neste, antall: db.list.length });
    } catch (e) {
      return json(req, res, 400, { error: String(e?.message || e) });
    }
  }


  // ---- alt under her krever innlogging ---------------------------------
  const user = userFromRequest(req) || (KREV_INNLOGGING ? null : LOKAL_ADMIN);
  if (!user) return json(req, res, 401, { error: "Ikke innlogget" });
  const admin = user.role === "admin";

  try {
    if (path === "/auth/me") return json(req, res, 200, { user });

    // ---- lokale verktøy på samme Jetson som backend-en -------------------
    if (path === "/verktoy/ping" && method === "POST") {
      const b = await readBody(req);
      const host = str(b.host || "", "Host", { maks: 200, min: 1 });
      const antall = Number(b.antall ?? 2);
      const timeout = Number(b.timeout ?? 5);
      const r = await deps.runPing({ host, antall, timeout });
      return json(req, res, 200, r);
    }
    // Kjøres gjennom det innloggede API-et, slik at HUD-en ikke trenger et
    // separat «lokal agent»-oppsett eller et ekstra agent-token.
    if ((path === "/verktoy/nett-sjekk" || path === "/verktoy/nett-skann") && method === "POST") {
      if (!deps.runNetworkTool)
        return json(req, res, 503, { error: "Nettverksverktøy er ikke tilgjengelig i denne backend-versjonen." });
      const b = await readBody(req);
      const resultat = await deps.runNetworkTool({
        type: path.endsWith("nett-skann") ? "scan" : "check",
        subnet: String(b.subnett ?? b.subnet ?? b.cidr ?? "").trim(),
        ports: b.porter === true || b.ports === true,
      });
      const stdout = String(resultat?.stdout || "");
      const aktivtLan = stdout.match(/^Aktivt LAN:\s+(\S+)\s+(\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2})$/m);
      const subnett = stdout.match(/^Subnett:\s+(\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2})$/m)?.[1];
      if (aktivtLan?.[1] && aktivtLan[2] && subnett) {
        rememberCurrent({
          tag: "lokalt-nettverk",
          tekst: `Aktivt LAN på denne noden er ${aktivtLan[1]} med IP ${aktivtLan[2]} og subnett ${subnett}. Målt med nett_sjekk/nett_skann; mål på nytt før nettverksoppgaver.`,
          type: "faktum",
          kontekst: "Dynamisk systemkontekst",
          kilder: [path],
          viktighet: 10,
          ttlDager: 2,
        });
      }
      return json(req, res, 200, resultat);
    }

    // ---- tale og stemmetrening -------------------------------------------
    if (path === "/tts/config" && method === "GET") {
      return json(req, res, 200, { config: ttsConfig() });
    }
    if (path === "/tts/config" && method === "PUT") {
      const b = await readBody(req);
      return json(req, res, 200, { config: saveTtsConfig(b) });
    }
    if (path === "/tts/stemmer" && method === "GET") {
      return json(req, res, 200, { stemmer: await piperStemmer().catch(() => []) });
    }
    if (path === "/tts/tale" && method === "POST") {
      const b = await readBody(req);
      const tekst = String(b.tekst ?? b.text ?? "").trim();
      if (!tekst) return json(req, res, 400, { error: "Mangler tekst." });
      try {
        const { lyd, mime } = await syntetiser(tekst, {
          modell: b.modell,
          lengthScale: b.lengthScale,
          noiseScale: b.noiseScale,
        });
        res.writeHead(200, { "content-type": mime, "content-length": String(lyd.length), ...corsHeaders(req) });
        res.end(lyd);
        return true;
      } catch (e) {
        return json(req, res, 502, { error: String(e?.message || e) });
      }
    }
    if (path === "/tts/klipp" && method === "GET") {
      return json(req, res, 200, { klipp: listClips(), statistikk: clipStats() });
    }
    if (path === "/tts/klipp" && method === "POST") {
      // base64 er ~1,37x rå størrelse: gi rom for klipp på 25 MB.
      const b = await readBody(req, 40_000_000);
      try {
        return json(req, res, 200, { klipp: await addClip(b) });
      } catch (e) {
        return json(req, res, 400, { error: String(e?.message || e) });
      }
    }
    if (path.startsWith("/tts/klipp/") && method === "DELETE") {
      const id = decodeURIComponent(path.slice("/tts/klipp/".length));
      return json(req, res, 200, { ok: await deleteClip(id) });
    }
    if (path === "/tts/treningssett" && method === "GET") {
      return json(req, res, 200, { manifest: trainingManifest(), mappe: clipDir(), statistikk: clipStats() });
    }

    // ---- maskin-ID-kort (hvem og hva denne maskinen faktisk er) ----------
    if (path === "/identitet" && method === "GET") {
      const kort = await maskinKort({ tving: url.searchParams.get("frisk") === "1" });
      return json(req, res, 200, { kort, tekst: kortTekst(kort) });
    }
    if (path === "/identitet/selvtest" && method === "POST") {
      return json(req, res, 200, await selvtest());
    }

    // ---- kolleger (Hermes m.fl.) ----------------------------------------
    if (path === "/kollega" && method === "GET") {
      return json(req, res, 200, { kollegaer: listKollegaer(), profiler: kollegaProfiler() });
    }
    if (path === "/kollega/diagnose" && method === "POST") {
      const b = await readBody(req);
      const id = String(b.id ?? b.node ?? "").trim();
      if (!id) return json(req, res, 200, { resultater: await diagnoserAlle() });
      const k = listKollegaer().find((x) => x.id === id || x.navn.toLowerCase() === id.toLowerCase());
      if (!k) return json(req, res, 404, { error: "Fant ikke kollegaen." });
      return json(req, res, 200, { resultater: [await diagnoser(k)] });
    }
    if (path === "/kollega/deleger" && method === "POST") {
      const b = await readBody(req);
      return json(req, res, 200, await deleger({
        node: String(b.node ?? ""),
        oppgave: String(b.oppgave ?? ""),
        kontekst: String(b.kontekst ?? ""),
        runder: Number(b.runder ?? 1),
        oppfolging: Array.isArray(b.oppfolging) ? b.oppfolging.map(String) : [],
      }));
    }

    // ---- verktøybibliotek ------------------------------------------------
    if (path === "/verktoy/genererte" && method === "GET") {
      return json(req, res, 200, { verktoy: listGeneratedTools(), statistikk: toolStats() });
    }
    if (path === "/verktoy/genererte" && method === "POST") {
      const b = await readBody(req);
      const beskrivelse = String(b.beskrivelse ?? b.tekst ?? "").trim();
      if (!beskrivelse) return json(req, res, 400, { error: "Mangler beskrivelse." });
      const r = await byggVerktoy(beskrivelse, { runder: Number(b.runder ?? 3) });
      loggRevisjon({
        hva: `Nytt verktøy: ${r.verktoy?.name || "ukjent"}`,
        hvorfor: beskrivelse,
        type: "verktoy",
        ref: r.verktoy?.id || "",
        resultat: r.ok ? "testet OK" : "feilet i sandkassen",
      });
      return json(req, res, 200, r);
    }
    if (path === "/verktoy/genererte/test" && method === "POST") {
      const b = await readBody(req);
      try {
        return json(req, res, 200, await testTool(String(b.id ?? ""), b.args ?? {}));
      } catch (e) {
        return json(req, res, 400, { error: String(e?.message || e) });
      }
    }
    if (path === "/verktoy/genererte/kjor" && method === "POST") {
      const b = await readBody(req);
      try {
        return json(req, res, 200, { resultat: await runGeneratedTool(String(b.navn ?? ""), b.args ?? {}) });
      } catch (e) {
        return json(req, res, 400, { error: String(e?.message || e) });
      }
    }
    if (path === "/verktoy/genererte/tilbake" && method === "POST") {
      const b = await readBody(req);
      try {
        return json(req, res, 200, { verktoy: rollbackTool(String(b.id ?? "")) });
      } catch (e) {
        return json(req, res, 400, { error: String(e?.message || e) });
      }
    }
    if (path === "/verktoy/genererte/aktiver" && method === "POST") {
      const b = await readBody(req);
      try {
        return json(req, res, 200, { verktoy: enableTool(String(b.id ?? ""), b.aktiv !== false) });
      } catch (e) {
        return json(req, res, 400, { error: String(e?.message || e) });
      }
    }
    if (path.startsWith("/verktoy/genererte/") && method === "DELETE") {
      return json(req, res, 200, deleteGeneratedTool(decodeURIComponent(path.split("/").pop() || "")));
    }

    // ---- utvikling: kø, revisjon, lærte regler ---------------------------
    if (path === "/initiativ" && method === "GET") {
      return json(req, res, 200, {
        status: initiativeStatus(),
        ko: listKo(),
        revisjoner: listRevisjoner(),
        regler: laerteRegler(),
        forslag: listInitiativeSuggestions(),
        audit: listInitiativeAudit(),
      });
    }
    if (path === "/initiativ" && method === "PUT") {
      const b = await readBody(req);
      return json(req, res, 200, setInitiativeActive(b.aktiv !== false));
    }
    if (path === "/initiativ/ko" && method === "POST") {
      const b = await readBody(req);
      return json(req, res, 200, { jobb: leggIKo({ type: String(b.type ?? "bygg-verktoy"), tekst: String(b.tekst ?? ""), prioritet: Number(b.prioritet ?? 5), data: b.data ?? {} }) });
    }
    if (path === "/initiativ/kjor" && method === "POST") {
      return json(req, res, 200, { resultat: await runInitiativeNow() });
    }
    if (path === "/initiativ/tilbake" && method === "POST") {
      const b = await readBody(req);
      try {
        return json(req, res, 200, { revisjon: rullTilbake(String(b.id ?? "")) });
      } catch (e) {
        return json(req, res, 400, { error: String(e?.message || e) });
      }
    }
    if (path === "/initiativ/forslag" && method === "POST") {
      const b = await readBody(req);
      try {
        return json(req, res, 200, {
          forslag: b.godkjenn === false ? rejectSuggestion(String(b.id ?? "")) : approveSuggestion(String(b.id ?? "")),
        });
      } catch (e) {
        return json(req, res, 400, { error: String(e?.message || e) });
      }
    }



    if (path === "/auth/logout" && method === "POST") {
      logout(user.token);
      return json(req, res, 200, { ok: true });
    }

    if (path === "/auth/passord" && method === "POST") {
      const b = await readBody(req);
      changePassword(b.brukerId && admin ? b.brukerId : user.id, b.passord ?? b.password);
      return json(req, res, 200, { ok: true });
    }

    if (path === "/brukere" && method === "GET") return json(req, res, 200, { brukere: listUsers() });

    if (path.startsWith("/brukere/") && method === "DELETE") {
      if (!admin) return json(req, res, 403, { error: "Kun admin" });
      const id = decodeURIComponent(path.slice("/brukere/".length));
      if (id === user.id) return json(req, res, 400, { error: "Du kan ikke slette deg selv." });
      return json(req, res, 200, { ok: deleteUser(id) });
    }

    // ---- delt konfigurasjon --------------------------------------------
    if (path === "/config") {
      if (method === "GET") return json(req, res, 200, doc("config", { versjon: 0, data: null }));
      if (method === "PUT") {
        const b = await readBody(req);
        const current = doc("config", { versjon: 0, data: null });
        const next = { versjon: (current.versjon || 0) + 1, oppdatert: Date.now(), av: user.email, data: b.data ?? b };
        saveDoc("config", next);
        return json(req, res, 200, next);
      }
    }

    // ---- AI-node for Telegram-boten -------------------------------------
    if (path === "/ai") {
      const openRouterKey = process.env.OPENROUTER_API_KEY ? decryptSecret(process.env.OPENROUTER_API_KEY) : "";
      const base = { baseUrl: openRouterKey ? "https://openrouter.ai/api/v1" : "http://127.0.0.1:11434/v1", model: openRouterKey ? "qwen/qwen3-8b" : "llama3.1", apiKey: "", system: "" };
      if (method === "GET") {
        const cfg = doc("ai", base);
        // API-nøkkelen forlater aldri serveren – kun maskert form.
        return json(req, res, 200, { ...cfg, apiKey: undefined, harNokkel: !!decryptSecret(cfg.apiKey), nokkelMaske: maskSecret(cfg.apiKey) });
      }
      if (method === "PUT") {
        if (!admin) return json(req, res, 403, { error: "Kun admin" });
        const b = await readBody(req);
        const cfg = doc("ai", base);
        const next = {
          baseUrl: b.baseUrl != null ? str(b.baseUrl, "Adresse", { maks: 300 }) : cfg.baseUrl,
          model: b.model != null ? str(b.model, "Modell", { maks: 120 }) : cfg.model,
          system: b.system != null ? str(b.system, "Systemtekst", { maks: 4000 }) : cfg.system,
          apiKey: cfg.apiKey,
        };
        if (b.personality != null && typeof b.personality === "object") {
          next.personality = {
            name: str(b.personality.name ?? cfg.personality?.name ?? "JARVIS", "Navn", { maks: 80 }),
            role: str(b.personality.role ?? cfg.personality?.role ?? "", "Rolle", { maks: 200 }),
            tone: ["formell", "vennlig", "sarkastisk", "tørr", "entusiastisk", "mørk"].includes(b.personality.tone)
              ? b.personality.tone
              : (cfg.personality?.tone ?? "formell"),
            verbosity: ["kort", "balansert", "utfyllende"].includes(b.personality.verbosity)
              ? b.personality.verbosity
              : (cfg.personality?.verbosity ?? "balansert"),
            language: str(b.personality.language ?? cfg.personality?.language ?? "norsk bokmål", "Språk", { maks: 60 }),
            quirks: str(b.personality.quirks ?? cfg.personality?.quirks ?? "", "Særtrekk", { maks: 2000 }),
            catchphrase: str(b.personality.catchphrase ?? cfg.personality?.catchphrase ?? "", "Uttrykk", { maks: 200 }),
            background: str(b.personality.background ?? cfg.personality?.background ?? "", "Bakgrunn", { maks: 2000 }),
            extra: str(b.personality.extra ?? cfg.personality?.extra ?? "", "Ekstra", { maks: 2000 }),
          };
        }
        if (typeof b.apiKey === "string" && b.apiKey && b.apiKey !== "***lagret***")
          next.apiKey = encryptSecret(str(b.apiKey, "API-nøkkel", { maks: 500 }));
        if (b.apiKey === "") next.apiKey = "";
        saveDoc("ai", next);
        return json(req, res, 200, { ...next, apiKey: undefined, harNokkel: !!decryptSecret(next.apiKey), nokkelMaske: maskSecret(next.apiKey) });
      }

    }

    // ---- AI-poolens helse og rutingsrekkefølge ---------------------------
    if (path === "/ai/pool" && method === "GET") {
      const db = doc("nodes", { list: [] });
      const oppgave = url.searchParams.get("oppgave") || "chat";
      return json(req, res, 200, poolStatus(chatNoder(db.list), oppgave));
    }

    // ---- Testkobling mot en AI-node (Hermes, ChatGPT, Ollama …) ---------
    if (path === "/modeller" && method === "GET") {
      const envKey = process.env.OPENROUTER_API_KEY ? decryptSecret(process.env.OPENROUTER_API_KEY) : "";
      const cfg = doc("ai", { baseUrl: "", model: "", apiKey: "" });
      const baseUrl = String(cfg.baseUrl || (envKey ? "https://openrouter.ai/api/v1" : "")).trim().replace(/\/+$/, "");
      const key = envKey || decryptSecret(cfg.apiKey);
      const modeller = baseUrl ? await listModels(baseUrl, { apiKey: key }).catch(() => []) : [];
      return json(req, res, 200, { modeller, baseUrl });
    }

    if (path === "/ai/test" && method === "POST") {
      const b = await readBody(req);
      const envKey = process.env.OPENROUTER_API_KEY ? decryptSecret(process.env.OPENROUTER_API_KEY) : "";
      const cfg = doc("ai", { baseUrl: "", model: "", apiKey: "" });
      const baseUrl = String(b.baseUrl || cfg.baseUrl || (envKey ? "https://openrouter.ai/api/v1" : "")).trim().replace(/\/+$/, "");
      const model = String(b.model || cfg.model || "").trim();
      const key = b.apiKey ? String(b.apiKey) : (envKey || decryptSecret(cfg.apiKey));
      if (!baseUrl) return json(req, res, 400, { ok: false, error: "Adressen mangler." });
      const start = Date.now();
      const modeller = await listModels(baseUrl, { apiKey: key }).catch(() => []);
      try {
        const r = await callChatEndpoint({
          baseUrl,
          model: model || modeller[0] || "llama3.2:3b",
          messages: [{ role: "user", content: "Svar med kun ordet OK." }],
          temperature: 0,
          apiKey: key,
          timeoutMs: 45_000,
        });
        return json(req, res, 200, {
          ok: true,
          endpoint: r.endpoint,
          model: r.model || model,
          byttetModell: !!r.byttetModell,
          svar: String(r.svar || "").slice(0, 200),
          modeller,
          ms: Date.now() - start,
        });
      } catch (e) {
        return json(req, res, 200, {
          ok: false,
          error: String(e?.message || e).slice(0, 500),
          modeller,
          ms: Date.now() - start,
        });
      }
    }

    // ---- AI-proxy: backend-en fordeler chatten mellom nodene -------------
    if (path === "/ai/chat" && method === "POST") {
      const b = await readBody(req);
      const meldinger = Array.isArray(b.meldinger) ? b.meldinger : [];
      if (!meldinger.length) return json(req, res, 400, { error: "Ingen meldinger" });
      // Brukeraktivitet stopper bakgrunnsarbeidet umiddelbart.
      markerBrukeraktivitet();
      const cfg = doc("ai", { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1", apiKey: "", system: "" });
      // En nøkkel som følger med forespørselen (f.eks. OpenRouter fra HUD-en) vinner.
      const envKey = process.env.OPENROUTER_API_KEY ? decryptSecret(process.env.OPENROUTER_API_KEY) : "";
      const key = (typeof b.apiKey === "string" && b.apiKey.trim())
        ? b.apiKey.trim()
        : (envKey || decryptSecret(cfg.apiKey));
      const baseUrl = String(b.baseUrl || cfg.baseUrl || (envKey ? "https://openrouter.ai/api/v1" : "")).trim().replace(/\/+$/, "");
      const model = String(b.model || cfg.model || "").trim();
      let chosenModel = model;
      if (!chosenModel && /openrouter\.ai/i.test(baseUrl)) {
        const modeller = await listModels(baseUrl, { apiKey: *** }).catch(() => []);
        if (modeller.length) chosenModel = modeller[0];
      }
      // Hvis OpenRouter er valgt, men modellen ikkje finst i providerens
      // modelliste, foreslår vi første tilgjengelige i staden for å sende
      // ein ugyldig modell-ID som gir 404/400.
      if (/openrouter\.ai/i.test(baseUrl) && chosenModel) {
        const tilgjengelige = await listModels(baseUrl, { apiKey: *** }).catch(() => []);
        if (tilgjengelige.length && !tilgjengelige.some((m) => String(m).toLowerCase() === String(chosenModel).toLowerCase())) {
          chosenModel = tilgjengelige[0];
        }
      }
