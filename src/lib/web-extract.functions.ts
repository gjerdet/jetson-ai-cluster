import { createServerFn } from "@tanstack/react-start";

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
    const tekst = html
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
    return { tittel: tittel.slice(0, 300), tekst: tekst.slice(0, 400_000), url: data.url };
  });
