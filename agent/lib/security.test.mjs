import { describe, expect, it, beforeEach } from "vitest";
import { clientIp, corsBlocked, corsHeaders, originAllowed, rateLimit, RATE_RULES } from "./security.mjs";

const req = (headers = {}, ip = "10.0.0.1") => ({ headers, socket: { remoteAddress: ip } });

describe("CORS", () => {
  it("slipper inn localhost og lovable-domener", () => {
    expect(originAllowed("http://localhost:5173")).toBe(true);
    expect(originAllowed("https://min-app.lovable.app")).toBe(true);
  });

  it("blokkerer ukjente domener", () => {
    expect(originAllowed("https://ondsinnet.no")).toBe(false);
    expect(corsBlocked(req({ origin: "https://ondsinnet.no" }))).toBe(true);
    expect(corsHeaders(req({ origin: "https://ondsinnet.no" }))["access-control-allow-origin"]).toBeUndefined();
  });

  it("gir aldri jokertegn tilbake", () => {
    const h = corsHeaders(req({ origin: "http://localhost:5173" }));
    expect(h["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(Object.values(h)).not.toContain("*");
  });

  it("tillater kall uten origin (curl, samme maskin)", () => {
    expect(corsBlocked(req({}))).toBe(false);
  });
});

describe("rate-limiting", () => {
  let n = 0;
  beforeEach(() => n++);

  it("slipper gjennom under grensen og stopper over", () => {
    const ip = `192.168.9.${n}`;
    const grense = RATE_RULES.auth.limit;
    for (let i = 0; i < grense; i++) expect(rateLimit(req({}, ip), "auth")).toBeNull();
    const stoppet = rateLimit(req({}, ip), "auth");
    expect(stoppet).not.toBeNull();
    expect(stoppet.retryAfter).toBeGreaterThan(0);
  });

  it("holder grupper og IP-er adskilt", () => {
    const ip = `192.168.8.${n}`;
    for (let i = 0; i < RATE_RULES.auth.limit + 5; i++) rateLimit(req({}, ip), "auth");
    expect(rateLimit(req({}, ip), "api")).toBeNull();
    expect(rateLimit(req({}, `172.16.0.${n}`), "auth")).toBeNull();
  });
});

describe("klient-IP", () => {
  it("ignorerer x-forwarded-for uten AGENT_TRUST_PROXY", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4" }, "10.0.0.9"))).toBe("10.0.0.9");
  });
});
