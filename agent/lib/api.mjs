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
  oppdaterKlipp,
  verifiserKlipp,
  transkriberKlipp,
  transkriberAlle,
} from "./tts.mjs";
import {
  koLeggTil as treningStart,
  koStatus as treningStatus,
  avbryt as treningAvbryt,
  slettJobb as treningSlett,
  publiser as treningPubliser,
  hentJobb as treningJobb,
  treningPlan,
  piperSystemtest,
  startInstallasjonPiper,
  piperPreflight,
  startInstallasjonPytorch,
  treningResultater,
  treningNoder,
  fordelTrening,
} from "./trening.mjs";

import {
  addFeedback as addFeedbackEntry,
  getVekt,
  listFeedback,
} from "./feedback.mjs";

import {
  forget as forgetMemory,
  getMemory,
  konsolider as konsoliderMinne,
  memoryContext,
  memoryStats,
  recall,
  remember,
  rememberCurrent,
  timeline as memoryTimeline,
} from "./memory.mjs";
import {
  gjettType,
  hentUtstyr,
  laerFraSkann,
  lagreUtstyr,
  listUtstyr,
  slettUtstyr,
  utstyrKontekst,
  utstyrStats,
} from "./utstyr.mjs";
import { feilmonstre, reflekter, registrerUtfall, verktoyHint, verktoyStats } from "./refleksjon.mjs";

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
  laerRegel,
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
  seedInnebygdeVerktoy,
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
import { ipSjekk, lagringsStatus } from "./system-tools.mjs";

