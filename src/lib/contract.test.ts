import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  ERROR_TEXTS,
  ROUTES,
  buildPersonalityPrompt,
  codeFromStatus,
  validateCredentials,
  validateRule,
} from "@/lib/contract";


describe("kontrakt", () => {
  it("mapper HTTP-status til feilkoder", () => {
    expect(codeFromStatus(401)).toBe(ERROR_CODES.UNAUTHORIZED);
    expect(codeFromStatus(403)).toBe(ERROR_CODES.FORBIDDEN);
    expect(codeFromStatus(404)).toBe(ERROR_CODES.NOT_FOUND);
    expect(codeFromStatus(422)).toBe(ERROR_CODES.VALIDATION);
    expect(codeFromStatus(429)).toBe(ERROR_CODES.RATE_LIMIT);
    expect(codeFromStatus(503)).toBe(ERROR_CODES.UNAVAILABLE);
    expect(codeFromStatus(500)).toBe(ERROR_CODES.SERVER);
  });

  it("har norsk tekst for hver feilkode", () => {
    for (const code of Object.values(ERROR_CODES)) {
      expect(ERROR_TEXTS[code]).toBeTruthy();
    }
  });

  it("kjenner backup-ruta", () => {
    expect(ROUTES.backup).toBe("/backup");
  });

  it("validerer innlogging", () => {
    expect(validateCredentials("Test@Eksempel.NO", "hemmelig123")).toEqual({
      email: "test@eksempel.no",
      password: "hemmelig123",
    });
    expect(() => validateCredentials("ikke-epost", "hemmelig123")).toThrow();
    expect(() => validateCredentials("test@eksempel.no", "kort")).toThrow();
  });

  it("normaliserer regler og avviser ugyldige", () => {
    const r = validateRule({
      navn: "Kaldt",
      emne: "hus/stue/temp",
      operator: "under",
      verdi: 18,
      handlinger: [{ type: "telegram", tekst: "kaldt" }],
    });
    expect(r.emne).toBe("hus/stue/temp");
    expect(r.aktiv).toBe(true);
    expect(() => validateRule({ navn: "", emne: "a" })).toThrow();
    expect(() => validateRule({ navn: "X", emne: "a", operator: "over", verdi: "abc" })).toThrow();
  });

  it("bygger personlighetsprompt", () => {
    const p = {
      name: "JARVIS",
      role: "AI-butler",
      tone: "formell" as const,
      verbosity: "balansert" as const,
      language: "norsk bokmål",
      quirks: "presis\ntørr",
      catchphrase: "Værsågod, sir.",
      background: "Lokal assistent.",
      extra: "Start med det viktigste.",
    };
    const prompt = buildPersonalityPrompt(p);
    expect(prompt).toContain("Du er JARVIS, AI-butler.");
    expect(prompt).toContain("Tone: formell.");
    expect(prompt).toContain("Særtrekk:");
    expect(prompt).toContain("Værsågod, sir.");
    expect(buildPersonalityPrompt(undefined)).toBe("");
  });
});

