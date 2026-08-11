import { useMemo, useState } from "react";
import { Activity, Gauge, Send } from "lucide-react";
import type { Device } from "@/lib/hud-store";
import { commandsFor, historyTopics, sendCommand, useMqtt } from "@/lib/mqtt-bridge";
import { Sparkline } from "./Sparkline";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function DeviceDetailDialog({ device, onClose }: { device: Device | null; onClose: () => void }) {
  const { topics, history, status } = useMqtt();
  const [value, setValue] = useState("50");
  const base = (device?.topic ?? "").replace(/\/#$/, "");
  const states = useMemo(
    () => Object.values(topics).filter((t) => base && (t.topic === base || t.topic.startsWith(`${base}/`))).sort((a, b) => b.time - a.time),
    [topics, base],
  );
  const chartTopics = device ? historyTopics(device.topic ?? "") : [];
  const commands = commandsFor(device?.capabilities ?? "");
  return (
    <Dialog open={Boolean(device)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="hud-panel max-h-[85vh] max-w-2xl overflow-auto border-primary/30 bg-background/80">
        <DialogHeader>
          <DialogTitle className="hud-title text-sm text-primary">{device?.name ?? "ENHET"}</DialogTitle>
          <DialogDescription>{device?.room || "Uten plassering"} · {device?.topic || device?.host}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <section className="space-y-2">
            <p className="hud-title flex items-center gap-2 text-[9px] text-muted-foreground"><Gauge className="size-3" /> SISTE VERDIER</p>
            {states.length ? states.slice(0, 12).map((s) => <div key={s.topic} className="flex justify-between border-b border-primary/10 py-1 text-xs"><span className="truncate text-muted-foreground">{s.topic}</span><span className="ml-2 text-primary">{s.value}</span></div>) : <p className="text-xs text-muted-foreground">Ingen mottatte verdier.</p>}
          </section>
          <section className="space-y-2">
            <p className="hud-title flex items-center gap-2 text-[9px] text-muted-foreground"><Activity className="size-3" /> HISTORIKK 24T</p>
            {chartTopics.length ? chartTopics.slice(0, 4).map((topic) => <div key={topic}><p className="truncate text-[10px] text-muted-foreground">{topic}</p><Sparkline data={history[topic] ?? []} height={52} /></div>) : <p className="text-xs text-muted-foreground">Ingen numerisk historikk ennå.</p>}
          </section>
        </div>
        <section className="space-y-2 border-t border-primary/15 pt-3">
          <p className="hud-title text-[9px] text-muted-foreground">DIREKTE KONTROLLER</p>
          <div className="flex flex-wrap items-center gap-2">
            {commands.includes("switch") ? ["ON", "OFF", "toggle"].map((v) => <Button key={v} size="sm" variant="outline" disabled={!base || status !== "online"} onClick={() => sendCommand(base, "switch", v)}>{v}</Button>) : null}
            {commands.some((c) => c === "dim" || c === "fan" || c === "threshold") ? <><input value={value} onChange={(e) => setValue(e.target.value)} className="hud-input h-8 w-24" aria-label="Kommandoverdi" />{commands.filter((c) => c !== "switch").map((c) => <Button key={c} size="sm" variant="outline" disabled={!base || status !== "online"} onClick={() => sendCommand(base, c, value)}><Send className="size-3" /> {c}</Button>)}</> : null}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}