import { createServerFn } from "@tanstack/react-start";

const avkodHtml = (s: string) => s
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/gi, "'");

/**
 * Henter en nettside og trekker ut ren tekst, slik at den kan indekseres
 * i kunnskapsbasen. Kjøres på server-siden for å unngå CORS-sperrer.
 */
export const hentNettside = createServerFn({ method: "POST" })
  .inputValidator((input: { url: string }) => ({ url: String(input.url || "").trim() }))
  .handler(async ({ data }): Promise<{ tittel: string; tekst: string; url: string }> => {
    if (!/^https?:\/\//i.test(data.url)) throw new Error("Adressen må starte med http:// eller https://");
    const res = await fetch(data.url, {
      headers: { "user-agent": "JarvisHUD/1.0 (kunnskapsbase)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Nettsiden svarte ${res.status}`);
    const html = await res.text();
    const tittel = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() || data.url;
    const utenRamme = html
      .replace(/<(nav|header|footer|aside|form|svg)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<div[^>]*(cookie|consent|samtykke|paywall)[^>]*>[\s\S]*?<\/div>/gi, " ");

    const rens = (s: string) =>
      avkodHtml(s
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim());

    const overskrifter: string[] = [];
    const hRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
    let m: RegExpExecArray | null;
    while ((m = hRe.exec(utenRamme)) && overskrifter.length < 20) {
      const t = rens(m[2] ?? "");
      if (t.length >= 18 && t.length <= 200 && !overskrifter.includes(t)) overskrifter.push(t);
    }
    // JavaScript-tunge nyhetssider har ofte sakene i strukturert JSON-LD.
    const jsonRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    while ((m = jsonRe.exec(html)) && overskrifter.length < 20) {
      try {
        const besok = (v: unknown): void => {
          if (!v || typeof v !== "object") return;
          if (Array.isArray(v)) return v.forEach(besok);
          const o = v as Record<string, unknown>;
          if (/NewsArticle|Article|BlogPosting/i.test(String(o["@type"] ?? ""))) {
            const t = String(o["headline"] ?? o["name"] ?? "").replace(/\s+/g, " ").trim();
            if (t.length >= 12 && !overskrifter.includes(t)) overskrifter.push(t);
          }
          Object.values(o).forEach(besok);
        };
        besok(JSON.parse(avkodHtml(m[1] ?? "")));
      } catch { /* ugyldig JSON-LD */ }
    }
    const topp = overskrifter.length
      ? `TOPPSAKER PÅ SIDEN (nyeste øverst):\n${overskrifter.map((o, i) => `${i + 1}. ${o}`).join("\n")}\n\n`
      : "";

    const tekst = utenRamme
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!tekst) throw new Error("Fant ingen tekst på siden.");
    return { tittel: tittel.slice(0, 300), tekst: `${topp}${tekst}`.slice(0, 400_000), url: data.url };
  });

