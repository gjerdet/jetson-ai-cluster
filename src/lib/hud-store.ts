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

export type IntegrationKind =
  | "truenas"
  | "unifi-network"
  | "unifi-protect"
  | "proxmox"
  | "homey"
  | "custom";

export type Integration = {
  id: string;
  name: string;
  kind: IntegrationKind;
  baseUrl: string;
  token?: string;
  username?: string;
  notes?: string;
  enabled: boolean;
};

export const INTEGRATION_PRESETS: {
  kind: IntegrationKind;
  name: string;
  baseUrl: string;
  hint: string;
}[] = [
  {
    kind: "truenas",
    name: "TrueNAS Scale",
    baseUrl: "http://truenas.local/api/v2.0",
    hint: "API-nøkkel lages i TrueNAS under Credentials → API Keys.",
  },
  {
    kind: "unifi-network",
    name: "UniFi Network",
    baseUrl: "https://unifi.local/proxy/network/api",
    hint: "Bruk lokal API-nøkkel fra UniFi OS (Settings → Control Plane → Integrations).",
  },
  {
    kind: "unifi-protect",
    name: "UniFi Protect",
    baseUrl: "https://unifi.local/proxy/protect/api",
    hint: "Samme UniFi OS-nøkkel; gir kameraliste, snapshots og hendelser.",
  },
  {
    kind: "proxmox",
    name: "Proxmox VE",
    baseUrl: "https://proxmox.local:8006/api2/json",
    hint: "Bruk API-token: PVEAPIToken=bruker@pam!tokenid=hemmelighet.",
  },
  {
    kind: "homey",
    name: "Homey",
    baseUrl: "http://homey.local/api/manager",
    hint: "Personlig adgangstoken fra my.homey.app.",
  },
  {
    kind: "custom",
    name: "Egendefinert",
    baseUrl: "http://enhet.local/api",
    hint: "Fritt HTTP-endepunkt med Bearer-token.",
  },
];

export type MemoryItem = {
  id: string;
  text: string;
  tag: string;
  pinned: boolean;
  created: string;
};

export type DeviceKind = "esp32" | "esp8266" | "esp32-cam" | "raspberrypi" | "sensor" | "annet";

export const DEVICE_KIND_LABEL: Record<DeviceKind, string> = {
  esp32: "ESP32",
  esp8266: "ESP8266",
  "esp32-cam": "ESP32-CAM",
  raspberrypi: "Raspberry Pi",
  sensor: "Sensor",
  annet: "Annet",
};

export type Device = {
  id: string;
  name: string;
  kind: DeviceKind;
  room: string;
  host: string;
  protocol: "http" | "mqtt" | "websocket";
  topic?: string;
  capabilities: string;
  firmware: string;
  notes?: string;
  enabled: boolean;
};

/** MQTT-bro (WebSocket) mot lokal broker, f.eks. Mosquitto på Jetson. */
export type MqttConfig = {
  url: string;
  username: string;
  password: string;
  baseTopic: string;
  autoConnect: boolean;
};

export const defaultMqtt: MqttConfig = {
  url: "ws://192.168.1.50:9001",
  username: "",
  password: "",
  baseTopic: "hjem/#",
  autoConnect: false,
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
  integrations: Integration[];
  memories: MemoryItem[];
  devices: Device[];
  mqtt: MqttConfig;
};

const STORAGE_KEY = "hud.config.v1";

export const defaultConfig: HudConfig = {
  callsign: "JARVIS",
  collaboration: false,
  persona: "Du er et presist, kortfattet operativsystem-assistent. Svar på norsk bokmål.",
  temperature: 0.7,
  transparency: 5,
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
  integrations: [],
  memories: [],
  devices: [],
  mqtt: defaultMqtt,
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

export function newIntegration(kind: IntegrationKind = "custom"): Integration {
  const preset = INTEGRATION_PRESETS.find((p) => p.kind === kind);
  return {
    id: `i-${Math.random().toString(36).slice(2, 8)}`,
    name: preset?.name ?? "Ny kobling",
    kind,
    baseUrl: preset?.baseUrl ?? "",
    enabled: false,
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

export function newMemory(text = ""): MemoryItem {
  return {
    id: `m-${Math.random().toString(36).slice(2, 8)}`,
    text,
    tag: "generelt",
    pinned: false,
    created: new Date().toISOString(),
  };
}

export function newDevice(kind: DeviceKind = "esp32"): Device {
  return {
    id: `d-${Math.random().toString(36).slice(2, 8)}`,
    name: "NY ENHET",
    kind,
    room: "",
    host: kind === "raspberrypi" ? "raspberrypi.local" : "esp32.local",
    protocol: kind === "raspberrypi" ? "http" : "mqtt",
    topic: kind === "raspberrypi" ? "" : "hjem/ny-enhet",
    capabilities: "",
    firmware: kind === "raspberrypi" ? "" : "ESPHome",
    enabled: true,
  };
}

/** Kompakt enhetsoversikt til systemprompten. */
export function deviceBrief(config: HudConfig): string {
  const devices = (config.devices ?? []).filter((d) => d.enabled);
  if (!devices.length) return "";
  return devices
    .map(
      (d) =>
        `- ${d.name} (${DEVICE_KIND_LABEL[d.kind]})${d.room ? ` i ${d.room}` : ""} · ${d.protocol} @ ${d.host}${d.topic ? ` · emne ${d.topic}` : ""}${d.firmware ? ` · ${d.firmware}` : ""}${d.capabilities ? ` · kan: ${d.capabilities}` : ""}`,
    )
    .join("\n");
}

export function systemPrompt(config: HudConfig): string {
  const talents = config.talents.filter((t) => t.enabled && t.prompt.trim());
  const integrations = (config.integrations ?? []).filter((i) => i.enabled);
  const memories = (config.memories ?? []).filter((m) => m.text.trim());
  const devices = deviceBrief(config);
  return [
    config.persona,
    ...talents.map((t) => `Evne – ${t.name}: ${t.prompt}`),
    memories.length
      ? `Langtidsminne om brukeren og systemet (bruk aktivt):\n${memories
          .map((m) => `- [${m.tag}]${m.pinned ? " (viktig)" : ""} ${m.text}`)
          .join("\n")}`
      : "",
    integrations.length
      ? `Tilkoblede systemer du kan referere til: ${integrations
          .map((i) => `${i.name} (${i.kind} @ ${i.baseUrl})`)
          .join(", ")}.`
      : "",
    devices
      ? `Smarthus-enheter registrert i systemet:\n${devices}\nDu er også oppsettassistent for nye ESP32/ESP8266/Raspberry Pi-enheter: når brukeren vil sette opp en ny enhet, still korte spørsmål om rom, sensorer/aktuatorer og protokoll, og lever deretter komplett, kjørbar konfigurasjon (ESPHome YAML eller Arduino/PlatformIO-kode) med MQTT-emner som følger samme navnemønster som eksisterende enheter.`
      : "Du er også oppsettassistent for ESP32/ESP8266/Raspberry Pi i smarthuset: lever komplett ESPHome YAML eller Arduino-kode med tydelige MQTT-emner når brukeren ber om ny enhet.",
    "Du har tilgang til et World Monitor-situasjonsbilde. Når brukeren spør om nyheter, hendelser eller «topp 10», får du et datauttrekk i meldingen – bruk kun det, og ranger etter alvorlighet med kilde og tidspunkt.",
  ]
    .filter(Boolean)
    .join("\n");
}
