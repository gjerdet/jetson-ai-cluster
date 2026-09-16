import { describe, expect, it } from "vitest";
import { overskrifterFraHtml, rssSaker, strukturerteSakerFraHtml } from "./laering.mjs";

describe("robust nettsideuttrekk", () => {
  it("prioriterer artikkeloverskrifter og lenker", () => {
    const html = '<nav><a href="/meny">Meny</a></nav><main><h2><a href="/sak/1">Dette er dagens viktigste lokale nyhet</a></h2></main>';
    expect(overskrifterFraHtml(html, "https://avis.no")[0]).toEqual({
      tittel: "Dette er dagens viktigste lokale nyhet",
      url: "https://avis.no/sak/1",
    });
  });

  it("leser nyhetssaker fra JSON-LD på JavaScript-sider", () => {
    const html = '<script type="application/ld+json">{"@type":"NewsArticle","headline":"Kommunen åpner den nye skolen i dag","url":"/nyheter/skole","datePublished":"2026-09-16T10:00:00+02:00"}</script>';
    expect(strukturerteSakerFraHtml(html, "https://avis.no")[0]).toMatchObject({
      tittel: "Kommunen åpner den nye skolen i dag",
      url: "https://avis.no/nyheter/skole",
      publisert: "2026-09-16T10:00:00+02:00",
    });
  });

  it("bruker RSS som reservekilde med dato", () => {
    const xml = '<rss><channel><item><title><![CDATA[Ny bru er åpnet for trafikk]]></title><link>https://avis.no/bru</link><pubDate>Wed, 16 Sep 2026 09:00:00 GMT</pubDate></item></channel></rss>';
    expect(rssSaker(xml)[0]).toMatchObject({
      tittel: "Ny bru er åpnet for trafikk",
      url: "https://avis.no/bru",
      publisert: "Wed, 16 Sep 2026 09:00:00 GMT",
    });
  });
});