import { describe, expect, it } from "vitest";
import { erApiRute } from "./api.mjs";

describe("backend-ruting", () => {
  it("sender auth-ruter uten /api-prefiks til backend-API-et", () => {
    expect(erApiRute("/auth/login")).toBe(true);
    expect(erApiRute("/auth/register")).toBe(true);
    expect(erApiRute("/auth/me")).toBe(true);
  });

  it("beholder støtte for auth-ruter med /api-prefiks", () => {
    expect(erApiRute("/api/auth/login")).toBe(true);
  });

  it("sender ikke vanlige GUI-ruter til backend-API-et", () => {
    expect(erApiRute("/logg-inn")).toBe(false);
  });
});