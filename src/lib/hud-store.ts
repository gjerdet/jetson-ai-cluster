import { useCallback, useEffect, useState } from "react";

export type ModelNode = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  role: "primary" | "worker" | "observer";
  enabled: boolean;
};

export type HudConfig = {
  nodes: ModelNode[];
  collaboration: boolean;
  callsign: string;
};

const STORAGE_KEY = "hud.config.v1";

export const defaultConfig: HudConfig = {
  callsign: "JARVIS",
  collaboration: false,
  nodes: [
    {
      id: "node-1",
      name: "JETSON-01",
      baseUrl: "http://192.168.1.50:11434/v1",
      model: "llama3.2",
      role: "primary",
      enabled: true,
    },
    {
      id: "node-2",
      name: "HERMES",
      baseUrl: "http://192.168.1.51:11434/v1",
      model: "hermes3",
      role: "worker",
      enabled: false,
    },
  ],
};

export function useHudConfig() {
  const [config, setConfig] = useState<HudConfig>(defaultConfig);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setConfig({ ...defaultConfig, ...(JSON.parse(raw) as HudConfig) });
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);

  const update = useCallback((next: HudConfig) => {
    setConfig(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  return { config, update, loaded };
}

export function newNode(): ModelNode {
  return {
    id: `node-${Math.random().toString(36).slice(2, 8)}`,
    name: "NY NODE",
    baseUrl: "http://192.168.1.60:11434/v1",
    model: "llama3.2",
    role: "worker",
    enabled: true,
  };
}
