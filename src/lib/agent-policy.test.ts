import { describe, expect, it } from "vitest";
import { requiresFreshLocalEvidence } from "./agent-policy";
import { redningsKall, krevesFerskeData } from "./agent-tools";

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
});
