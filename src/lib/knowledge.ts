/**
 * Kunnskapsbase-hjelpere for HUD-en.
 *  - trekker tekst ut av opplastede filer (PDF, tekst, markdown, csv, json)
 *  - henter kontekst fra backend-en før Jarvis svarer
 */
import { backend, safe, backendToken } from "@/lib/backend";
import type { KnowledgeHit } from "@/lib/backend";

/** Leser tekst fra en fil i nettleseren. PDF håndteres med pdf.js. */
export async function extractText(file: File): Promise<string> {
  const navn = file.name.toLowerCase();
  if (navn.endsWith(".pdf") || file.type === "application/pdf") return extractPdf(file);
  return (await file.text()).trim();
}

async function extractPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const buf = await file.arrayBuffer();
  const dok = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const sider: string[] = [];
  for (let i = 1; i <= dok.numPages; i++) {
    const side = await dok.getPage(i);
    const innhold = await side.getTextContent();
    const tekst = innhold.items
      .map((it) => (typeof it === "object" && it && "str" in it ? String((it as { str: string }).str) : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (tekst) sider.push(tekst);
  }
  return sider.join("\n\n");
}

export type Citation = { tittel: string; kilde: string; utdrag: string; poeng: number };

/**
 * Henter relevant kontekst fra kunnskapsbasen.
 * Returnerer tom kontekst når backend-en ikke er tilgjengelig – chat skal
 * aldri stoppe fordi kunnskapsbasen er nede.
 */
export async function retrieveContext(
  sporsmal: string,
  topK = 5,
): Promise<{ context: string; sources: Citation[] }> {
  if (!backendToken()) return { context: "", sources: [] };
  const { data } = await safe(() => backend.sokKunnskap(sporsmal, topK));
  const treff: KnowledgeHit[] = data?.treff ?? [];
  if (!treff.length) return { context: "", sources: [] };
  const sources: Citation[] = treff.map((t) => ({
    tittel: t.tittel,
    kilde: t.kilde,
    utdrag: t.tekst.slice(0, 400),
    poeng: t.poeng,
  }));
  const context =
    "\n\n[KUNNSKAPSBASE – bruk dette hvis det er relevant, og vis til kilde med [1], [2] osv.]\n" +
    treff
      .map((t, i) => `[${i + 1}] ${t.tittel}${t.kilde ? ` (${t.kilde})` : ""}\n${t.tekst}`)
      .join("\n\n");
  return { context, sources };
}
