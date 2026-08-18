/**
 * Kolleger: andre AI-noder (Hermes, OpenRouter, ekstra Jetson-er) som Jarvis
 * kan sette i arbeid. Modulen eier kollega-registeret, en robust kall-kjede,
 * ende-til-ende-diagnose og flerrunders delegering.
 */
import { callChatEndpoint, listModels, normalizeBase } from "./ai-endpoint.mjs";
import { doc, saveDoc } from "./store.mjs";

function register() {
  return doc("kollegaer", { profiler: {} });
}

function lagreProfil(id, patch) {
  const d = register();
  d.profiler[id] = { ...(d.profiler[id] || {}), ...patch, oppdatert: Date.now() };
  saveDoc("kollegaer", d);
  return d.profiler[id];
}

export function kollegaProfiler() {
  return register().profiler;
}

/** Alle aktive noder med profil. */
export function listKollegaer() {
  const noder = doc("nodes", { list: [] }).list || [];
  const profiler = kollegaProfiler();
  return noder
    .filter((n) => n.aktiv !== false && n.enabled !== false)
    .map((n) => ({
      id: n.id,
      navn: n.navn ?? n.name ?? n.id,
      baseUrl: n.baseUrl,
      model: n.model ?? n.modell ?? "",
      apiKey: n.apiKey ?? "",
      profil: profiler[n.id] || null,
    }));
}

/** Velger beste kollega for en oppgave: navnetreff → profil → raskeste. */
export function velgKollega(onske = "", { unntatt = [] } = {}) {
  const alle = listKollegaer().filter((k) => !unntatt.includes(k.id));
  if (!alle.length) return null;
  const q = String(onske || "").toLowerCase().trim();
  if (q) {
    const treff = alle.find(
      (k) =>
        k.navn.toLowerCase().includes(q) ||
        String(k.model).toLowerCase().includes(q) ||
        k.id.toLowerCase().includes(q),
    );
    if (treff) return treff;
  }
  const sortert = [...alle].sort((a, b) => {
    const fa = a.profil?.feil ?? 0;
    const fb = b.profil?.feil ?? 0;
    if (fa !== fb) return fa - fb;
    return (a.profil?.snittMs ?? 99_999) - (b.profil?.snittMs ?? 99_999);
  });
  return sortert[0];
}

/** Ende-til-ende-diagnose: adresse → modell finnes → modellen svarer. */
export async function diagnoser(kollega) {
  const steg = [];
  const base = normalizeBase(kollega?.baseUrl || "");
  if (!base) return { ok: false, steg: [{ navn: "adresse", ok: false, detalj: "Noden mangler adresse." }] };

  // 1. Når vi adressen i det hele tatt?
  let modeller = [];
  try {
    modeller = await listModels(base, { apiKey: kollega.apiKey });
    steg.push({ navn: "adresse", ok: true, detalj: `${base} svarer (${modeller.length} modeller)` });
  } catch (e) {
    steg.push({ navn: "adresse", ok: false, detalj: `${base}: ${e?.message || e}` });
  }

  // 2. Finnes modellen som er satt?
  const modell = String(kollega.model || "").trim();
  if (modeller.length) {
    const finnes = modeller.some((m) => m.toLowerCase() === modell.toLowerCase());
    steg.push({
      navn: "modell",
      ok: finnes,
      detalj: finnes
        ? `«${modell}» er installert`
        : `«${modell}» finnes ikke. Tilgjengelige: ${modeller.slice(0, 8).join(", ")}`,
    });
  } else {
    steg.push({ navn: "modell", ok: null, detalj: "Kunne ikke liste modeller – prøver kall direkte." });
  }

  // 3. Svarer modellen på en faktisk melding?
  const t0 = Date.now();
  try {
    const r = await callChatEndpoint({
      baseUrl: base,
      model: modell,
      apiKey: kollega.apiKey,
      messages: [
        { role: "system", content: "Svar med nøyaktig ordet PONG." },
        { role: "user", content: "ping" },
      ],
      timeoutMs: 60_000,
    });
    const ms = Date.now() - t0;
    steg.push({ navn: "svar", ok: true, detalj: `${r.endpoint} svarte på ${ms} ms: ${r.svar.slice(0, 80)}` });
    lagreProfil(kollega.id, {
      navn: kollega.navn,
      sistOk: Date.now(),
      snittMs: Math.round(((kollegaProfiler()[kollega.id]?.snittMs ?? ms) + ms) / 2),
      feil: 0,
      modeller: modeller.slice(0, 20),
      endepunkt: r.endpoint,
    });
  } catch (e) {
    steg.push({ navn: "svar", ok: false, detalj: String(e?.message || e).slice(0, 500) });
    lagreProfil(kollega.id, {
      navn: kollega.navn,
      sistFeil: Date.now(),
      feil: (kollegaProfiler()[kollega.id]?.feil ?? 0) + 1,
      sisteFeiltekst: String(e?.message || e).slice(0, 300),
    });
  }

  return { ok: steg.every((s) => s.ok !== false), kollega: kollega.navn, steg };
}

