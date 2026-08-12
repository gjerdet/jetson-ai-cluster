import { describe, expect, it } from "vitest";
import { klassifiser, nodeKlasse, velgRute } from "./model-router";
import { defaultConfig, type HudConfig, type ModelNode } from "./hud-store";

const lokal: ModelNode = {
  id: "n1",
  name: "JETSON-01",
  baseUrl: "http://192.168.1.50:11434/v1",
  model: "llama3.2:3b",
  role: "primary",
  enabled: true,
};
const sky: ModelNode = {
  id: "n2",
  name: "OPENROUTER",
  baseUrl: "https://openrouter.ai/api/v1",
  model: "meta-llama/llama-3.1-70b",
  apiKey: "sk-x",
  role: "worker",
  enabled: true,
};

const cfg: HudConfig = { ...defaultConfig, nodes: [lokal, sky] };

describe("modell-ruting", () => {
  it("kjenner igjen lokal og tung node", () => {
    expect(nodeKlasse(lokal)).toBe("lokal");
    expect(nodeKlasse(sky)).toBe("tung");
  });

  it("småprat blir lett", () => {
    expect(klassifiser("hei").vekt).toBe("lett");
  });

  it("kode og nettverksoppdrag blir tungt", () => {
    expect(klassifiser("skann nettet mitt og list enheter").vekt).toBe("tung");
    expect(klassifiser("```py\nprint(1)\n```").vekt).toBe("tung");
  });

  it("ruter tungt til skynode og lett til lokal", () => {
    expect(velgRute(cfg, "feilsøk docker-containeren min").node?.id).toBe("n2");
    expect(velgRute(cfg, "hei").node?.id).toBe("n1");
  });

  it("låst node overstyrer alt", () => {
    const r = velgRute({ ...cfg, aiNodeId: "n1" }, "skriv et python-skript");
    expect(r.node?.id).toBe("n1");
  });

  it("autoRoute av bruker primærnode", () => {
    const r = velgRute({ ...cfg, autoRoute: false }, "skriv et python-skript");
    expect(r.node?.id).toBe("n1");
  });
});