try {
  seedInnebygdeVerktoy();
} catch {
  /* biblioteket seedes på nytt ved neste start */
}
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
import { hentUrl, laerOm, sokWeb } from "./laering.mjs";

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
export const BACKEND_PREFIKSER = ["/auth", "/ai", "/config", "/klynge", "/noder", "/mqtt", "/regler", "/malinger", "/logger", "/versjon", "/rag", "/tts", "/telegram", "/verktoy", "/identitet", "/kollega", "/initiativ", "/minne", "/planer", "/evalueringer", "/utstyr", "/refleksjon"];

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
    if (path === "/verktoy/lagring" && (method === "GET" || method === "POST")) {
      return json(req, res, 200, await lagringsStatus());
    }
    if (path === "/verktoy/ip-sjekk" && (method === "GET" || method === "POST")) {
      const b = method === "POST" ? await readBody(req) : Object.fromEntries(url.searchParams);
      const porter = Array.isArray(b.porter)
        ? b.porter
        : String(b.porter ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      try {
        return json(req, res, 200, await ipSjekk(String(b.ip ?? b.vert ?? ""), porter));
      } catch (e) {
        return json(req, res, 400, { error: String(e?.message || e) });
      }
    }
    if (path === "/verktoy/genererte/kjor-node" && method === "POST") {
      const b = await readBody(req);
      const nodeId = String(b.nodeId ?? "");
      const node = (doc("nodes", { list: [] }).list || []).find((n) => n.id === nodeId);
      if (!node) return json(req, res, 404, { error: `Fant ikke noden «${nodeId}».` });
      const base = String(node.agentUrl || "").replace(/\/+$/, "");
      if (!base) return json(req, res, 400, { error: `Noden «${node.navn}» har ingen agent-URL – den kan bare brukes til AI-kall.` });
      const token = node.agentToken || "";
      const r = await fetch(`${base}/api/verktoy/genererte/kjor`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}`, "x-agent-token": token } : {}),
        },
        body: JSON.stringify({ navn: String(b.navn ?? ""), args: b.args ?? {} }),
      });
      const tekst = await r.text();
      let data = null;
      try { data = tekst ? JSON.parse(tekst) : null; } catch { data = { raa: tekst.slice(0, 500) }; }
      if (!r.ok) return json(req, res, 502, { error: data?.error || `HTTP ${r.status} fra ${node.navn}` });
      return json(req, res, 200, { node: node.navn, via: base, ...data });
    }
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
    // Lærdom fra en samtale: skrives inn som varig adferdsregel.
    if (path === "/initiativ/regel" && method === "POST") {
      const b = await readBody(req);
      const tekst = String(b.tekst ?? b.regel ?? "").trim();
      if (!tekst) return json(req, res, 400, { error: "Mangler regeltekst." });
      const regel = laerRegel(tekst, String(b.hvorfor ?? "Lært i samtale"));
      if (!regel) return json(req, res, 200, { regel: null, duplikat: true, regler: laerteRegler() });
      return json(req, res, 200, { regel, duplikat: false, regler: laerteRegler() });
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

        if (path === "/feedback" && method === "POST") {
      const b = await readBody(req);
      const rad = await addFeedbackEntry({
        sporsmaal: str(b.sporsmaal, "Spørsmål", { maks: 1000 }),
        feilSvar: str(b.feilSvar, "Feil svar", { maks: 4000 }),
        riktigSvar: str(b.riktigSvar, "Riktig svar", { maks: 4000 }),
        kategori: String(b.kategori || "generelt").trim().slice(0, 60),
      });
      return json(req, res, 200, { ok: true, entry: rad });
    }

    if (path === "/feedback" && method === "GET") {
      return json(req, res, 200, { entries: listFeedback(), vekt: getVekt() });
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
        const modeller = await listModels(baseUrl, { apiKey: key }).catch(() => []);
        if (modeller.length) chosenModel = modeller[0];
      }
      // Hvis OpenRouter er valgt, men modellen ikkje finst i providerens
      // modelliste, foreslår vi første tilgjengelige i staden for å sende
      // ein ugyldig modell-ID som gir 404/400.
      if (/openrouter\.ai/i.test(baseUrl) && chosenModel) {
        const tilgjengelige = await listModels(baseUrl, { apiKey: key }).catch(() => []);
        if (tilgjengelige.length && !tilgjengelige.some((m) => String(m).toLowerCase() === String(chosenModel).toLowerCase())) {
          chosenModel = tilgjengelige[0];
        }
      }
      const personalityPrompt = buildPersonalityPrompt(cfg.personality) || cfg.system || "";
      const harSystem = meldinger.some((m) => m && m.role === "system");
      const systemMelding = personalityPrompt && !harSystem
        ? [{ role: "system", content: personalityPrompt }]
        : [];
      // Injiser relevant minnekontekst for å gi AI-en episodisk hukommelse.
      const sisteBrukerMelding = meldinger
        .filter((m) => m && m.role === "user" && typeof m.content === "string")
        .pop()?.content;
      const minneKontekst = sisteBrukerMelding ? memoryContext(sisteBrukerMelding, { topK: 6, maksLengde: 1200 }) : "";
      const memoryMessage = minneKontekst
        ? [{ role: "system", content: `Relevant minne fra tidligere:\n${minneKontekst}` }]
        : [];
      // Utstyrsprofiler og verktøyerfaring gir konkret, lokal kunnskap.
      let utstyrMelding = [];
      let erfaringMelding = [];
      try {
        const u = sisteBrukerMelding ? utstyrKontekst(sisteBrukerMelding) : "";
        if (u) utstyrMelding = [{ role: "system", content: `Kjent utstyr hos brukeren (bruk dette, ikke gjett):\n${u}` }];
        const h = sisteBrukerMelding ? verktoyHint(sisteBrukerMelding) : "";
        if (h) erfaringMelding = [{ role: "system", content: `Egen verktøyerfaring:\n${h}` }];
      } catch {
        /* kontekst er valgfri – chatten skal aldri falle på dette */
      }

      const messages = [
        ...systemMelding,
        ...memoryMessage,
        ...utstyrMelding,
        ...erfaringMelding,

        ...meldinger
          .filter((m) => m && typeof m.content === "string")
          .slice(-40)
          .map((m) => ({
            role: ["system", "user", "assistant"].includes(m.role) ? m.role : "user",
            content: String(m.content).slice(0, 24000),
          })),
      ];


      // Klyngenodene utgjør poolen. Er klyngen tom, brukes den faste AI-noden.
      const registrerte = chatNoder(doc("nodes", { list: [] }).list);
      const fallbackBase = String(cfg.baseUrl || (envKey ? "https://openrouter.ai/api/v1" : "")).trim().replace(/\/+$/, "");
      const fallbackNode = {
        id: "ai-standard",
        navn: "AI-node",
        baseUrl: fallbackBase,
        modell: str(b.model || cfg.model, "Modell", { maks: 120 }),
        vekt: 1,
      };
      // Eksplisitt adresse fra klienten overstyrer balanseringen.
      // Er noden allerede registrert i klyngen, balanseres det som før.
      // Ellers brukes adressen klienten sendte med (HUD-nodene).
      const kjentNode = typeof b.nodeId === "string" && registrerte.some((n) => n.id === b.nodeId);
      // Robusthet: hvis klienten sender en baseUrl som ikke er i registrerte noder,
      // legg den til som en ekstra fallback-node uten å erstatte poolen.
      const klientBase = typeof b.baseUrl === "string" ? b.baseUrl.trim().replace(/\/+$/, "") : "";
      const klientNode = klientBase
        ? {
            id: "klient-" + Math.random().toString(36).slice(2, 8),
            navn: "HUD-valg",
            baseUrl: klientBase,
            modell: str(b.model || cfg.model, "Modell", { maks: 120 }),
            vekt: 1,
          }
        : null;
      const pool = [...registrerte];
      if (klientNode && !kjentNode) pool.push(klientNode);
      if (!pool.length) pool.push(fallbackNode);
      const oppgave = typeof b.oppgave === "string" ? b.oppgave : "chat";
      const foretrukket = typeof b.nodeId === "string" ? b.nodeId : "";

      const kall = async (node) => {
        const baseUrl = String(node.baseUrl).replace(/\/+$/, "");
        const model = str(b.model || node.modell || cfg.model || chosenModel, "Modell", { maks: 120 });
        const ctrl = new AbortController();
        // Første svar fra en kald modell på Jetson kan ta flere minutter.
        const grenseMs = Math.max(15_000, Number(cfg.timeoutMs) || 60_000);
        const timer = setTimeout(() => ctrl.abort(), grenseMs + 15_000);
        try {
          const resultat = await callChatEndpoint({
            baseUrl,
            model,
            messages,
            temperature: Number(b.temperatur) || 0.7,
            apiKey: key,
            timeoutMs: grenseMs,
            signal: ctrl.signal,
          });
          return { svar: resultat.svar, model, baseUrl, endpoint: resultat.endpoint };
        } finally {
          clearTimeout(timer);
        }
      };

      try {
        const { resultat, node, ms, forsok } = await kjorBalansert(pool, kall, { oppgave, foretrukket });
        return json(req, res, 200, {
          svar: resultat.svar,
          model: resultat.model,
          node: resultat.baseUrl,
          nodeId: node.id,
          nodeNavn: node.navn,
          ms,
          ...(forsok.length ? { hoppetOver: forsok } : {}),
        });
      } catch (e) {
        const hoppetOver = e?.forsok ?? [];
        // 1) Fallback til den konfigurerte AI-noden (Ollama/Hermes) hvis den
        //    ikke allerede var med i poolen – klyngenodene kan være nede.
        if (fallbackBase && !pool.some((n) => String(n.baseUrl).replace(/\/+$/, "") === fallbackBase)) {
          try {
            const direkte = await kall({ ...fallbackNode, baseUrl: fallbackBase });
            return json(req, res, 200, {
              svar: direkte.svar,
              model: direkte.model,
              node: direkte.baseUrl,
              nodeId: fallbackNode.id,
              nodeNavn: fallbackNode.navn,
              ms: 0,
              hoppetOver,
            });
          } catch {}
        }
        // 2) Fallback til OpenRouter hvis vi har nøkkel.
        const openRouterBase = "https://openrouter.ai/api/v1";
        const openRouterKey = envKey || key;
        if (openRouterKey && baseUrl !== openRouterBase) {
          try {
            const fallback = await callChatEndpoint({
              baseUrl: openRouterBase,
              model: chosenModel || "openai/gpt-4o-mini",
              messages,
              temperature: Number(b.temperatur) || 0.7,
              apiKey: openRouterKey,
              timeoutMs: 45_000,
            });
            return json(req, res, 200, {
              svar: fallback.svar,
              model: fallback.model,
              node: openRouterBase,
              nodeId: "openrouter-fallback",
              nodeNavn: "OpenRouter",
              ms: 0,
              hoppetOver,
            });
          } catch {}
        }
        return json(req, res, 502, {
          error: `Nådde ingen AI-node: ${/abort/i.test(e?.message || "") ? "modellen svarte ikke i tide – den laster trolig fortsatt. Prøv igjen om et minutt, eller bruk en mindre modell." : e?.message || "ukjent"}`,
          kode: "unavailable",
          forsok: hoppetOver,
        });
      }

    }


    // ---- tidsserier ------------------------------------------------------
    if (path === "/maalinger" && method === "GET") {
      const q = url.searchParams;
      const rows = await querySamples({
        topic: q.get("emne") || undefined,
        from: q.get("fra") ? Number(q.get("fra")) : undefined,
        to: q.get("til") ? Number(q.get("til")) : Date.now(),
        limit: Number(q.get("maks") || 5000),
      });
      return json(req, res, 200, {
        antall: rows.length,
        rader: rows,
        oppsummering: summarize(rows),
      });
    }

    if (path === "/maalinger" && method === "POST") {
      const b = await readBody(req);
      const row = addSample({
        topic: str(b.emne, "Emne", { maks: 256, min: 1 }),
        value: typeof b.verdi === "number" ? b.verdi : str(b.verdi, "Verdi", { maks: 2000 }),
        time: num(b.tid, "Tid", { min: 0, maks: Date.now() + 86_400_000, standard: Date.now() }),
      });
      await evaluateRule(
        { topic: row.e, value: row.v ?? row.s, previous: null },
        { publish: deps.publish, notify: notifyAll },
      );
      return json(req, res, 200, { ok: true, rad: row });
    }

    if (path === "/maalinger/siste" && method === "GET")
      return json(req, res, 200, { emner: Object.fromEntries(latest) });

    if (path === "/maalinger/rydd" && method === "POST")
      return json(req, res, 200, { slettedeDager: await pruneSamples() });

    // ---- enheter ---------------------------------------------------------
    if (path === "/enheter") {
      if (method === "GET") return json(req, res, 200, doc("devices", { list: [] }));
      if (method === "PUT") {
        const b = await readBody(req);
        const next = { list: Array.isArray(b.list) ? b.list : [] };
        saveDoc("devices", next);
        return json(req, res, 200, next);
      }
    }

    // ---- regler ----------------------------------------------------------
    if (path === "/regler") {
      if (method === "GET") return json(req, res, 200, { regler: listRules(), status: rulesStatus() });
      if (method === "PUT") {
        const b = await readBody(req);
        return json(req, res, 200, { regler: saveRules(b.regler ?? b.list) });
      }
    }

    if (path === "/regler/logg" && method === "GET")
      return json(req, res, 200, { hendelser: logDoc().list.slice(0, 200) });

    // ---- kunnskapsbase (RAG) ---------------------------------------------
    if (path === "/kunnskap" && method === "GET")
      return json(req, res, 200, { dokumenter: listDocuments(), statistikk: ragStats() });

    if (path === "/kunnskap" && method === "POST") {
      const b = await readBody(req);
      const r = await addDocument({
        tittel: str(b.tittel, "Tittel", { maks: 300, min: 1 }),
        kilde: b.kilde ? str(b.kilde, "Kilde", { maks: 500 }) : "",
        type: b.type ? str(b.type, "Type", { maks: 40 }) : "tekst",
        tekst: String(b.tekst ?? ""),
      });
      return json(req, res, 200, r);
    }

    if (path.startsWith("/kunnskap/dok/") && method === "DELETE") {
      const id = decodeURIComponent(path.slice("/kunnskap/dok/".length));
      return json(req, res, 200, { ok: deleteDocument(id) });
    }

    if (path === "/kunnskap/sok" && method === "POST") {
      const b = await readBody(req);
      const r = await search(str(b.sporsmal ?? b.q, "Spørsmål", { maks: 2000, min: 1 }), {
        topK: b.topK,
        minPoeng: b.minPoeng,
      });
      return json(req, res, 200, r);
    }

    if (path === "/kunnskap/config") {
      if (method === "GET") {
        const c = ragConfig();
        return json(req, res, 200, { config: { ...c, apiKey: c.apiKey ? "***lagret***" : "" }, statistikk: ragStats() });
      }
      if (method === "PUT") {
        if (!admin) return json(req, res, 403, { error: "Kun admin" });
        const b = await readBody(req);
        const inn = { ...b };
        if (inn.apiKey === "***lagret***") delete inn.apiKey;
        const c = saveRagConfig(inn);
        return json(req, res, 200, { config: { ...c, apiKey: c.apiKey ? "***lagret***" : "" } });
      }
    }

    if (path === "/kunnskap/reindekser" && method === "POST")
      return json(req, res, 200, await reindex());

    // ---- selvlæring: søk på nettet og lær ---------------------------------
    if (path === "/kunnskap/web-sok" && method === "POST") {
      const b = await readBody(req);
      return json(req, res, 200, await sokWeb(str(b.sporsmal ?? b.q, "Søketekst", { maks: 500, min: 1 }), b.antall));
    }

    if (path === "/kunnskap/hent-url" && method === "POST") {
      const b = await readBody(req);
      return json(req, res, 200, await hentUrl(str(b.url, "URL", { maks: 800, min: 1 })));
    }

    if (path === "/kunnskap/laer" && method === "POST") {
      const b = await readBody(req);
      return json(
        req,
        res,
        200,
        await laerOm({
          tema: str(b.tema ?? b.sporsmal, "Tema", { maks: 300, min: 1 }),
          urler: Array.isArray(b.urler) ? b.urler : [],
          antall: b.antall,
        }),
      );
    }

    // ---- tale (TTS) og treningsklipp -------------------------------------
    if (path === "/tts/tale" && method === "POST") {
      const b = await readBody(req);
      const r = await syntetiser(str(b.tekst, "Tekst", { maks: 4000, min: 1 }), {
        modell: b.modell,
        lengthScale: b.lengthScale,
        noiseScale: b.noiseScale,
      });
      res.writeHead(200, { "content-type": r.mime, "content-length": r.lyd.length, ...corsHeaders(req) });
      res.end(r.lyd);
      return true;
    }

    if (path === "/tts/config") {
      if (method === "GET") return json(req, res, 200, { config: ttsConfig() });
      if (method === "PUT") {
        if (!admin) return json(req, res, 403, { error: "Kun admin" });
        return json(req, res, 200, { config: saveTtsConfig(await readBody(req)) });
      }
    }

    if (path === "/tts/stemmer" && method === "GET")
      return json(req, res, 200, { stemmer: await piperStemmer() });

    if (path === "/tts/klipp") {
      if (method === "GET") return json(req, res, 200, { klipp: listClips(), statistikk: clipStats() });
      if (method === "POST") {
        const b = await readBody(req, 40_000_000);
        const k = await addClip({
          navn: b.navn,
          tekst: b.tekst,
          lydBase64: b.lydBase64,
          mime: b.mime,
          sekunder: b.sekunder,
        });
        return json(req, res, 200, { klipp: k, statistikk: clipStats() });
      }
    }

    if (path === "/tts/klipp/transkriber-alle" && method === "POST") {
      const b = await readBody(req);
      return json(req, res, 200, await transkriberAlle({ overskriv: Boolean(b?.overskriv) }));
    }

    if (path === "/tts/klipp/verifiser" && method === "GET")
      return json(req, res, 200, await verifiserKlipp());

    if (path.startsWith("/tts/klipp/") && path.endsWith("/transkriber") && method === "POST") {
      const id = decodeURIComponent(path.slice("/tts/klipp/".length, -"/transkriber".length));
      const b = await readBody(req);
      const r = await transkriberKlipp(id, { overskriv: Boolean(b?.overskriv) });
      return json(req, res, 200, { ...r, statistikk: clipStats() });
    }

    if (path.startsWith("/tts/klipp/") && method === "PATCH") {
      const id = decodeURIComponent(path.slice("/tts/klipp/".length));
      const b = await readBody(req);
      const k = oppdaterKlipp(id, { tekst: b.tekst, pauset: b.pauset });
      if (!k) return json(req, res, 404, { error: "Fant ikke klippet" });
      return json(req, res, 200, { klipp: k, statistikk: clipStats() });
    }

    if (path.startsWith("/tts/klipp/") && method === "DELETE") {
      const id = decodeURIComponent(path.slice("/tts/klipp/".length));
      return json(req, res, 200, { ok: await deleteClip(id), statistikk: clipStats() });
    }

    if (path === "/tts/trening/plan" && method === "GET") {
      const q = new URL(req.url, "http://x").searchParams;
      return json(req, res, 200, await treningPlan({ navn: q.get("navn") || "", preset: q.get("preset") || "" }));
    }

    if (path === "/tts/trening/systemtest" && method === "POST") {
      // Automatisert systemtest: kan piper_train startes, finnes venv/Python-stiene?
      try {
        return json(req, res, 200, await piperSystemtest());
      } catch (e) {
        return json(req, res, 400, { error: String(e?.message || e) });
      }
    }

    if (path === "/tts/trening/preflight" && method === "GET") {
      // Sjekker JetPack, CUDA og om NVIDIA PyTorch er på plass før trening.
      try {
        return json(req, res, 200, await piperPreflight());
      } catch (e) {
        return json(req, res, 400, { error: String(e?.message || e) });
      }
    }

    if (path === "/tts/trening/pytorch" && method === "POST") {
      if (!admin) return json(req, res, 403, { error: "Kun admin" });
      // Installerer NVIDIA PyTorch med riktig CUDA-støtte, som en jobb med logg.
      try {
        const jobb = await startInstallasjonPytorch();
        return json(req, res, 200, { jobb });
      } catch (e) {
        return json(req, res, 400, { error: String(e?.message || e) });
      }
    }

    if (path === "/tts/trening/installer" && method === "POST") {
      if (!admin) return json(req, res, 403, { error: "Kun admin" });
      // Lar Jarvis installere Piper-miljøet på seg selv, som en vanlig jobb med logg.
      try {
        const jobb = await startInstallasjonPiper();
        return json(req, res, 200, { jobb });
      } catch (e) {
        return json(req, res, 400, { error: String(e?.message || e) });
      }
    }


    if (path === "/tts/trening/resultater" && method === "GET") {
      return json(req, res, 200, { resultater: treningResultater() });
    }

    if (path === "/tts/trening/noder" && method === "GET") {
      // Admin-oversikt over alle koblede Jetson-noder med JetPack og status.
      const db = doc("nodes", { list: [] });
      try {
        return json(req, res, 200, await treningNoder(db.list, { token: process.env.AGENT_TOKEN || "" }));
      } catch (e) {
        return json(req, res, 400, { error: String(e?.message || e) });
      }
    }

    if (path === "/tts/trening/fordel" && method === "POST") {
      if (!admin) return json(req, res, 403, { error: "Kun admin" });
      const b = await readBody(req);
      const db = doc("nodes", { list: [] });
      try {
        return json(
          req,
          res,
          200,
          await fordelTrening({
            navn: b.navn,
            kommando: b.kommando,
            noder: db.list,
            nodeIder: Array.isArray(b.noder) ? b.noder : [],
            token: process.env.AGENT_TOKEN || "",
          }),
        );
      } catch (e) {
        return json(req, res, 400, { error: String(e?.message || e) });
      }
    }

    if (path === "/tts/trening") {
      if (method === "GET") return json(req, res, 200, treningStatus());
      if (method === "POST") {
        const b = await readBody(req);
        return json(req, res, 200, { jobb: await treningStart({ navn: b.navn, kommando: b.kommando }) });
      }
    }

    if (path.startsWith("/tts/trening/") && path.endsWith("/publiser") && method === "POST") {
      const id = decodeURIComponent(path.slice("/tts/trening/".length, -"/publiser".length));
      const b = await readBody(req);
      return json(req, res, 200, treningPubliser(id, b?.modell));
    }

    if (path.startsWith("/tts/trening/") && method === "DELETE") {
      const id = decodeURIComponent(path.slice("/tts/trening/".length));
      return json(req, res, 200, { ok: treningSlett(id), ...treningStatus() });
    }

    if (path.startsWith("/tts/trening/") && method === "POST") {
      const id = decodeURIComponent(path.slice("/tts/trening/".length));
      return json(req, res, 200, { ok: treningAvbryt(id), jobb: treningJobb(id) });
    }

    if (path === "/tts/treningssett" && method === "GET")
      return json(req, res, 200, { manifest: trainingManifest(), mappe: clipDir(), statistikk: clipStats() });

    // ---- MQTT ------------------------------------------------------------

    if (path === "/mqtt" ) {
      if (method === "GET")
        return json(req, res, 200, { ...doc("mqtt", { url: "mqtt://127.0.0.1:1883", topics: ["#"], enabled: false }), status: deps.mqttStatus?.() });
      if (method === "PUT") {
        const b = await readBody(req);
        const next = { ...doc("mqtt", {}), ...b };
        saveDoc("mqtt", next);
        deps.restartMqtt?.();
        return json(req, res, 200, next);
      }
    }

    if (path === "/mqtt/helse" && method === "GET")
      return json(req, res, 200, deps.mqttHelse?.() ?? deps.mqttStatus?.() ?? { tilkoblet: false });

    if (path === "/mqtt/publiser" && method === "POST") {
      const b = await readBody(req);
      if (!deps.publish) return json(req, res, 503, { error: "MQTT er ikke tilkoblet" });
      await deps.publish(str(b.emne, "Emne", { maks: 256, min: 1 }), str(b.payload ?? "", "Nyttelast", { maks: 8000 }));
      return json(req, res, 200, { ok: true });
    }

    // ---- klyngenoder ------------------------------------------------------
    if (path === "/noder") {
      const db = doc("nodes", { list: [] });
      if (method === "GET") return json(req, res, 200, { noder: db.list, innstillinger: currentSettings() });
      if (method === "PUT") {
        if (!admin) return json(req, res, 403, { error: "Kun admin" });
        const b = await readBody(req);
        const list = (Array.isArray(b.noder) ? b.noder : []).map(validateNode);
        saveDoc("nodes", { list });
        return json(req, res, 200, { noder: list });
      }
      if (method === "POST") {
        const b = await readBody(req);
        const node = validateNode(b.node ?? b);
        db.list = [...db.list.filter((n) => n.id !== node.id), node];
        saveDoc("nodes", db);
        return json(req, res, 200, { node, noder: db.list });
      }
    }

    // ---- automatisk innrullering over SSH ---------------------------------
    if (path === "/noder/provisjoner") {
      if (!admin) return json(req, res, 403, { error: "Kun admin" });
      if (method === "GET") return json(req, res, 200, { jobber: hentJobber() });
      if (method === "POST") {
        const b = await readBody(req);
        const verter = Array.isArray(b.verter)
          ? b.verter
          : String(b.verter || b.ip || "").split(/[\s,;]+/);
        const master =
          String(b.master || "").trim() ||
          `http://${String(req.headers.host || "").split(":")[0] || os.hostname()}:${process.env.PORT || 8787}`;
        try {
          const r = startProvisjonering({
            verter,
            bruker: String(b.bruker || "").trim(),
            passord: String(b.passord || ""),
            master,
            token: String(process.env.AGENT_TOKEN || ""),
            modeller: Array.isArray(b.modeller)
              ? b.modeller
              : String(b.modeller || "llama3.2:3b").split(/[\s,]+/).filter(Boolean),
            rolle: b.rolle === "primary" || b.rolle === "observer" ? b.rolle : "worker",
            oppgaver: Array.isArray(b.oppgaver) && b.oppgaver.length ? b.oppgaver : ["chat", "verktoy"],
            navnPrefiks: String(b.navnPrefiks || "NODE").replace(/[^\w-]/g, "").slice(0, 16) || "NODE",
            parallelt: Number(b.parallelt) || 3,
          });
          return json(req, res, 200, r);
        } catch (e) {
          return json(req, res, 400, { error: String(e?.message || e) });
        }
      }
    }

    if (path.startsWith("/noder/provisjoner/") && method === "GET") {
      if (!admin) return json(req, res, 403, { error: "Kun admin" });
      const jobb = hentJobb(decodeURIComponent(path.slice("/noder/provisjoner/".length)));
      if (!jobb) return json(req, res, 404, { error: "Fant ikke jobben" });
      return json(req, res, 200, { jobb });
    }

    if (path.startsWith("/noder/") && path !== "/noder/registrer" && !path.startsWith("/noder/provisjoner") && method === "DELETE") {
      if (!admin) return json(req, res, 403, { error: "Kun admin" });
      const id = decodeURIComponent(path.slice("/noder/".length));
      const db = doc("nodes", { list: [] });
      db.list = db.list.filter((n) => n.id !== id);
      saveDoc("nodes", db);
      return json(req, res, 200, { ok: true, noder: db.list });
    }

    // ---- innstillinger (skjemadrevet, tas i bruk uten omstart) -------------
    if (path === "/innstillinger/skjema" && method === "GET")
      return json(req, res, 200, { skjema: SETTINGS_SCHEMA, verdier: currentSettings() });

    if (path === "/innstillinger") {
      if (method === "GET") return json(req, res, 200, { verdier: currentSettings() });
      if (method === "PUT") {
        if (!admin) return json(req, res, 403, { error: "Kun admin" });
        const b = await readBody(req);
        let next;
        try {
          next = validateSettings(b.verdier ?? b, currentSettings());
        } catch (e) {
          return json(req, res, 400, { error: String(e?.message || e), felter: e?.felter ?? [] });
        }
        saveDoc("settings", next);
        // MQTT-oppsettet speiles til mqtt-dokumentet og tas i bruk med én gang.
        const mqttDoc = doc("mqtt", { url: next.mqttUrl, topics: ["#"], enabled: false });
        const nyMqtt = {
          ...mqttDoc,
          url: next.mqttUrl,
          topics: String(next.mqttTopics || "#")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          enabled: !!next.mqttEnabled,
        };
        const endret =
          nyMqtt.url !== mqttDoc.url ||
          nyMqtt.enabled !== mqttDoc.enabled ||
          String(nyMqtt.topics) !== String(mqttDoc.topics);
        saveDoc("mqtt", nyMqtt);
        if (endret) deps.restartMqtt?.();
        return json(req, res, 200, { verdier: next, mqttOmstartet: endret });
      }
    }


    // ---- samtaler --------------------------------------------------------
    if (path === "/samtaler") {
      const db = doc("threads", { list: [] });
      if (method === "GET")
        return json(req, res, 200, {
          samtaler: db.list.map((t) => ({ id: t.id, tittel: t.tittel, oppdatert: t.oppdatert, antall: t.meldinger.length })),
        });
      if (method === "POST") {
        const b = await readBody(req);
        const thread = {
          id: b.id || randomUUID(),
          tittel: str(b.tittel || "Ny samtale", "Tittel", { maks: 200 }),
          oppdatert: Date.now(),
          eier: user.id,
          meldinger: Array.isArray(b.meldinger) ? b.meldinger : [],
        };
        db.list = [thread, ...db.list.filter((t) => t.id !== thread.id)].slice(0, 200);
        saveDoc("threads", db);
        return json(req, res, 200, { samtale: thread });
      }
    }

    if (path.startsWith("/samtaler/")) {
      const id = decodeURIComponent(path.slice("/samtaler/".length));
      const db = doc("threads", { list: [] });
      const thread = db.list.find((t) => t.id === id);
      if (method === "GET")
        return thread ? json(req, res, 200, { samtale: thread }) : json(req, res, 404, { error: "Fant ikke samtalen" });
      if (method === "DELETE") {
        db.list = db.list.filter((t) => t.id !== id);
        saveDoc("threads", db);
        return json(req, res, 200, { ok: true });
      }
    }

    // ---- Telegram --------------------------------------------------------
    if (path === "/telegram") {
      if (method === "GET") {
        const cfg = telegramCfg();
        return json(req, res, 200, { ...cfg, token: cfg.token ? "***lagret***" : "" });
      }
      if (method === "PUT") {
        if (!admin) return json(req, res, 403, { error: "Kun admin" });
        const b = await readBody(req);
        const patch = { ...b };
        if (!patch.token || patch.token === "***lagret***") delete patch.token;
        if (patch.chatIds) patch.chatIds = patch.chatIds.map(Number).filter(Number.isFinite);
        const cfg = saveTelegram(patch);
        return json(req, res, 200, { ...cfg, token: cfg.token ? "***lagret***" : "" });
      }
    }

    if (path === "/telegram/test" && method === "POST") {
      const b = await readBody(req);
      const cfg = telegramCfg();
      const chat = b.chatId ?? cfg.chatIds[0];
      if (!chat) return json(req, res, 400, { error: "Ingen chat-ID lagret. Send /start til boten først." });
      await sendMessage(chat, String(b.tekst || "Test fra Jarvis."));
      return json(req, res, 200, { ok: true });
    }

    // ---- versjon og konfig-pakker ---------------------------------------
    if (path === "/versjon" && method === "GET") return json(req, res, 200, versjonsinfo());

    if (path === "/versjon/oppdater/status" && method === "GET") {
      if (!admin) return json(req, res, 403, { error: "Kun admin" });
      return json(req, res, 200, await updateStatus());
    }

    if (path === "/versjon/oppdater" && method === "POST") {
      if (!admin) return json(req, res, 403, { error: "Kun admin" });
      const b = await readBody(req);
      return json(req, res, 202, await startUpdate(b.ref));
    }

    if (path === "/config/eksport" && method === "GET") {
      if (!admin) return json(req, res, 403, { error: "Kun admin" });
      const bare = (url.searchParams.get("bare") || "").split(",").filter(Boolean);
      return json(req, res, 200, eksporterKonfig(bare));
    }

    if (path === "/config/import" && method === "POST") {
      if (!admin) return json(req, res, 403, { error: "Kun admin" });
      const b = await readBody(req);
      const pakke = b.pakke ?? b;
      if (b.kunSjekk) return json(req, res, 200, inspiserKonfig(pakke));
      return json(req, res, 200, importerKonfig(pakke, { modus: b.modus, bare: b.bare }));
    }

    // ---- klyngehelse (GPU, modeller, tjenester per node) -----------------
    if (path === "/klynge/helse" && method === "GET") {
      const db = doc("nodes", { list: [] });
      const force = url.searchParams.get("frisk") === "1";
      return json(req, res, 200, await klyngeHelse(db.list, { token: process.env.AGENT_TOKEN || "", force }));
    }

    // ---- distribuer konfig til alle noder + verifiser --------------------
    if (path === "/config/distribuer" && method === "POST") {
      if (!admin) return json(req, res, 403, { error: "Kun admin" });
      const b = await readBody(req);
      const bare = Array.isArray(b.bare) ? b.bare.filter((x) => typeof x === "string") : [];
      const pakke = b.pakke && typeof b.pakke === "object" ? b.pakke : eksporterKonfig(bare);
      inspiserKonfig(pakke);
      const db = doc("nodes", { list: [] });
      const resultat = await distribuerKonfig(db.list, pakke, {
        modus: b.modus === "erstatt" ? "erstatt" : "flett",
        bare,
        token: process.env.AGENT_TOKEN || "",
      });
      tomKlyngeCache();
      return json(req, res, 200, resultat);
    }

    // ---- logger (systemd + oppsett) --------------------------------------
    if (path === "/logger/kilder" && method === "GET") {
      if (!admin) return json(req, res, 403, { error: "Kun admin" });
      return json(req, res, 200, { kilder: await loggKilder() });
    }

    if (path === "/logger" && method === "GET") {
      if (!admin) return json(req, res, 403, { error: "Kun admin" });
      const kilde = url.searchParams.get("kilde") || "agent";
      const linjer = num(url.searchParams.get("linjer"), "Linjer", { min: 10, maks: 2000, standard: 200 });
      const siden = url.searchParams.get("siden") || "";
      return json(req, res, 200, await hentLogg(kilde, { linjer, siden }));
    }

    // ---- sikkerhetskopier -------------------------------------------------

    if (path === "/backup") {
      if (!admin) return json(req, res, 403, { error: "Kun admin" });
      if (method === "GET") return json(req, res, 200, { kopier: await listBackups() });
      if (method === "POST") return json(req, res, 200, { ok: true, navn: await runBackup() });
    }

    // ---- Utstyrsregister ---------------------------------------------------
    if (path === "/utstyr" && method === "GET") {
      const type = url.searchParams.get("type") || undefined;
      const sok = url.searchParams.get("sok") || undefined;
      return json(req, res, 200, { utstyr: listUtstyr({ type, sok }), stats: utstyrStats() });
    }

    if (path === "/utstyr" && method === "POST") {
      const b = await readBody(req);
      return json(req, res, 200, { enhet: lagreUtstyr(b || {}) });
    }

    if (path === "/utstyr/fra-skann" && method === "POST") {
      const b = await readBody(req);
      return json(req, res, 200, laerFraSkann(b?.verter || b?.hosts || []));
    }

    if (path === "/utstyr/gjett" && method === "POST") {
      const b = await readBody(req);
      return json(req, res, 200, { type: gjettType(b || {}) });
    }

    if (path.startsWith("/utstyr/") && method === "GET") {
      const nokkel = decodeURIComponent(path.slice("/utstyr/".length));
      const e = hentUtstyr(nokkel);
      return e ? json(req, res, 200, { enhet: e }) : json(req, res, 404, { error: "Fant ikke enheten" });
    }

    if (path.startsWith("/utstyr/") && method === "DELETE")
      return json(req, res, 200, slettUtstyr(decodeURIComponent(path.slice("/utstyr/".length))));

    // ---- Refleksjon og verktøyerfaring -------------------------------------
    if (path === "/refleksjon" && method === "GET") return json(req, res, 200, verktoyStats());

    if (path === "/refleksjon" && method === "POST") {
      const b = await readBody(req);
      return json(req, res, 200, await reflekter(b || {}));
    }

    if (path === "/refleksjon/utfall" && method === "POST") {
      const b = await readBody(req);
      return json(req, res, 200, registrerUtfall(b || {}));
    }

    if (path === "/refleksjon/monstre" && method === "POST") return json(req, res, 200, feilmonstre());

    // ---- AGI: minne -------------------------------------------------------
    if (path === "/minne/konsolider" && method === "POST") return json(req, res, 200, konsoliderMinne());


    if (path === "/minne" && method === "GET")
      return json(req, res, 200, memoryStats());

    if (path === "/minne" && method === "POST") {
      const b = await readBody(req);
      const item = remember({
        tekst: str(b.tekst, "Tekst", { maks: 2000, min: 1 }),
        type: b.type,
        kontekst: b.kontekst,
        kilder: b.kilder,
        viktighet: num(b.viktighet, "Viktighet", { min: 1, maks: 10, standard: 5 }),
        pinned: b.pinned,
      });
      return json(req, res, 200, { minne: item });
    }

    if (path.startsWith("/minne/") && method === "GET") {
      const id = decodeURIComponent(path.slice("/minne/".length));
      const m = getMemory(id);
      return m ? json(req, res, 200, { minne: m }) : json(req, res, 404, { error: "Fant ikke minnet" });
    }

    if (path.startsWith("/minne/") && method === "DELETE") {
      const id = decodeURIComponent(path.slice("/minne/".length));
      return json(req, res, 200, forgetMemory(id));
    }

    if (path === "/minne/hent" && method === "POST") {
      const b = await readBody(req);
      return json(req, res, 200, {
        treff: recall(str(b.query ?? b.q, "Spørsmål", { maks: 1000, min: 1 }), {
          topK: num(b.topK, "Antall", { min: 1, maks: 50, standard: 5 }),
          type: b.type,
        }),
      });
    }

    if (path === "/minne/tidslinje" && method === "GET") {
      const q = url.searchParams;
      return json(req, res, 200, {
        minner: memoryTimeline({
          limit: num(q.get("maks"), "Antall", { min: 1, maks: 200, standard: 50 }),
          type: q.get("type") || undefined,
        }),
      });
    }

    // ---- AGI: planer ------------------------------------------------------
    if (path === "/planer" && method === "GET")
      return json(req, res, 200, { planer: listPlans({ aktiv: url.searchParams.get("aktiv") === "1", limit: 50 }) });

    if (path === "/planer" && method === "POST") {
      const b = await readBody(req);
      const plan = await createPlan(str(b.mål, "Mål", { maks: 500, min: 1 }), {
        kilde: b.kilde || "bruker",
        kontekst: b.kontekst,
      });
      return json(req, res, 200, { plan });
    }

    if (path.startsWith("/planer/") && method === "GET") {
      const id = decodeURIComponent(path.slice("/planer/".length));
      const plan = getPlan(id);
      return plan ? json(req, res, 200, { plan }) : json(req, res, 404, { error: "Fant ikke planen" });
    }

    if (path.startsWith("/planer/") && method === "DELETE") {
      const id = decodeURIComponent(path.slice("/planer/".length));
      return json(req, res, 200, { plan: cancelPlan(id) });
    }

    if (path.startsWith("/planer/") && method === "PATCH") {
      const id = decodeURIComponent(path.slice("/planer/".length));
      const b = await readBody(req);
      if (b.status === "aktiv") return json(req, res, 200, { plan: resumePlan(id) });
      if (b.status === "fullført") return json(req, res, 200, { plan: markerPlanFerdig(id, { oppsummering: b.oppsummering }) });
      return json(req, res, 400, { error: "Ukjent status" });
    }

    if (path === "/planer/steg" && method === "POST") {
      const b = await readBody(req);
      const plan = oppdaterSteg(str(b.planId, "Plan-ID"), str(b.stegId, "Steg-ID"), {
        status: b.status,
        resultat: b.resultat,
      });
      return json(req, res, 200, { plan });
    }

    // ---- AGI: evalueringer ------------------------------------------------
    if (path === "/evalueringer" && method === "GET")
      return json(req, res, 200, { evalueringer: listEvaluations(50), statistikk: evaluationStats() });

    if (path === "/evalueringer" && method === "POST") {
      const b = await readBody(req);
      const ev = await evaluateChatReply({
        spørsmål: str(b.spørsmål, "Spørsmål", { maks: 1000, min: 1 }),
        svar: str(b.svar, "Svar", { maks: 4000, min: 1 }),
        verktøy: Array.isArray(b.verktøy) ? b.verktøy : [],
      });
      return json(req, res, 200, { evaluering: ev });
    }

    if (path === "/oppgave/planlegg" && method === "POST") {
      const b = await readBody(req);
      const mål = str(b.mål ?? b.oppgave ?? "", "Mål", { maks: 1000, min: 1 });
      const plan = await createPlan(mål, { kilde: "agent", kontekst: b.kontekst || "" });
      // Auto-kjør planen umiddelbart etter opprettelse
      runPlanUntilDone(plan.id, Number(b.maks ?? 10)).catch(() => {});
      return json(req, res, 200, { plan, autoKjort: true });
    }
    if (path === "/oppgave/kjor" && method === "POST") {
      const b = await readBody(req);
      const planId = str(b.planId, "Plan-ID", { maks: 200, min: 1 });
      const plan = getPlan(planId);
      if (!plan) return json(req, res, 404, { ok: false, error: "Plan ikke funnet." });
      const resultater = await runPlanUntilDone(planId, Number(b.maks ?? 10));
      const oppdatert = getPlan(planId);
      return json(req, res, 200, { ok: true, resultater, plan: oppdatert });
    }
    if (path.match(/^\/oppgave\/status\/[^/]+$/) && method === "GET") {
      const planId = String(path.split("/")[3] || "");
      const plan = getPlan(planId);
      if (!plan) return json(req, res, 404, { ok: false, error: "Plan ikke funnet." });
      return json(req, res, 200, { plan });
    }
    if (path === "/oppgave/liste" && method === "GET")
      return json(req, res, 200, { planer: listPlans({ limit: 50 }) });

    if (path === "/oppgave/koe" && method === "POST") {
      const b = await readBody(req);
      const planId = str(b.planId, "Plan-ID", { maks: 200, min: 1 });
      const prioritet = Number(b.prioritet ?? 0);
      const r = await enqueuePlan(planId, { prioritet });
      return json(req, res, 200, r);
    }

    if (path === "/oppgave/koe" && method === "GET") {
      return json(req, res, 200, { ko: listQueue() });
    }

    if (path.startsWith("/oppgave/koe/") && method === "DELETE") {
      const planId = decodeURIComponent(path.slice("/oppgave/koe/".length));
      const r = removeFromQueue(planId);
      return json(req, res, 200, r);
    }

    // ---- AGI: initiativ ---------------------------------------------------
    if (path === "/initiativ" && method === "GET")
      return json(req, res, 200, initiativeStatus());

    if (path === "/initiativ" && method === "POST") {
      const b = await readBody(req);
      return json(req, res, 200, setInitiativeActive(b.aktiv === true));
    }

    if (path === "/initiativ/forslag" && method === "GET")
      return json(req, res, 200, { forslag: listInitiativeSuggestions(20) });

    if (path === "/initiativ/forslag" && method === "POST") {
      const b = await readBody(req);
      if (b.godkjenn) return json(req, res, 200, { forslag: approveSuggestion(str(b.id, "ID")) });
      if (b.avvis) return json(req, res, 200, { forslag: rejectSuggestion(str(b.id, "ID")) });
      return json(req, res, 400, { error: "Ukjent handling" });
    }

    if (path === "/initiativ/audit" && method === "GET")
      return json(req, res, 200, { audit: listInitiativeAudit(50) });

    if (path === "/initiativ/kjor" && method === "POST") {
      await runInitiativeNow();
      return json(req, res, 200, initiativeStatus());
    }

    // ---- AGI: genererte verktøy -------------------------------------------
    if (path === "/verktoy/genererte" && method === "GET")
      return json(req, res, 200, { verktoy: listGeneratedTools() });

    if (path === "/verktoy/genererte" && method === "POST") {
      const b = await readBody(req);
      const tool = await generateTool(str(b.beskrivelse, "Beskrivelse", { maks: 1000, min: 1 }));
      return json(req, res, 200, { verktoy: tool });
    }

    if (path.startsWith("/verktoy/genererte/") && method === "GET") {
      const id = decodeURIComponent(path.slice("/verktoy/genererte/".length));
      const t = getGeneratedTool(id);
      return t ? json(req, res, 200, { verktoy: t }) : json(req, res, 404, { error: "Fant ikke verktøyet" });
    }

    if (path.startsWith("/verktoy/genererte/") && method === "DELETE") {
      const id = decodeURIComponent(path.slice("/verktoy/genererte/".length));
      return json(req, res, 200, deleteGeneratedTool(id));
    }

    if (path.startsWith("/verktoy/genererte/") && method === "PATCH") {
      const id = decodeURIComponent(path.slice("/verktoy/genererte/".length));
      const b = await readBody(req);
      return json(req, res, 200, { verktoy: enableTool(id, b.enabled === true) });
    }

    if (path === "/verktoy/genererte/test" && method === "POST") {
      const b = await readBody(req);
      const resultat = await testTool(str(b.id, "ID"), b.args ?? {});
      return json(req, res, 200, resultat);
    }

    return json(req, res, 404, { error: `Ukjent API-rute ${path}` });
  } catch (e) {
    return json(req, res, 400, { error: String(e?.message || e) });
  }
}
