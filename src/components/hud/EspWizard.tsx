import { useMemo, useState } from "react";
import { CircuitBoard, Plus, Trash2, WandSparkles } from "lucide-react";
import { newDevice, type Device, type HudConfig } from "@/lib/hud-store";
import { Button } from "@/components/ui/button";

type Part = { id: string; name: string; purpose: string; pin: string };

function suggest(goal: string): Part[] {
  const q = goal.toLowerCase();
  const parts: Part[] = [{ id: "board", name: "ESP32 DevKit", purpose: "Kontroller med Wi‑Fi", pin: "USB / 5V" }];
  if (/temp|temperatur|fukt/.test(q)) parts.push({ id: "temp", name: q.includes("fukt") ? "BME280" : "DS18B20", purpose: q.includes("fukt") ? "Temperatur, fukt og trykk" : "Temperaturmåling", pin: q.includes("fukt") ? "SDA 21 / SCL 22" : "DATA 4 + 4,7kΩ" });
  if (/rele|relé|varme|vifte|styre/.test(q)) parts.push({ id: "relay", name: "Optoisolert relémodul", purpose: "Styrer last", pin: "IN 26" });
  parts.push({ id: "power", name: "5V strømforsyning", purpose: "Stabil strøm", pin: "5V / GND" });
  return parts;
}

function makeDocs(name: string, room: string, topic: string, goal: string, parts: Part[]) {
  const temp = parts.find((p) => p.id === "temp");
  const relay = parts.find((p) => p.id === "relay");
  const code = `esphome:\n  name: ${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}\nesp32:\n  board: esp32dev\nwifi:\n  ssid: !secret wifi_ssid\n  password: !secret wifi_password\nmqtt:\n  broker: !secret mqtt_broker\n  topic_prefix: ${topic}\nlogger:\nota:\n${temp?.name === "BME280" ? "i2c:\n  sda: GPIO21\n  scl: GPIO22\nsensor:\n  - platform: bme280_i2c\n    temperature:\n      name: Temperatur\n" : temp ? "sensor:\n  - platform: dallas_temp\n    name: Temperatur\none_wire:\n  - platform: gpio\n    pin: GPIO4\n" : ""}${relay ? "switch:\n  - platform: gpio\n    pin: GPIO26\n    name: Aktuator\n" : ""}`;
  return `# ${name}\n\n## Formål\n${goal}\n\n## Plassering\n${room || "Ikke angitt"}\n\n## Deler\n${parts.map((p) => `- ${p.name}: ${p.purpose}`).join("\n")}\n\n## Koblingsskjema\nESP32 GND ───── felles GND\n${parts.map((p) => `ESP32 ${p.pin} ───── ${p.name}`).join("\n")}\n\n## ESPHome-konfigurasjon\n\`\`\`yaml\n${code}\`\`\`\n\n## MQTT\nBasisemne: ${topic}`;
}

export function EspWizard({ config, update }: { config: HudConfig; update: (c: HudConfig) => void }) {
  const [goal, setGoal] = useState("");
  const [name, setName] = useState("Temperatursensor");
  const [room, setRoom] = useState("");
  const [topic, setTopic] = useState("hjem/rom/temperatur");
  const [parts, setParts] = useState<Part[]>([]);
  const docs = useMemo(() => parts.length ? makeDocs(name, room, topic, goal, parts) : "", [name, room, topic, goal, parts]);
  const save = () => {
    const d: Device = { ...newDevice("esp32"), name: name.toUpperCase(), room, topic, capabilities: goal, documentation: docs, notes: `Planlagt med ${parts.length} komponenter` };
    update({ ...config, devices: [...(config.devices ?? []), d] });
    setParts([]); setGoal("");
  };
  return <div className="space-y-2 rounded border border-primary/20 bg-primary/[0.02] p-3">
    <p className="hud-title flex items-center gap-2 text-[10px] text-primary"><CircuitBoard className="size-4" /> BYGG NY ESP-ENHET</p>
    <textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Beskriv hva enheten skal gjøre, f.eks. måle temperatur i teknisk rom og slå på en vifte ved 30 °C" className="hud-input min-h-16 w-full" />
    <div className="grid gap-2 md:grid-cols-3"><input value={name} onChange={(e) => setName(e.target.value)} className="hud-input" placeholder="navn" /><input value={room} onChange={(e) => setRoom(e.target.value)} className="hud-input" placeholder="rom" /><input value={topic} onChange={(e) => setTopic(e.target.value)} className="hud-input" placeholder="MQTT-basisemne" /></div>
    <Button size="sm" variant="outline" disabled={!goal.trim()} onClick={() => setParts(suggest(goal))}><WandSparkles className="size-3" /> foreslå deler</Button>
    {parts.map((p) => <div key={p.id} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1"><input value={p.name} onChange={(e) => setParts(parts.map((x) => x.id === p.id ? { ...x, name: e.target.value } : x))} className="hud-input" /><input value={p.purpose} onChange={(e) => setParts(parts.map((x) => x.id === p.id ? { ...x, purpose: e.target.value } : x))} className="hud-input" /><input value={p.pin} onChange={(e) => setParts(parts.map((x) => x.id === p.id ? { ...x, pin: e.target.value } : x))} className="hud-input" /><Button size="icon" variant="ghost" onClick={() => setParts(parts.filter((x) => x.id !== p.id))}><Trash2 className="size-3" /></Button></div>)}
    {parts.length ? <><Button size="sm" variant="ghost" onClick={() => setParts([...parts, { id: `p-${Date.now()}`, name: "Ny del", purpose: "", pin: "" }])}><Plus className="size-3" /> del</Button><details><summary className="hud-title cursor-pointer text-[9px] text-primary">FORHÅNDSVIS KODE OG KOBLING</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[10px] text-muted-foreground">{docs}</pre></details><Button size="sm" onClick={save}>lagre enhet og dokumentasjon</Button></> : null}
  </div>;
}