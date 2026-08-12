import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendError, backend, backendToken, setBackendToken, setBackendUrl, safe, standardBackendUrl } from "@/lib/backend";
import { DEFAULTS, ERROR_CODES } from "@/lib/contract";

/** Enkel fetch-mock som svarer med gitt status/kropp. */
function mockFetch(svar: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  const kall: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    kall.push({ url, init });
    const s = svar[Math.min(kall.length - 1, svar.length - 1)]!;
    return new Response(JSON.stringify(s.body), { status: s.status, headers: s.headers ?? {} });
  });
  vi.stubGlobal("fetch", fn);
  return kall;
}

const store = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};

beforeEach(() => {
  vi.stubGlobal("localStorage", store());
  vi.stubGlobal("sessionStorage", store());
  setBackendToken(null);
  setBackendUrl("http://127.0.0.1:8787");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("backend-klient", () => {
  it("lagrer token i sessionStorage, ikke localStorage", async () => {
    mockFetch([{ status: 200, body: { token: "abc123", user: { id: "1", email: "a@b.no", role: "admin" } } }]);
    await backend.login("a@b.no", "hemmelig123");
    expect(sessionStorage.getItem("jarvis.backend.token")).toBe("abc123");
    expect(localStorage.getItem("jarvis.backend.token")).toBeNull();
    expect(backendToken()).toBe("abc123");
  });

  it("sender med bearer-token", async () => {
    setBackendToken("tok");
    const kall = mockFetch([{ status: 200, body: { user: { id: "1", email: "a@b.no", role: "admin" } } }]);
    await backend.me();
    expect((kall[0]!.init.headers as Record<string, string>)["authorization"]).toBe("Bearer tok");
  });

  it("logger ut lokalt ved 401", async () => {
    setBackendToken("tok");
    mockFetch([{ status: 401, body: { error: "Ikke innlogget" } }]);
    const { error } = await safe(() => backend.me());
    expect(error?.code).toBe(ERROR_CODES.UNAUTHORIZED);
    expect(backendToken()).toBeNull();
  });

  it("tolker 429 som rate-limit, prøver igjen og leser Retry-After", async () => {
    // retry-after 1 s holder testen rask; klienten prøver på nytt før den gir opp.
    const kall = mockFetch([
      { status: 429, body: { error: "For mange forespørsler." }, headers: { "retry-after": "1" } },
    ]);
    const { error } = await safe(() => backend.hentRegler());
    expect(error).toBeInstanceOf(BackendError);
    expect(error?.code).toBe(ERROR_CODES.RATE_LIMIT);
    expect(error?.retryAfter).toBe(1);
    expect(error?.raad).toContain("1 sekunder");
    expect(kall.length).toBeGreaterThan(1);
  }, 15_000);

  it("gir nettverksfeil med råd når agenten er nede", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const { error } = await safe(() => backend.status());
    expect(error?.code).toBe(ERROR_CODES.NETWORK);
    expect(error?.raad).toContain("127.0.0.1:8787");
  });

  it("henter og lagrer AI-config uten å eksponere nøkkelen", async () => {
    const kall = mockFetch([
      { status: 200, body: { baseUrl: "http://x/v1", model: "m", system: "", harNokkel: true, nokkelMaske: "sk-…4f2a" } },
    ]);
    const cfg = await backend.hentAi();
    expect(cfg.harNokkel).toBe(true);
    expect(cfg.apiKey).toBeUndefined();
    expect(kall[0]!.url).toContain("/api/ai");
  });

  it("sender faktisk chat til POST /api/ai/chat", async () => {
    setBackendToken("tok");
    const kall = mockFetch([
      { status: 200, body: { svar: "Hei", model: "hermes3:8b", node: "http://node2:11434/v1" } },
    ]);
    const svar = await backend.aiChat([{ role: "user", content: "Hei" }]);
    expect(svar.svar).toBe("Hei");
    expect(kall[0]!.url).toBe("http://127.0.0.1:8787/api/ai/chat");
    expect(kall[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(kall[0]!.init.body))).toEqual({
      meldinger: [{ role: "user", content: "Hei" }],
    });
  });
});

describe("standard backend-adresse", () => {
  it("bruker vertsnavnet i nettverket i stedet for loopback", () => {
    expect(standardBackendUrl({ hostname: "192.168.1.42", protocol: "http:" })).toBe(
      `http://192.168.1.42:${DEFAULTS.port}`,
    );
    expect(standardBackendUrl({ hostname: "jarvis.local", protocol: "https:" })).toBe(
      `https://jarvis.local:${DEFAULTS.port}`,
    );
  });

  it("faller tilbake til loopback lokalt og i Lovable-forhåndsvisning", () => {
    expect(standardBackendUrl({ hostname: "localhost", protocol: "http:" })).toBe(
      `http://127.0.0.1:${DEFAULTS.port}`,
    );
    expect(standardBackendUrl({ hostname: "id-preview--abc.lovable.app", protocol: "https:" })).toBe(
      `http://127.0.0.1:${DEFAULTS.port}`,
    );
  });
});