/** Diagnose for alle kolleger. */
export async function diagnoserAlle() {
  const liste = listKollegaer();
  const ut = [];
  for (const k of liste) ut.push(await diagnoser(k));
  return ut;
}

/**
 * Deleger en oppgave. Støtter flere runder: Jarvis spør → kollega svarer →
 * oppfølgingsspørsmål. Hele utvekslingen returneres slik at HUD-en kan vise den.
 */
export async function deleger({ node = "", oppgave, kontekst = "", runder = 1, oppfolging = [] }) {
  if (!oppgave) throw new Error("Mangler oppgave.");
  const forsokt = [];
  let kollega = velgKollega(node);
  const utveksling = [];

  while (kollega) {
    const meldinger = [
      {
        role: "system",
        content:
          "Du er en fagkollega som hjelper hovedagenten JARVIS. Svar kort, konkret og på norsk bokmål. " +
          "Du har ingen verktøy og ingen tilgang til nettet eller maskinen – bruk kun konteksten du får. " +
          "Er noe usikkert, si det tydelig i stedet for å gjette.",
      },
      { role: "user", content: kontekst ? `Kontekst fra JARVIS:\n${kontekst}\n\nOppgave:\n${oppgave}` : oppgave },
    ];

    const t0 = Date.now();
    try {
      const r = await callChatEndpoint({
        baseUrl: kollega.baseUrl,
        model: kollega.model,
        apiKey: kollega.apiKey,
        messages: meldinger,
        timeoutMs: 300_000,
      });
      const ms = Date.now() - t0;
      utveksling.push({ fra: "jarvis", tekst: oppgave });
      utveksling.push({ fra: kollega.navn, tekst: r.svar, ms });
      lagreProfil(kollega.id, { navn: kollega.navn, sistOk: Date.now(), snittMs: ms, feil: 0 });

      // Flere runder: still oppfølgingsspørsmål i samme tråd.
      const flere = Math.min(Number(runder) || 1, 4) - 1;
      for (let i = 0; i < flere; i++) {
        const sporsmal = oppfolging[i] || "Hva er det viktigste jeg bør sjekke videre? Svar kort.";
        meldinger.push({ role: "assistant", content: r.svar });
        meldinger.push({ role: "user", content: sporsmal });
        const neste = await callChatEndpoint({
          baseUrl: kollega.baseUrl,
          model: kollega.model,
          apiKey: kollega.apiKey,
          messages: meldinger,
          timeoutMs: 300_000,
        });
        utveksling.push({ fra: "jarvis", tekst: sporsmal });
        utveksling.push({ fra: kollega.navn, tekst: neste.svar });
      }

      return { ok: true, kollega: kollega.navn, modell: kollega.model, ms, svar: r.svar, utveksling };
    } catch (e) {
      const feil = String(e?.message || e).slice(0, 400);
      forsokt.push(`${kollega.navn}: ${feil}`);
      lagreProfil(kollega.id, {
        navn: kollega.navn,
        sistFeil: Date.now(),
        feil: (kollegaProfiler()[kollega.id]?.feil ?? 0) + 1,
        sisteFeiltekst: feil,
      });
      kollega = velgKollega("", { unntatt: [...forsokt.map(() => kollega.id), kollega.id] });
    }
  }

  return {
    ok: false,
    feil: forsokt.length ? forsokt.join(" | ") : "Ingen aktive kolleger å delegere til.",
    utveksling,
  };
}
