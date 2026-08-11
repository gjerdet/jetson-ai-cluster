import { useEffect, useRef, useState } from "react";
import { SendHorizonal, Loader2, Radar, Cpu } from "lucide-react";
import { callNode, type ChatMsg } from "@/lib/hud-client";
import { deviceBrief, newMemory, systemPrompt, type HudConfig } from "@/lib/hud-store";
import {
  parseAiCommands,
  runCommands,
  MQTT_TOOL_PROMPT,
  mqttBrief,
  mqttOnline,
  useMqtt,
  type PendingCommand,
} from "@/lib/mqtt-bridge";
import { briefingText, refreshFeed, snapshot } from "@/lib/world-feed";
import { parseToolCalls, runTool, stripToolCalls, TOOL_PROMPT, toolAvailability } from "@/lib/agent-tools";
import { evaluate } from "@/lib/evaluator";
import { logSelfEvent } from "@/lib/health";

const BRIEF_TRIGGERS =
  /(topp\s*10|top\s*10|nyhet|hendels|world ?monitor|situasjonsbilde|verden|defcon|pizza|hva skjer|brief)/i;

const REMEMBER = /^\s*(husk|remember)[:\s]+(.+)$/is;

export function ChatPanel({
  config,
  update,
}: {
  config: HudConfig;
  update?: (c: HudConfig) => void;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [pending, setPending] = useState<PendingCommand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const mqtt = useMqtt();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const active = config.nodes.filter((n) => n.enabled);
  const primary = active.find((n) => n.role === "primary") ?? active[0];
  const workers = active.filter((n) => n.id !== primary?.id && n.role !== "observer");

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || busy) return;

    const rem = REMEMBER.exec(text);
    if (rem && update) {
      const fact = (rem[2] ?? "").trim();
      update({ ...config, memories: [...(config.memories ?? []), newMemory(fact)] });
      setMessages((m) => [
        ...m,
        { role: "user", content: text },
        { role: "assistant", content: `Lagret i minnet: «${fact}»`, node: "MINNE" },
      ]);
      setInput("");
      return;
    }

    if (!primary) {
      setError("Ingen aktiv node. Åpne NODER og aktiver minst én.");
      return;
    }
    setError(null);
    const next: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setStage("tenker");
    try {
      const live = mqttBrief();
      const sys = [
        systemPrompt(config),
        live,
        mqttOnline() ? MQTT_TOOL_PROMPT : "",
        TOOL_PROMPT,
        toolAvailability(config, Object.keys(mqtt.topics).length),
      ]
        .filter(Boolean)
        .join("\n");
      let context = "";
      if (BRIEF_TRIGGERS.test(text)) {
        if (!snapshot().events.length) await refreshFeed();
        context = `\n\n[WORLD MONITOR-DATA]\n${briefingText(10)}`;
      }

      const thread: ChatMsg[] = [
        ...(sys ? ([{ role: "system", content: sys }] as ChatMsg[]) : []),
        ...next.slice(0, -1),
        { role: "user", content: text + context },
      ];

      const out: ChatMsg[] = [...next];
      let answer = "";

      // verktøykall-loop: modellen kan hente ekte data før den svarer
      for (let round = 0; round < 4; round++) {
        const raw = await callNode(primary, thread);
        const calls = parseToolCalls(raw);
        if (!calls.length) {
          answer = raw.trim();
          break;
        }
        const visible = stripToolCalls(raw);
        if (visible) out.push({ role: "assistant", content: visible, node: primary.name });
        thread.push({ role: "assistant", content: raw });
        const results: string[] = [];
        for (const c of calls) {
          setStage(`verktøy: ${c.name}`);
          let res: string;
          try {
            res = await runTool(c, { config, ...(update ? { update } : {}), topics: mqtt.topics });
          } catch (e) {
            res = `Feil: ${e instanceof Error ? e.message : "ukjent"}`;
            logSelfEvent("warn", `Verktøy ${c.name} feilet`);
          }
          results.push(`[${c.name}]\n${res}`);
          out.push({ role: "assistant", content: `${c.name} → ${res.slice(0, 600)}`, node: "VERKTØY" });
        }
        thread.push({
          role: "user",
          content: `VERKTØYRESULTAT:\n${results.join("\n\n")}\n\nSvar nå brukeren basert på disse dataene.`,
        });
        setStage("tenker");
        answer = "";
      }
      if (!answer) answer = "(fikk ikke ferdig svar innen verktøygrensen)";

      out.push({ role: "assistant", content: answer, node: primary.name });

      // lar modellen styre smarthuset direkte via MQTT-linjer i svaret
      const cmds = parseAiCommands(answer);
      const needConfirm = config.confirmCommands !== false && cmds.some((c) => c.risky);
      if (needConfirm) {
        setPending(cmds);
        out.push({
          role: "assistant",
          content: `Tørrkjøring – ${cmds.length} kommando(er) venter på bekreftelse.`,
          node: "MQTT",
        });
      }
      const done = needConfirm ? [] : runCommands(cmds);
      if (done.length)
        out.push({
          role: "assistant",
          content: done
            .map((c) => `${c.ok ? "✓" : "✕"} ${c.topic} ← ${c.payload}`)
            .join("\n"),
          node: "MQTT",
        });

      if (config.collaboration && workers.length > 0) {
        setStage("evaluerer");
        const ev = await evaluate({ question: text, answer, primary, workers });
        for (const r of ev.reviews)
          out.push({
            role: "assistant",
            content: `Poeng ${r.score}/10 – ${r.critique}`,
            node: `${r.node} (evaluator)`,
          });
        if (ev.final.trim() && ev.final.trim() !== answer.trim())
          out.push({
            role: "assistant",
            content: ev.final,
            node: `ENDELIG SVAR · ${ev.source} · beste poeng ${ev.bestScore}/10`,
          });
      }
      setMessages(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ukjent feil");
      logSelfEvent("crit", e instanceof Error ? e.message : "Ukjent feil i kommandolinjen");
    } finally {
      setBusy(false);
      setStage("");
    }
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
        {messages.length === 0 ? (
          <p className="hud-title text-[10px] text-muted-foreground">
            System klart. Primærnode: {primary?.name ?? "ingen"}
          </p>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            {m.node ? (
              <p className="hud-title mb-1 text-[9px] text-primary/70">{m.node}</p>
            ) : null}
            <div
              className={
                m.role === "user"
                  ? "inline-block max-w-[85%] rounded-md border border-primary/40 bg-primary/15 px-3 py-2 text-left text-sm text-foreground"
                  : "text-sm leading-relaxed whitespace-pre-wrap text-foreground/90"
              }
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy ? (
          <p className="flex items-center gap-2 text-xs text-primary">
            <Loader2 className="size-3 animate-spin" /> prosesserer…
          </p>
        ) : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {pending.length ? (
          <div className="space-y-1 rounded border border-amber-400/40 bg-amber-400/5 p-2">
            <p className="hud-title text-[9px] text-amber-300">
              BEKREFT KOMMANDOER (tørrkjøring)
            </p>
            {pending.map((c, i) => (
              <p key={`${c.topic}-${i}`} className="text-[11px] text-foreground/85">
                {c.risky ? "⚠ " : ""}
                {c.topic} ← {c.payload}
              </p>
            ))}
            <div className="flex gap-1">
              <button
                onClick={() => {
                  const done = runCommands(pending);
                  setPending([]);
                  setMessages((m) => [
                    ...m,
                    {
                      role: "assistant",
                      content: done
                        .map((c) => `${c.ok ? "✓" : "✕"} ${c.topic} ← ${c.payload}`)
                        .join("\n"),
                      node: "MQTT",
                    },
                  ]);
                }}
                className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px] text-primary"
              >
                kjør
              </button>
              <button
                onClick={() => setPending([])}
                className="hud-btn hud-btn-hoverable hud-title !py-0.5 text-[9px]"
              >
                avbryt
              </button>
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>
      <div className="flex items-center gap-2 border-t border-primary/20 pt-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
          placeholder="Snakk til systemet…"
          className="hud-input flex-1"
        />
        <button
          onClick={() =>
            void send(
              `Jeg vil sette opp en ny ESP-enhet i smarthuset. Still meg korte spørsmål om rom, sensorer/aktuatorer og protokoll, foreslå navn og MQTT-emne som passer oppsettet mitt, og lever komplett konfigurasjon til slutt.\n\n[EKSISTERENDE ENHETER]\n${deviceBrief(config) || "ingen registrert ennå"}`,
            )
          }
          disabled={busy}
          aria-label="Sett opp ny enhet"
          title="Sett opp ny ESP32 / Raspberry Pi"
          className="rounded border border-primary/30 p-2 text-primary/80 transition-colors hover:bg-primary/10 disabled:opacity-40"
        >
          <Cpu className="size-4" />
        </button>
        <button
          onClick={() => void send("Gi meg topp 10 hendelser fra world monitor akkurat nå.")}
          disabled={busy}
          aria-label="Situasjonsbrief"
          title="Topp 10 hendelser fra World Monitor"
          className="rounded border border-primary/30 p-2 text-primary/80 transition-colors hover:bg-primary/10 disabled:opacity-40"
        >
          <Radar className="size-4" />
        </button>
        <button
          onClick={() => void send()}
          disabled={busy}
          aria-label="Send"
          className="rounded border border-primary/40 bg-primary/10 p-2 text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
        >
          <SendHorizonal className="size-4" />
        </button>
      </div>
    </div>
  );
}
