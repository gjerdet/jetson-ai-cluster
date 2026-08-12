/**
 * Telegram-bro for Jarvis: long polling mot Bot API, svar fra den lokale
 * AI-noden (OpenAI-kompatibel), og utgående varsler fra regelmotoren.
 * Ingen npm-avhengigheter – bruker innebygd fetch (Node 18+).
 */
import { doc, saveDoc, latest } from "./store.mjs";
import { decryptSecret, encryptSecret } from "./secrets.mjs";
import { buildPersonalityPrompt } from "./contract.mjs";


const API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

/** Rå konfigurasjon – token ligger kryptert på disk. */
export const telegramCfg = () =>
  doc("telegram", { enabled: false, token: "", chatIds: [], allowlist: true, offset: 0 });

/** Klartekst-token, kun til internt bruk (aldri ut av API-et). */
export const telegramToken = () => decryptSecret(telegramCfg().token);

export function saveTelegram(patch) {
  const next = { ...patch };
  if (typeof next.token === "string" && next.token) next.token = encryptSecret(next.token);
  const cfg = { ...telegramCfg(), ...next };
  saveDoc("telegram", cfg);
  return cfg;
}

export async function sendMessage(chatId, text) {
  const token = telegramToken();
  if (!token) throw new Error("Telegram-token mangler");
  const id = Number(chatId);
  if (!Number.isFinite(id)) throw new Error("Ugyldig chat-ID");
  const res = await fetch(API(token, "sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: id, text: String(text).slice(0, 4000) }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || "Telegram avviste meldingen");
  return data.result;
}

/** Varsler alle godkjente chatter (brukes av regelmotoren). */
export async function notifyAll(text) {
  const cfg = telegramCfg();
  if (!cfg.enabled || !cfg.token) return 0;
  let sent = 0;
  for (const id of cfg.chatIds) {
    try {
      await sendMessage(id, text);
      sent++;
    } catch (e) {
      console.error("[telegram] varsel feilet:", e?.message);
    }
  }
  return sent;
}

/** Spør den lokale AI-noden om et svar (OpenAI-kompatibelt chat-endepunkt). */
async function askJarvis(question) {
  const ai = doc("ai", { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1", apiKey: "", system: "" });
  const aiKey = decryptSecret(ai.apiKey);
  const topics = [...latest.entries()]
    .slice(0, 40)
    .map(([t, v]) => `${t}=${v.value}`)
    .join(", ");
  const personality = buildPersonalityPrompt(ai.personality);
  const system =
    (personality || ai.system || "Du er Jarvis, en lokal assistent. Svar kort og presist på norsk bokmål.") +
    (topics ? `\nSiste sensorverdier: ${topics}` : "");

  const res = await fetch(`${ai.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(aiKey ? { authorization: `Bearer ${aiKey}` } : {}),
    },
    body: JSON.stringify({
      model: ai.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: question },
      ],
      stream: false,
    }),
  });
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() || "Fikk ikke svar fra AI-noden.";
}

let polling = false;

/** Starter long polling. Kalles ved oppstart og når konfigurasjonen endres. */
export function startTelegram(deps = {}) {
  if (polling) return;
  polling = true;
  const loop = async () => {
    while (polling) {
      const cfg = telegramCfg();
      if (!cfg.enabled || !cfg.token) {
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      try {
        const res = await fetch(API(telegramToken(), "getUpdates"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ offset: cfg.offset || 0, timeout: 25, allowed_updates: ["message"] }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.description || "getUpdates feilet");
        for (const upd of data.result ?? []) {
          saveTelegram({ offset: upd.update_id + 1 });
          const msg = upd.message;
          if (!msg?.text) continue;
          await handleMessage(msg, deps);
        }
      } catch (e) {
        console.error("[telegram]", e?.message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  loop();
}

export function stopTelegram() {
  polling = false;
}

async function handleMessage(msg, deps) {
  const cfg = telegramCfg();
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (cfg.allowlist && !cfg.chatIds.includes(chatId)) {
    if (text === "/start") {
      await sendMessage(chatId, `Chat-ID: ${chatId}\nLegg den til i HUD-en under SYSTEM → KOBLINGER → TELEGRAM for å få tilgang.`);
    }
    return;
  }

  if (text === "/start" || text === "/hjelp") {
    await sendMessage(
      chatId,
      "Jarvis er på lufta.\n/status – system og sensorer\n/sensor <emne> – siste verdi\n/regler – aktive regler\nEllers: still spørsmål i klartekst.",
    );
    return;
  }

  if (text === "/status") {
    const lines = [...latest.entries()].slice(0, 25).map(([t, v]) => `${t}: ${v.value}`);
    await sendMessage(chatId, lines.length ? `Sensorer:\n${lines.join("\n")}` : "Ingen sensordata ennå.");
    return;
  }

  if (text.startsWith("/sensor")) {
    const emne = text.split(" ").slice(1).join(" ").trim();
    const v = latest.get(emne);
    await sendMessage(chatId, v ? `${emne}: ${v.value} (${new Date(v.time).toLocaleString("nb-NO")})` : `Ukjent emne «${emne}».`);
    return;
  }

  if (text === "/regler") {
    const status = deps.rulesStatus?.() ?? { antall: 0, aktive: 0 };
    await sendMessage(chatId, `Regler: ${status.aktive}/${status.antall} aktive.`);
    return;
  }

  try {
    await sendMessage(chatId, await askJarvis(text));
  } catch (e) {
    await sendMessage(chatId, `Klarte ikke å svare: ${e?.message}`);
  }
}
