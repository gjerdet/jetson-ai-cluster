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
import { evaluate, listRules, logDoc, saveRules, rulesStatus } from "./rules.mjs";
import { notifyAll, saveTelegram, sendMessage, telegramCfg } from "./telegram.mjs";
import {
  API_VERSION,
  SETTINGS_DEFAULTS,
  SETTINGS_SCHEMA,
  validateCredentials,
  validateNode,
  validateSettings,
} from "./contract.mjs";

/** Gjeldende innstillinger = standardverdier overstyrt av lagrede verdier. */
const currentSettings = () => ({ ...SETTINGS_DEFAULTS, ...(doc("settings", {}) || {}) });

import { corsBlocked, corsHeaders, rateLimit } from "./security.mjs";
import { decryptSecret, encryptSecret, maskSecret } from "./secrets.mjs";
import { listBackups, runBackup } from "./backup.mjs";
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

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 5_000_000) throw new Error("For stor forespørsel");
    chunks.push(c);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Håndterer alle /api-ruter. Returnerer true når forespørselen er besvart.
 * `deps`: { publish(emne, payload), mqttStatus() }
 */
export async function handleApi(req, res, route, url, deps = {}) {
  if (!route.startsWith("/api")) return false;
  const path = route.slice(4) || "/";
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
      trengerOppsett: userCount() === 0,
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
  const user = userFromRequest(req);
  if (!user) return json(req, res, 401, { error: "Ikke innlogget" });
  const admin = user.role === "admin";

  try {
    if (path === "/auth/me") return json(req, res, 200, { user });

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
      const base = { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1", apiKey: "", system: "" };
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

    // ---- AI-proxy: backend-en fordeler chatten mellom nodene -------------
    if (path === "/ai/chat" && method === "POST") {
      const b = await readBody(req);
      const meldinger = Array.isArray(b.meldinger) ? b.meldinger : [];
      if (!meldinger.length) return json(req, res, 400, { error: "Ingen meldinger" });
      const cfg = doc("ai", { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1", apiKey: "", system: "" });
      const key = decryptSecret(cfg.apiKey);
      const messages = meldinger
        .filter((m) => m && typeof m.content === "string")
        .slice(-40)
        .map((m) => ({
          role: ["system", "user", "assistant"].includes(m.role) ? m.role : "user",
          content: String(m.content).slice(0, 24000),
        }));

      // Klyngenodene utgjør poolen. Er klyngen tom, brukes den faste AI-noden.
      const registrerte = chatNoder(doc("nodes", { list: [] }).list);
      const fallbackNode = {
        id: "ai-standard",
        navn: "AI-node",
        baseUrl: str(b.baseUrl || cfg.baseUrl, "Adresse", { maks: 300 }).replace(/\/+$/, ""),
        modell: str(b.model || cfg.model, "Modell", { maks: 120 }),
        vekt: 1,
      };
      // Eksplisitt adresse fra klienten overstyrer balanseringen.
      const pool = b.baseUrl || !registrerte.length ? [fallbackNode] : registrerte;
      const oppgave = typeof b.oppgave === "string" ? b.oppgave : "chat";
      const foretrukket = typeof b.nodeId === "string" ? b.nodeId : "";

      const kall = async (node) => {
        const baseUrl = String(node.baseUrl).replace(/\/+$/, "");
        const model = str(b.model || node.modell || cfg.model, "Modell", { maks: 120 });
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 120_000);
        try {
          const r = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
            body: JSON.stringify({ model, messages, stream: false, temperature: Number(b.temperatur) || 0.7 }),
            signal: ctrl.signal,
          });
          if (!r.ok) throw new Error(`Noden svarte ${r.status}`);
          const data = await r.json();
          return { svar: data?.choices?.[0]?.message?.content?.trim() || "", model, baseUrl };
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
        return json(req, res, 502, {
          error: `Nådde ingen AI-node: ${e?.message || "ukjent"}`,
          kode: "unavailable",
          forsok: e?.forsok ?? [],
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
      await evaluate(
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

    if (path.startsWith("/noder/") && path !== "/noder/registrer" && method === "DELETE") {
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

    // ---- sikkerhetskopier -------------------------------------------------
    if (path === "/backup") {
      if (!admin) return json(req, res, 403, { error: "Kun admin" });
      if (method === "GET") return json(req, res, 200, { kopier: await listBackups() });
      if (method === "POST") return json(req, res, 200, { ok: true, navn: await runBackup() });
    }

    return json(req, res, 404, { error: `Ukjent API-rute ${path}` });
  } catch (e) {
    return json(req, res, 400, { error: String(e?.message || e) });
  }
}
