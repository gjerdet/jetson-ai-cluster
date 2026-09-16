/**
 * Selvlæring for Jarvis: søk på nettet, hent kildetekst og legg den inn i
 * den lokale kunnskapsbasen (RAG). Alt lagres lokalt – nettet brukes bare
 * til å hente kildeteksten én gang.
 */
import { addDocument, search } from "./rag.mjs";

const UA = "JarvisAgent/1.0 (lokal kunnskapsbase)";
const BLOKKERT = /enable javascript|javascript is required|access denied|verify you are human|checking your browser|captcha|robot check|du må aktivere javascript/i;

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

/** Fjerner meny, bunntekst, sidefelt og samtykkebokser før teksten trekkes ut. */
function fjernRamme(html) {
  return String(html || "")
    .replace(/<(nav|header|footer|aside|form|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<div[^>]*(cookie|consent|samtykke|sp_message|paywall|newsletter)[^>]*>[\s\S]*?<\/div>/gi, " ");
}

const JUNK =
  /^(logg inn|logg ut|meny|søk|abonnement|abonner|e-avis|kontakt|kontakt oss|annonse|annonser|personvern|cookies|informasjonskapsler|samtykke|tips oss|del|les mer|nyheter|sport|kultur|debatt|podcast|forside|om oss)$/i;

/**
 * Plukker ut overskriftene på siden: <h1>–<h3> og lenketekster som ser ut som
 * artikkeltitler. Dette er det som faktisk svarer på «hva er siste nyhet».
 */
export function overskrifterFraHtml(html, baseUrl = "") {
  const rent = fjernRamme(html);
  const funn = [];
  const sett = new Set();
  const legg = (tittel, href = "") => {
    const t = tekstFraHtml(tittel).replace(/\s+/g, " ").trim();
    if (!t || t.length < 18 || t.length > 200) return;
    if (JUNK.test(t)) return;
    const nokkel = t.toLowerCase();
    if (sett.has(nokkel)) return;
    sett.add(nokkel);
    let lenke = "";
    try {
      if (href) lenke = new URL(avkod(href), baseUrl || undefined).toString();
    } catch {
      /* ugyldig lenke – overskriften står likevel */
    }
    funn.push({ tittel: t, url: lenke });
  };

  let m;
  const hRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  while ((m = hRe.exec(rent))) {
    const inni = m[2];
    const a = /<a[^>]+href="([^"]+)"/i.exec(inni);
    legg(inni, a ? a[1] : "");
  }
  const aRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = aRe.exec(rent))) {
    const t = tekstFraHtml(m[2]).replace(/\s+/g, " ").trim();
    if (t.split(/\s+/).length < 4) continue;
    legg(m[2], m[1]);
  }
  return funn.slice(0, 20);
}

/** Nyheter fra JSON-LD fungerer også på sider der artiklene bygges med JavaScript. */
export function strukturerteSakerFraHtml(html, baseUrl = "") {
  const funn = [];
  const sett = new Set();
  const legg = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(legg);
    const type = String(node["@type"] || "");
    const tittel = String(node.headline || node.name || "").replace(/\s+/g, " ").trim();
    if (/NewsArticle|Article|BlogPosting/i.test(type) && tittel.length >= 12 && !sett.has(tittel.toLowerCase())) {
      let url = String(node.url || node.mainEntityOfPage?.["@id"] || node.mainEntityOfPage || "");
      try { url = url ? new URL(url, baseUrl || undefined).toString() : ""; } catch { url = ""; }
      sett.add(tittel.toLowerCase());
      funn.push({ tittel, url, publisert: String(node.datePublished || node.dateModified || "") });
    }
    Object.values(node).forEach(legg);
  };
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    try { legg(JSON.parse(avkod(m[1]).trim())); } catch { /* ugyldig JSON-LD */ }
  }
  return funn.slice(0, 20);
}

export function rssSaker(xml, baseUrl = "") {
  const funn = [];
  const sett = new Set();
  const blokker = String(xml || "").match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
  for (const blokk of blokker) {
    const hent = (tag) => avkod(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(blokk)?.[1] || "")
      .replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const tittel = hent("title");
    if (tittel.length < 8 || sett.has(tittel.toLowerCase())) continue;
    let url = hent("link") || /<link[^>]+href=["']([^"']+)/i.exec(blokk)?.[1] || hent("guid");
    try { url = url ? new URL(url, baseUrl || undefined).toString() : ""; } catch { url = ""; }
    sett.add(tittel.toLowerCase());
    funn.push({ tittel, url, publisert: hent("pubDate") || hent("published") || hent("updated") });
  }
  return funn.slice(0, 20);
}

function rssLenkerFraHtml(html, baseUrl) {
  const ut = [];
  const re = /<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]+href=["']([^"']+)/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    try { ut.push(new URL(avkod(m[1]), baseUrl).toString()); } catch { /* ignorer */ }
  }
  return ut;
}

