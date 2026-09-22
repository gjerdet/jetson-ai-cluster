import { describe, expect, it } from "vitest";
import { requiresFreshLocalEvidence } from "./agent-policy";
import { redningsKall, krevesFerskeData, nettstedIMelding, korrigerVerktoyvalg } from "./agent-tools";

describe("agentens evidensport", () => {
  it("krever måling for spørsmål om den lokale installasjonen", () => {
    expect(requiresFreshLocalEvidence("hvilken hardware kjører du på?")).toBe(true);
    expect(requiresFreshLocalEvidence("hva er temperaturen på noden?")).toBe(true);
    expect(requiresFreshLocalEvidence("hvilke tjenester kjører lokalt?")).toBe(true);
    expect(requiresFreshLocalEvidence("hvor mye minne har jetson?", ["JETSON"])).toBe(true);
    expect(requiresFreshLocalEvidence("hva slags maskin er dette?")).toBe(true);
    expect(requiresFreshLocalEvidence("vis spesifikasjonene til denne enheten")).toBe(true);
  });

  it("krever ikke lokale verktøy for generell kunnskap", () => {
    expect(requiresFreshLocalEvidence("hva er en GPU? ")).toBe(false);
    expect(requiresFreshLocalEvidence("skriv et Python-eksempel")).toBe(false);
    expect(requiresFreshLocalEvidence("hvor mange bor i Oslo?")).toBe(false);
  });
});
describe("værspørsmål med små bokstaver", () => {
  it("finner stedet og velger værverktøyet", () => {
    const k = redningsKall("kommer det mer regn i åsmarka i dag?");
    expect(k?.name).toBe("vaer");
    expect((k?.args as { sted: string }).sted.toLowerCase()).toBe("åsmarka");
  });
  it("krever ferske data for værspørsmål", () => {
    expect(krevesFerskeData("kommer det mer regn i åsmarka i dag?")).toBe(true);
    expect(krevesFerskeData("hva er 2 + 2")).toBe(false);
  });
  it("sender hele spørsmålet med når et nettsted skal leses", () => {
    const k = redningsKall("hva er nyeste nyheten hos fjuken.no?");
    expect(k?.name).toBe("les_url");
    expect(k?.args).toMatchObject({ url: "https://fjuken.no", sporsmal: "hva er nyeste nyheten hos fjuken.no?" });
  });
});

describe("navn uten toppdomene", () => {
  it("tolker «siste nyhet fra fjuken» som fjuken.no", () => {
    expect(nettstedIMelding("siste nyhet fra fjuken")).toBe("https://fjuken.no");
    expect(redningsKall("siste nyhet fra fjuken")?.name).toBe("les_url");
  });

  it("ruter nettverksverktøy til nettsidelesing i nyhetsspørsmål", () => {
    const kall = korrigerVerktoyvalg(
      [{ name: "nett_sjekk", args: {}, raw: "" }, { name: "nett_skann", args: {}, raw: "" }],
      "siste nyhet fra fjuken",
    );
    expect(kall).toHaveLength(1);
    expect(kall[0]?.name).toBe("les_url");
  });
});
