/**
 * Selvlæring for Jarvis: søk på nettet, hent kildetekst og legg den inn i
 * den lokale kunnskapsbasen (RAG). Alt lagres lokalt – nettet brukes bare
 * til å hente kildeteksten én gang.
 */
import { addDocument, search } from "./rag.mjs";

const UA = "JarvisAgent/1.0 (lokal kunnskapsbase)";

const avkod = (s) =>
  String(s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'");

/** Rein tekst ut av HTML. */
export function tekstFraHtml(html) {
  return avkod(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sjekkUrl(url) {
  const u = new URL(String(url || "").trim());
  if (u.protocol !== "http:" && u.protocol !== "https:")
    throw new Error("Bare http:// og https:// er tillatt.");
  return u;
}

/** Henter en nettside og returnerer tittel + ren tekst. */
export async function hentUrl(url, { timeoutMs = 20_000, maksTegn = 200_000 } = {}) {
  const u = sjekkUrl(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(u, { headers: { "user-agent": UA, accept: "text/html,text/plain,*/*" }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`Kilden svarte ${r.status}`);
    const raa = await r.text();
    const type = String(r.headers.get("content-type") || "");
    const tekst = /json|text\/plain|markdown/i.test(type) ? raa.trim() : tekstFraHtml(raa);
    const tittel = avkod(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(raa)?.[1] || "").trim() || u.hostname + u.pathname;
    if (!tekst) throw new Error("Fant ingen lesbar tekst på siden.");
    return { url: u.toString(), tittel: tittel.slice(0, 300), tekst: tekst.slice(0, maksTegn) };
  } finally {
    clearTimeout(timer);
  }
}

/** Kort utdrag som hører til treffet like etter posisjonen i søkeresultatet. */
function utdragEtter(html, fra) {
  const bit = html.slice(fra, fra + 4000);
  const m = /class="result-snippet"[^>]*>([\s\S]*?)<\/td>/i.exec(bit);
  if (!m) return "";
  return tekstFraHtml(m[1]).replace(/\s+/g, " ").trim().slice(0, 320);
}

/** Fritekstsøk på nettet via DuckDuckGo (ingen API-nøkkel). */
export async function sokWeb(sporsmal, antall = 5) {
  const q = String(sporsmal || "").trim();
  if (!q) throw new Error("Mangler søketekst.");
  const grense = Math.max(1, Math.min(Number(antall) || 5, 10));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const r = await fetch("https://lite.duckduckgo.com/lite/", {
      method: "POST",
      headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ q }).toString(),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`Søkemotoren svarte ${r.status}`);
    const html = await r.text();
    const treff = [];
    const sett = new Set();
    const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) && treff.length < grense) {
      let href = avkod(m[1]);
      const uddg = /[?&]uddg=([^&"]+)/.exec(href);
      if (uddg) href = decodeURIComponent(uddg[1]);
      if (!/^https?:\/\//i.test(href)) continue;
      if (/duckduckgo\.com/i.test(href)) continue;
      const tittel = tekstFraHtml(m[2]).slice(0, 200);
      if (!tittel || sett.has(href)) continue;
      sett.add(href);
      treff.push({ tittel, url: href, utdrag: utdragEtter(html, m.index + m[0].length) });
    }
    if (!treff.length) throw new Error("Fant ingen treff. Prøv andre søkeord.");
    return { sporsmal: q, treff };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lærer om et tema: søker (eller bruker oppgitte URL-er), henter tekst og
 * indekserer alt i kunnskapsbasen. Returnerer kilder + et første utdrag
 * agenten kan svare ut fra med én gang.
 */
export async function laerOm({ tema, urler = [], antall = 3 } = {}) {
  const emne = String(tema || "").trim();
  if (!emne) throw new Error("Mangler tema å lære om.");
  const grense = Math.max(1, Math.min(Number(antall) || 3, 5));

  let kandidater = (Array.isArray(urler) ? urler : [])
    .map((u) => String(u || "").trim())
    .filter((u) => /^https?:\/\//i.test(u))
    .slice(0, grense)
    .map((url) => ({ url, tittel: url }));

  let sok = null;
  if (!kandidater.length) {
    sok = await sokWeb(emne, grense);
    kandidater = sok.treff.slice(0, grense);
  }

  const kilder = [];
  for (const k of kandidater) {
    try {
      const side = await hentUrl(k.url, { maksTegn: 60_000 });
      const dok = await addDocument({
        tittel: `${emne} – ${side.tittel}`.slice(0, 300),
        tekst: side.tekst,
        kilde: side.url,
        type: "web",
      });
      kilder.push({
        url: side.url,
        tittel: side.tittel,
        tegn: side.tekst.length,
        biter: dok?.biter ?? 0,
        dokId: dok?.dokument?.id ?? "",
        utdrag: side.tekst.slice(0, 1200),
        feil: dok?.embedFeil || "",
      });
    } catch (e) {
      kilder.push({ url: k.url, tittel: k.tittel, tegn: 0, biter: 0, dokId: "", utdrag: "", feil: String(e?.message || e) });
    }
  }

  let treff = [];
  try {
    treff = (await search(emne, { topK: 5 }))?.treff ?? [];
  } catch {
    /* kunnskapsbasen kan mangle embedding-modell – kildene står fortsatt */
  }

  const laert = kilder.filter((k) => k.biter > 0).length;
  return {
    ok: laert > 0,
    tema: emne,
    laerte: laert,
    kilder,
    treff,
    ...(sok ? { sokte: true } : { sokte: false }),
  };
}