async function hentTekst(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,text/plain;q=0.8,*/*;q=0.2" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!r.ok) throw new Error(`Kilden svarte ${r.status}`);
    return { raa: await r.text(), type: String(r.headers.get("content-type") || ""), url: r.url || String(url) };
  } finally { clearTimeout(timer); }
}

/** Henter en nettside og returnerer tittel + ren tekst (med toppsaker først). */
export async function hentUrl(url, { timeoutMs = 20_000, maksTegn = 200_000, sporsmal = "" } = {}) {
  const u = sjekkUrl(url);
  try {
    const { raa, type, url: sluttUrl } = await hentTekst(u, timeoutMs);
    const erHtml = !/json|text\/plain|markdown/i.test(type);
    const brodtekst = erHtml ? tekstFraHtml(fjernRamme(raa)) || tekstFraHtml(raa) : raa.trim();
    const strukturerte = erHtml ? strukturerteSakerFraHtml(raa, sluttUrl) : [];
    let overskrifter = erHtml ? [...strukturerte, ...overskrifterFraHtml(raa, sluttUrl)] : [];
    overskrifter = overskrifter.filter((sak, i, alle) => alle.findIndex((x) => x.tittel.toLowerCase() === sak.tittel.toLowerCase()) === i);
    let metode = strukturerte.length ? "JSON-LD + HTML" : "HTML";

    // Tynne/JavaScript-baserte forsider får en reservevei via nettstedets feed.
    if (erHtml && (overskrifter.length < 2 || BLOKKERT.test(brodtekst))) {
      const kandidater = [
        ...rssLenkerFraHtml(raa, sluttUrl),
        new URL("/feed/", sluttUrl).toString(),
        new URL("/rss", sluttUrl).toString(),
        new URL("/rss.xml", sluttUrl).toString(),
        new URL("/feed.xml", sluttUrl).toString(),
      ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 5);
      for (const feedUrl of kandidater) {
        try {
          const feed = await hentTekst(feedUrl, Math.min(timeoutMs, 8_000));
          const saker = rssSaker(feed.raa, feed.url);
          if (saker.length) { overskrifter = saker; metode = "RSS/Atom"; break; }
        } catch { /* prøv neste feed */ }
      }
    }

    // Siste reservevei: målrettet søk i domenet. Gir ekte kilder selv ved bot-sperre.
    if (overskrifter.length < 2 || BLOKKERT.test(brodtekst)) {
      try {
        const hensikt = String(sporsmal || "nyeste nyheter").replace(/\bhttps?:\/\/\S+/gi, "").trim();
        const sok = await sokWeb(`site:${u.hostname} ${hensikt || "nyeste nyheter"}`, 8);
        if (sok.treff.length) {
          overskrifter = sok.treff.map((t) => ({ tittel: t.tittel, url: t.url, publisert: "" }));
          metode = "målrettet nettsøk";
        }
      } catch { /* den direkte teksten kan fortsatt være nyttig */ }
    }
    const topp = overskrifter.length
      ? `TOPPSAKER/KILDER (${metode}; rekkefølgen er kildens, ikke gjett publiseringstid):\n${overskrifter
          .map((o, i) => `${i + 1}. ${o.tittel}${o.publisert ? ` (${o.publisert})` : ""}${o.url ? `\n   ${o.url}` : ""}`)
          .join("\n")}\n\n`
      : "";
    const tekst = `${topp}${brodtekst}`.trim();
    const tittel = avkod(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(raa)?.[1] || "").trim() || u.hostname + u.pathname;
    if (!tekst || (BLOKKERT.test(tekst) && !overskrifter.length)) throw new Error("Siden blokkerte lesing, og reservekildene ga ingen treff.");
    return {
      url: sluttUrl,
      tittel: tittel.slice(0, 300),
      tekst: tekst.slice(0, maksTegn),
      overskrifter,
      metode,
    };
  } catch (e) {
    throw new Error(`Klarte ikke hente ${u.hostname}: ${String(e?.message || e)}`);
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
