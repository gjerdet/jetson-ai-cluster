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

export type Talent = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
  builtin?: boolean;
};

export type Plugin = {
  id: string;
  name: string;
  kind: "http" | "webhook" | "telegram";
  endpoint: string;
  enabled: boolean;
};

export type HudConfig = {
  nodes: ModelNode[];
  collaboration: boolean;
  callsign: string;
  persona: string;
  temperature: number;
  transparency: number;
  talents: Talent[];
  plugins: Plugin[];
};

const STORAGE_KEY = "hud.config.v1";

export const defaultConfig: HudConfig = {
  callsign: "JARVIS",
  collaboration: false,
  persona: "Du er et presist, kortfattet operativsystem-assistent. Svar på norsk bokmål.",
  temperature: 0.7,
  transparency: 12,
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
  talents: [
    {
      id: "t-analyse",
      name: "Analyse",
      description: "Bryter ned komplekse spørsmål i strukturerte punkter.",
      prompt: "Analyser systematisk og presenter konklusjon først, deretter punktvis begrunnelse.",
      enabled: true,
      builtin: true,
    },
    {
      id: "t-kode",
      name: "Kode",
      description: "Skriver og forklarer kode.",
      prompt: "Når det gjelder kode: gi komplette, kjørbare eksempler med korte forklaringer.",
      enabled: true,
      builtin: true,
    },
    {
      id: "t-situasjon",
      name: "Situasjonsbilde",
      description: "Tolker world monitor-data og oppsummerer risiko.",
      prompt:
        "Når du får hendelsesdata fra world monitor: oppsummer situasjonen kort og ranger etter alvorlighet.",
      enabled: false,
      builtin: true,
    },
  ],
  plugins: [
    {
      id: "p-telegram",
      name: "Telegram-bro",
      kind: "telegram",
      endpoint: "",
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

export function newTalent(): Talent {
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    name: "Ny evne",
    description: "",
    prompt: "",
    enabled: true,
  };
}

export function newPlugin(): Plugin {
  return {
    id: `p-${Math.random().toString(36).slice(2, 8)}`,
    name: "Ny plugin",
    kind: "http",
    endpoint: "",
    enabled: false,
  };
}

export function systemPrompt(config: HudConfig): string {
  const talents = config.talents.filter((t) => t.enabled && t.prompt.trim());
  return [
    config.persona,
    ...talents.map((t) => `Evne – ${t.name}: ${t.prompt}`),
  ]
    .filter(Boolean)
    .join("\n");
}
