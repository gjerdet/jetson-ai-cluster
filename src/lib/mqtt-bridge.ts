import { useSyncExternalStore } from "react";
import type { MqttClient } from "mqtt";
import type { Device, MqttConfig } from "./hud-store";

export type MqttStatus = "off" | "connecting" | "online" | "error";

export type TopicState = { topic: string; value: string; time: number };
export type LogLine = { id: string; dir: "in" | "out" | "sys"; text: string; time: number };

type State = {
  status: MqttStatus;
  error: string;
  topics: Record<string, TopicState>;
  log: LogLine[];
};

let state: State = { status: "off", error: "", topics: {}, log: [] };
let client: MqttClient | null = null;
const subs = new Set<() => void>();

const emit = () => subs.forEach((f) => f());
const set = (p: Partial<State>) => {
  state = { ...state, ...p };
  emit();
};

const log = (dir: LogLine["dir"], text: string) =>
  set({
    log: [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, dir, text, time: Date.now() },
      ...state.log,
    ].slice(0, 120),
  });

export function useMqtt(): State {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => state,
    () => state,
  );
}

/** Alle emner brannmuren skal lytte på: base + hvert enhetsemne. */
export function deviceTopics(devices: Device[], base: string): string[] {
  const list = devices
    .filter((d) => d.enabled && d.protocol === "mqtt" && d.topic?.trim())
    .map((d) => `${d.topic!.trim().replace(/\/#$/, "")}/#`);
  if (base.trim()) list.push(base.trim());
  return [...new Set(list)];
}

export async function connectMqtt(cfg: MqttConfig, devices: Device[]) {
  disconnectMqtt();
  if (!cfg.url.trim()) {
    set({ status: "error", error: "Mangler broker-URL" });
    return;
  }
  set({ status: "connecting", error: "" });
  try {
    const mqtt = (await import("mqtt")).default;
    const c = mqtt.connect(cfg.url.trim(), {
      username: cfg.username || undefined,
      password: cfg.password || undefined,
      clientId: `jarvis-hud-${Math.random().toString(16).slice(2, 8)}`,
      reconnectPeriod: 4000,
      connectTimeout: 8000,
      clean: true,
    });
    client = c;

    c.on("connect", () => {
      set({ status: "online", error: "" });
      const topics = deviceTopics(devices, cfg.baseTopic);
      if (topics.length) c.subscribe(topics, { qos: 0 });
      log("sys", `Tilkoblet ${cfg.url} · abonnerer på ${topics.join(", ") || "ingenting"}`);
    });
    c.on("reconnect", () => set({ status: "connecting" }));
    c.on("close", () => set({ status: state.status === "error" ? "error" : "off" }));
    c.on("error", (err: Error) => {
      set({ status: "error", error: err.message });
      log("sys", `Feil: ${err.message}`);
    });
    c.on("message", (topic: string, payload: Uint8Array) => {
      const value = new TextDecoder().decode(payload).slice(0, 400);
      set({ topics: { ...state.topics, [topic]: { topic, value, time: Date.now() } } });
      log("in", `${topic} → ${value}`);
    });
  } catch (err) {
    set({ status: "error", error: err instanceof Error ? err.message : "Ukjent feil" });
  }
}

export function disconnectMqtt() {
  if (client) {
    client.end(true);
    client = null;
  }
  set({ status: "off" });
}

export function publishMqtt(topic: string, payload: string) {
  if (!client || state.status !== "online") return false;
  client.publish(topic, payload, { qos: 0 });
  log("out", `${topic} ← ${payload}`);
  return true;
}

/** Kompakt sanntidsstatus til systemprompten/AI-en. */
export function mqttBrief(): string {
  const rows = Object.values(state.topics)
    .sort((a, b) => b.time - a.time)
    .slice(0, 40)
    .map((t) => `- ${t.topic} = ${t.value} (${new Date(t.time).toLocaleTimeString("nb-NO")})`);
  if (!rows.length) return "";
  return `Sanntidsdata fra MQTT-broker:\n${rows.join("\n")}`;
}
