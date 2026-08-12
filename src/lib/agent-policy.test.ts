import { describe, expect, it } from "vitest";
import { requiresFreshLocalEvidence } from "./agent-policy";

describe("agentens evidensport", () => {
  it("krever måling for spørsmål om den lokale installasjonen", () => {
    expect(requiresFreshLocalEvidence("hvilken hardware kjører du på?")).toBe(true);
    expect(requiresFreshLocalEvidence("hva er temperaturen på noden?")).toBe(true);
    expect(requiresFreshLocalEvidence("hvilke tjenester kjører lokalt?")).toBe(true);
  });

  it("krever ikke lokale verktøy for generell kunnskap", () => {
    expect(requiresFreshLocalEvidence("hva er en GPU? ")).toBe(false);
    expect(requiresFreshLocalEvidence("skriv et Python-eksempel")).toBe(false);
    expect(requiresFreshLocalEvidence("hvor mange bor i Oslo?")).toBe(false);
  });
});