import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isEncrypted, maskSecret } from "./secrets.mjs";

describe("hemmeligheter", () => {
  it("krypterer og dekrypterer fram og tilbake", () => {
    const kryptert = encryptSecret("sk-hemmelig-nokkel-1234");
    expect(isEncrypted(kryptert)).toBe(true);
    expect(kryptert).not.toContain("hemmelig");
    expect(decryptSecret(kryptert)).toBe("sk-hemmelig-nokkel-1234");
  });

  it("gir ulik chiffertekst hver gang (tilfeldig IV)", () => {
    expect(encryptSecret("samme")).not.toBe(encryptSecret("samme"));
  });

  it("lar klartekst passere uendret (bakoverkompatibelt)", () => {
    expect(decryptSecret("gammel-klartekst")).toBe("gammel-klartekst");
    expect(decryptSecret("")).toBe("");
  });

  it("maskerer slik at nøkkelen ikke kan gjenskapes", () => {
    const maske = maskSecret(encryptSecret("sk-abcdefghijklmnop"));
    expect(maske).not.toContain("abcdefghij");
    expect(maske.length).toBeLessThan(20);
  });
});
