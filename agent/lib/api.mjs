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
import { validateCredentials } from "./contract.mjs";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "86400",
};

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...CORS });
  res.end(JSON.stringify(body));
  return true;
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
    res.writeHead(204, CORS);
    res.end();
    return true;
  }

  // ---- åpne endepunkter ------------------------------------------------
  if (path === "/status" && method === "GET") {
    return json(res, 200, {
      ok: true,
      backend: "jarvis-agent",
      versjon: "2.0.0",
      vert: os.hostname(),
      oppetidSek: Math.round(process.uptime()),
      brukere: userCount(),
      trengerOppsett: userCount() === 0,
      tls: deps.tls === true,
      mqtt: deps.mqttStatus?.() ?? { tilkoblet: false },
      regler: rulesStatus(),
      emner: latest.size,
    });
  }

  if (path === "/auth/login" && method === "POST") {
    try {
      const b = await readBody(req);
      return json(res, 200, login(b.epost ?? b.email, b.passord ?? b.password));
    } catch (e) {
      return json(res, 401, { error: String(e?.message || e) });
    }
  }

  if (path === "/auth/register" && method === "POST") {
    const first = userCount() === 0;
    const actor = userFromRequest(req);
    if (!first && actor?.role !== "admin")
      return json(res, 403, { error: "Kun admin kan opprette nye brukere." });
    try {
      const b = await readBody(req);
      const cred = validateCredentials(b.epost ?? b.email, b.passord ?? b.password);
      const user = createUser({ email: cred.email, password: cred.password, role: b.rolle });
      return json(res, 200, first ? login(cred.email, cred.password) : { user });
    } catch (e) {
      return json(res, 400, { error: String(e?.message || e) });
    }
  }

  // ---- alt under her krever innlogging ---------------------------------
  const user = userFromRequest(req);
  if (!user) return json(res, 401, { error: "Ikke innlogget" });
  const admin = user.role === "admin";

  try {
    if (path === "/auth/me") return json(res, 200, { user });

    if (path === "/auth/logout" && method === "POST") {
      logout(user.token);
      return json(res, 200, { ok: true });
    }

    if (path === "/auth/passord" && method === "POST") {
      const b = await readBody(req);
      changePassword(b.brukerId && admin ? b.brukerId : user.id, b.passord ?? b.password);
      return json(res, 200, { ok: true });
    }

    if (path === "/brukere" && method === "GET") return json(res, 200, { brukere: listUsers() });

    if (path.startsWith("/brukere/") && method === "DELETE") {
      if (!admin) return json(res, 403, { error: "Kun admin" });
      const id = decodeURIComponent(path.slice("/brukere/".length));
      if (id === user.id) return json(res, 400, { error: "Du kan ikke slette deg selv." });
      return json(res, 200, { ok: deleteUser(id) });
    }

    // ---- delt konfigurasjon --------------------------------------------
    if (path === "/config") {
      if (method === "GET") return json(res, 200, doc("config", { versjon: 0, data: null }));
      if (method === "PUT") {
        const b = await readBody(req);
        const current = doc("config", { versjon: 0, data: null });
        const next = { versjon: (current.versjon || 0) + 1, oppdatert: Date.now(), av: user.email, data: b.data ?? b };
        saveDoc("config", next);
        return json(res, 200, next);
      }
    }

    // ---- AI-node for Telegram-boten -------------------------------------
    if (path === "/ai") {
      if (method === "GET") return json(res, 200, doc("ai", { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1", apiKey: "", system: "" }));
      if (method === "PUT") {
        const b = await readBody(req);
        const next = { ...doc("ai", {}), ...b };
        saveDoc("ai", next);
        return json(res, 200, next);
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
      return json(res, 200, {
        antall: rows.length,
        rader: rows,
        oppsummering: summarize(rows),
      });
    }

    if (path === "/maalinger" && method === "POST") {
      const b = await readBody(req);
      const row = addSample({ topic: String(b.emne), value: b.verdi, time: b.tid || Date.now() });
      await evaluate(
        { topic: row.e, value: row.v ?? row.s, previous: null },
        { publish: deps.publish, notify: notifyAll },
      );
      return json(res, 200, { ok: true, rad: row });
    }

    if (path === "/maalinger/siste" && method === "GET")
      return json(res, 200, { emner: Object.fromEntries(latest) });

    if (path === "/maalinger/rydd" && method === "POST")
      return json(res, 200, { slettedeDager: await pruneSamples() });

    // ---- enheter ---------------------------------------------------------
    if (path === "/enheter") {
      if (method === "GET") return json(res, 200, doc("devices", { list: [] }));
      if (method === "PUT") {
        const b = await readBody(req);
        const next = { list: Array.isArray(b.list) ? b.list : [] };
        saveDoc("devices", next);
        return json(res, 200, next);
      }
    }

    // ---- regler ----------------------------------------------------------
    if (path === "/regler") {
      if (method === "GET") return json(res, 200, { regler: listRules(), status: rulesStatus() });
      if (method === "PUT") {
        const b = await readBody(req);
        return json(res, 200, { regler: saveRules(b.regler ?? b.list) });
      }
    }

    if (path === "/regler/logg" && method === "GET")
      return json(res, 200, { hendelser: logDoc().list.slice(0, 200) });

    // ---- MQTT ------------------------------------------------------------
    if (path === "/mqtt" ) {
      if (method === "GET")
        return json(res, 200, { ...doc("mqtt", { url: "mqtt://127.0.0.1:1883", topics: ["#"], enabled: false }), status: deps.mqttStatus?.() });
      if (method === "PUT") {
        const b = await readBody(req);
        const next = { ...doc("mqtt", {}), ...b };
        saveDoc("mqtt", next);
        deps.restartMqtt?.();
        return json(res, 200, next);
      }
    }

    if (path === "/mqtt/publiser" && method === "POST") {
      const b = await readBody(req);
      if (!deps.publish) return json(res, 503, { error: "MQTT er ikke tilkoblet" });
      await deps.publish(String(b.emne), String(b.payload ?? ""));
      return json(res, 200, { ok: true });
    }

    // ---- samtaler --------------------------------------------------------
    if (path === "/samtaler") {
      const db = doc("threads", { list: [] });
      if (method === "GET")
        return json(res, 200, {
          samtaler: db.list.map((t) => ({ id: t.id, tittel: t.tittel, oppdatert: t.oppdatert, antall: t.meldinger.length })),
        });
      if (method === "POST") {
        const b = await readBody(req);
        const thread = {
          id: b.id || randomUUID(),
          tittel: String(b.tittel || "Ny samtale"),
          oppdatert: Date.now(),
          eier: user.id,
          meldinger: Array.isArray(b.meldinger) ? b.meldinger : [],
        };
        db.list = [thread, ...db.list.filter((t) => t.id !== thread.id)].slice(0, 200);
        saveDoc("threads", db);
        return json(res, 200, { samtale: thread });
      }
    }

    if (path.startsWith("/samtaler/")) {
      const id = decodeURIComponent(path.slice("/samtaler/".length));
      const db = doc("threads", { list: [] });
      const thread = db.list.find((t) => t.id === id);
      if (method === "GET")
        return thread ? json(res, 200, { samtale: thread }) : json(res, 404, { error: "Fant ikke samtalen" });
      if (method === "DELETE") {
        db.list = db.list.filter((t) => t.id !== id);
        saveDoc("threads", db);
        return json(res, 200, { ok: true });
      }
    }

    // ---- Telegram --------------------------------------------------------
    if (path === "/telegram") {
      if (method === "GET") {
        const cfg = telegramCfg();
        return json(res, 200, { ...cfg, token: cfg.token ? "***lagret***" : "" });
      }
      if (method === "PUT") {
        if (!admin) return json(res, 403, { error: "Kun admin" });
        const b = await readBody(req);
        const patch = { ...b };
        if (!patch.token || patch.token === "***lagret***") delete patch.token;
        if (patch.chatIds) patch.chatIds = patch.chatIds.map(Number).filter(Number.isFinite);
        const cfg = saveTelegram(patch);
        return json(res, 200, { ...cfg, token: cfg.token ? "***lagret***" : "" });
      }
    }

    if (path === "/telegram/test" && method === "POST") {
      const b = await readBody(req);
      const cfg = telegramCfg();
      const chat = b.chatId ?? cfg.chatIds[0];
      if (!chat) return json(res, 400, { error: "Ingen chat-ID lagret. Send /start til boten først." });
      await sendMessage(chat, String(b.tekst || "Test fra Jarvis."));
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: `Ukjent API-rute ${path}` });
  } catch (e) {
    return json(res, 400, { error: String(e?.message || e) });
  }
}
