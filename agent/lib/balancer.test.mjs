import { describe, expect, it, beforeEach } from "vitest";
import { kjorBalansert, poolFor, poolStatus, resetBalancer, rutingsRekkefolge, settRessurser, ressursfaktor } from "./balancer.mjs";
import { vurderSnapshot } from "./klynge.mjs";

const node = (id, extra = {}) => ({
  id,
  navn: id,
  baseUrl: `http://${id}:11434/v1`,
  oppgaver: ["chat"],
  aktiv: true,
  vekt: 1,
  ...extra,
});

describe("lastbalansering", () => {
  beforeEach(() => resetBalancer());

  it("tar bare med aktive noder med riktig oppgave", () => {
    const liste = [node("a"), node("b", { aktiv: false }), node("c", { oppgaver: ["evaluator"] })];
    expect(poolFor(liste, "chat").map((n) => n.id)).toEqual(["a"]);
  });

  it("fordeler videre til neste node når en node feiler", async () => {
    const liste = [node("a"), node("b")];
    const brukt = [];
    const r = await kjorBalansert(liste, async (n) => {
      brukt.push(n.id);
      if (brukt.length === 1) throw new Error("nede");
      return "ok";
    });
    expect(r.resultat).toBe("ok");
    expect(brukt).toHaveLength(2);
    // Den feilende noden settes i karantene og havner bakerst.
    expect(rutingsRekkefolge(liste)[0].id).toBe(brukt[1]);
  });

  it("rapporterer poolstatus med karantene", async () => {
    const liste = [node("a")];
    await expect(
      kjorBalansert(liste, async () => {
        throw new Error("nede");
      }),
    ).rejects.toThrow();
    const status = poolStatus(liste);
    expect(status.antall).toBe(1);
    expect(status.noder[0].karantene).toBe(true);
    expect(status.noder[0].sisteFeil).toBe("nede");
  });
});

describe("adaptiv ruting på GPU og helse", () => {
  const expect2 = (a, b) => expect(a).toBe(b);
  const expectOk = (a) => expect(a).toBe(true);
it("adaptiv ruting: noden med mest ledig GPU velges først", () => {
  resetBalancer();
  const noder = [
    { id: "a", navn: "A", baseUrl: "http://a", vekt: 1 },
    { id: "b", navn: "B", baseUrl: "http://b", vekt: 1 },
  ];
  settRessurser("a", { frittProsent: 10, utnyttelse: 90, niva: "advarsel", sjekket: Date.now() });
  settRessurser("b", { frittProsent: 85, utnyttelse: 5, niva: "ok", sjekket: Date.now() });
  expect2(rutingsRekkefolge(noder)[0].id, "b");
  expectOk(ressursfaktor("b") > ressursfaktor("a"));
});

it("syk node nedprioriteres selv med høy vekt", () => {
  resetBalancer();
  const noder = [
    { id: "syk", navn: "Syk", baseUrl: "http://s", vekt: 10 },
    { id: "frisk", navn: "Frisk", baseUrl: "http://f", vekt: 1 },
  ];
  settRessurser("syk", { frittProsent: 50, utnyttelse: 10, niva: "feil", sjekket: Date.now() });
  settRessurser("frisk", { frittProsent: 60, utnyttelse: 10, niva: "ok", sjekket: Date.now() });
  expect2(ressursfaktor("syk"), 0.3);
  expectOk(rutingsRekkefolge(noder).map((n) => n.id).includes("frisk"));
});

it("vurderSnapshot flagger lite GPU-minne og død tjeneste", () => {
  const v = vurderSnapshot({
    gpu: { totalMb: 8000, frittMb: 400, utnyttelse: 99, tempC: 60 },
    tjenester: [{ navn: "ollama", status: "inactive" }],
    modeller: { ok: true, modeller: [{ navn: "llama3.2:3b" }], lastet: [] },
  });
  expect2(v.niva, "feil");
  expectOk(v.varsler.some((x) => x.includes("GPU-minne")));
});
});
