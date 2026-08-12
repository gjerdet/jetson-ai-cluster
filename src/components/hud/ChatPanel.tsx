import { useEffect, useRef, useState } from "react";
import {
  SendHorizonal,
  Loader2,
  Radar,
  Cpu,
  Eraser,
  Wrench,
  BookOpen,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  loadVoiceConfig,
  onVoicesReady,
  pickJarvisVoice,
  listVoices,
  saveVoiceConfig,
  speak,
  stopSpeak,
  voiceSupported,
} from "@/lib/voice";

import { type ChatMsg, type ToolRun } from "@/lib/hud-client";
import { callBalanced, callTracked } from "@/lib/balancer";
import { logRouting } from "@/lib/routing-log";
import { backend, backendToken } from "@/lib/backend";
import { clearChat, loadChat, loadChatRemote, saveChat, saveChatRemote } from "@/lib/chat-store";
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
import {
  parseToolCalls,
  runTool,
  stripToolCalls,
  TOOL_PROMPT,
  toolAvailability,
  customToolPrompt,
  customToolNames,
} from "@/lib/agent-tools";
import { evaluate } from "@/lib/evaluator";
import { logSelfEvent } from "@/lib/health";
import { retrieveContext, type Citation } from "@/lib/knowledge";

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

  // stemme (Web Speech API – kjører lokalt, ingen sky)
  const [voice, setVoice] = useState(() => loadVoiceConfig());
  const [voiceName, setVoiceName] = useState("");
  const spokenRef = useRef(0);
  useEffect(() => onVoicesReady(() => {
    const v = pickJarvisVoice(listVoices(), loadVoiceConfig().voiceURI);
    setVoiceName(v ? `${v.name} (${v.lang})` : "ingen stemme funnet");
  }), []);
  useEffect(() => {
    if (!voice.på) return;
    const siste = [...messages].reverse().find((m) => m.role === "assistant");
    if (!siste) return;
    const stempel = siste.time ?? messages.length;
    if (stempel === spokenRef.current) return;
    spokenRef.current = stempel;
    speak(siste.content, voice);
  }, [messages, voice]);
  useEffect(() => () => stopSpeak(), []);

  const [synced, setSynced] = useState(false);


  // henter forrige samtale: først lokalt (raskt), deretter fra backend-en om
  // du er logget inn – slik at historikken er delt mellom maskiner
  useEffect(() => {
    if (config.keepHistory === false) return;
    const prev = loadChat();
    if (prev.length) setMessages(prev);
    let alive = true;
    void loadChatRemote().then((remote) => {
      if (!alive) return;
      if (remote && remote.length >= prev.length) setMessages(remote);
      setSynced(true);
    });
    return () => {
      alive = false;
    };
  }, [config.keepHistory]);

  useEffect(() => {
    if (config.keepHistory === false) return;
    saveChat(messages);
    if (!synced || !messages.length) return;
    const t = setTimeout(() => void saveChatRemote(messages), 800);
    return () => clearTimeout(t);
  }, [messages, config.keepHistory, synced]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const active = config.nodes.filter((n) => n.enabled);
  // valgt AI-node (f.eks. Hermes) vinner over rollen «primary»
  const chosen = config.aiNodeId ? active.find((n) => n.id === config.aiNodeId) : undefined;
  const primary = chosen ?? active.find((n) => n.role === "primary") ?? active[0];
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

    // Backend er standardveien. Bare et eksplisitt avslag bruker direkte kall
    // fra nettleseren til modellen (som ellers lett blokkeres av CORS/TLS).
    const viaBackend = config.chatViaBackend !== false;
    if (viaBackend && !backendToken()) {
      setError("Backend-chat er aktiv, men du er ikke innlogget. Logg inn under SYSTEM → BACKEND.");
      return;
    }
    if (!viaBackend && !primary) {
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
        customToolPrompt(config),
        toolAvailability(config, Object.keys(mqtt.topics).length),
      ]
        .filter(Boolean)
        .join("\n");
      let context = "";
      // kunnskapsinnhenting: hent relevante biter fra den lokale kunnskapsbasen
      let sources: Citation[] = [];
      if (config.knowledge !== false) {
        setStage("henter kunnskap");
        const rag = await retrieveContext(text);
        context += rag.context;
        sources = rag.sources;
      }
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
      let answeredBy = viaBackend ? "BACKEND" : (primary?.name ?? "AI");
      const runs: ToolRun[] = [];

      // verktøykall-loop: modellen kan hente ekte data før den svarer
      const direkte = (round: number) => {
        if (!primary) throw new Error("Ingen aktiv AI-node er tilgjengelig.");
        return config.loadBalance !== false
          ? callBalanced(active, thread, { prefer: primary, duty: round === 0 ? "chat" : "verktoy" })
          : callTracked(primary, thread).then((result) => ({ text: result, node: primary }));
      };

      for (let round = 0; round < 4; round++) {
        // Når backend-chat er valgt går hver runde kun via POST /ai/chat.
        // Backend-en lastbalanserer selv mellom Jetson-nodene; er en node låst
        // i innstillingene, sendes den med som ønsket node.
        const call = viaBackend
          ? await backend
              .aiChat(thread.map((m) => ({ role: m.role, content: m.content })), {
                oppgave: round === 0 ? "chat" : "verktoy",
                ...(config.loadBalance === false && config.aiNodeId ? { nodeId: config.aiNodeId } : {}),
              })
              .then((r) => {
                logRouting({
                  oppgave: round === 0 ? "chat" : "verktoy",
                  nodeNavn: r.nodeNavn || r.model || "backend",
                  ...(r.nodeId ? { nodeId: r.nodeId } : {}),
                  ...(r.model ? { model: r.model } : {}),
                  ...(r.ms != null ? { ms: r.ms } : {}),
                  ...(r.hoppetOver?.length ? { hoppetOver: r.hoppetOver } : {}),
                });
                if (r.hoppetOver?.length)
                  logSelfEvent("warn", `Backend hoppet over ${r.hoppetOver.map((h) => h.node).join(", ")}`);
                return {
                  text: r.svar,
                  node: {
                    ...(primary ?? active[0]),
                    name: `BACKEND · ${r.nodeNavn || r.model || primary?.model || "AI"}`,
                  },
                };
              })
          : await direkte(round);


        const raw = call.text;
        answeredBy = call.node.name;
        const calls = parseToolCalls(raw, customToolNames(config));
        if (!calls.length) {
          answer = raw.trim();
          break;
        }
        const visible = stripToolCalls(raw);
        if (visible) out.push({ role: "assistant", content: visible, node: call.node.name });
        thread.push({ role: "assistant", content: raw });
        const results: string[] = [];
        for (const c of calls) {
          setStage(`verktøy: ${c.name}`);
          const t0 = performance.now();
          let res: string;
          let ok = true;
          try {
            res = await runTool(c, { config, ...(update ? { update } : {}), topics: mqtt.topics });
          } catch (e) {
            ok = false;
            res = `Feil: ${e instanceof Error ? e.message : "ukjent"}`;
            logSelfEvent("warn", `Verktøy ${c.name} feilet`);
          }
          runs.push({
            name: c.name,
            args: c.args,
            result: res,
            ms: Math.round(performance.now() - t0),
            time: Date.now(),
            ok,
          });
          results.push(`[${c.name}]\n${res}`);
        }
        thread.push({
          role: "user",
          content: `VERKTØYRESULTAT:\n${results.join("\n\n")}\n\nSvar nå brukeren basert på disse dataene.`,
        });
        setStage("tenker");
        answer = "";
      }
      if (!answer) answer = "(fikk ikke ferdig svar innen verktøygrensen)";

      out.push({
        role: "assistant",
        content: answer,
        node: answeredBy,
        time: Date.now(),
        ...(runs.length ? { runs } : {}),
        ...(sources.length ? { sources } : {}),
      });


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

      if (!viaBackend && primary && config.collaboration && workers.length > 0) {
        setStage("evaluerer");
        const ev = await evaluate({
          question: text,
          answer,
          primary,
          workers,
          settings: config.evaluator,
        });
        for (const r of ev.reviews)
          out.push({
            role: "assistant",
            content: `Poeng ${r.score}/10 – ${r.critique}`,
            node: `${r.node} (evaluator)`,
            ...(r.criteria.length ? { scores: r.criteria } : {}),
          });
        if (ev.rewritten && ev.final.trim() && ev.final.trim() !== answer.trim())
          out.push({
            role: "assistant",
            content: ev.final,
            node: `ENDELIG SVAR · ${ev.source} · beste poeng ${ev.bestScore}/10`,
            time: Date.now(),
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
            {config.keepHistory === false ? " · historikk av" : " · husker samtalen lokalt"}
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
            {m.sources?.length ? (
              <details className="mt-1 rounded border border-primary/20 bg-primary/[0.03] px-2 py-1 text-left">
                <summary className="hud-title flex cursor-pointer items-center gap-1 text-[9px] text-primary/70">
                  <BookOpen className="size-3" /> {m.sources.length} kilde
                  {m.sources.length > 1 ? "r" : ""} fra kunnskapsbasen
                </summary>
                <ol className="mt-1 space-y-1">
                  {m.sources.map((s, si) => (
                    <li key={si} className="text-[10px] text-foreground/75">
                      <span className="hud-title text-primary/70">
                        [{si + 1}] {s.tittel}
                        {s.kilde ? ` · ${s.kilde}` : ""} · {s.poeng}
                      </span>
                      <p className="line-clamp-3 whitespace-pre-wrap">{s.utdrag}</p>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
            {m.scores?.length ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {m.scores.map((sc) => (
                  <span
                    key={sc.label}
                    className="hud-title rounded-full border border-primary/25 px-2 py-0.5 text-[8px] text-primary/70"
                  >
                    {sc.label} {sc.score}/10
                  </span>
                ))}
              </div>
            ) : null}
            {m.runs?.length ? (
              <details className="mt-1 rounded border border-primary/20 bg-primary/[0.03] px-2 py-1 text-left">
                <summary className="hud-title flex cursor-pointer items-center gap-1 text-[9px] text-primary/70">
                  <Wrench className="size-3" /> {m.runs.length} verktøykjøring
                  {m.runs.length > 1 ? "er" : ""} ·{" "}
                  {m.runs.reduce((a, r) => a + r.ms, 0)} ms
                </summary>
                <div className="mt-1 space-y-2">
                  {m.runs.map((r, ri) => (
                    <div key={`${r.name}-${ri}`} className="space-y-0.5">
                      <p className="hud-title text-[9px] text-primary/80">
                        {r.ok ? "✓" : "✕"} {r.name} · {r.ms} ms ·{" "}
                        {new Date(r.time).toLocaleTimeString("nb-NO")}
                      </p>
                      <p className="text-[10px] break-all text-muted-foreground">
                        inn: {Object.keys(r.args).length ? JSON.stringify(r.args) : "{}"}
                      </p>
                      <pre className="max-h-40 overflow-auto text-[10px] whitespace-pre-wrap text-foreground/70">
                        {r.result}
                      </pre>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        ))}
        {busy ? (
          <p className="flex items-center gap-2 text-xs text-primary">
            <Loader2 className="size-3 animate-spin" /> {stage || "prosesserer"}…
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
          onClick={() => {
            setMessages([]);
            clearChat();
            void saveChatRemote([]);
            setPending([]);
            setError(null);
          }}
          disabled={busy}
          aria-label="Ny samtale"
          title="Ny samtale (tømmer lokal historikk)"
          className="rounded border border-primary/30 p-2 text-primary/80 transition-colors hover:bg-primary/10 disabled:opacity-40"
        >
          <Eraser className="size-4" />
        </button>
        {voiceSupported() ? (
          <button
            onClick={() => {
              const ny = { ...voice, på: !voice.på };
              setVoice(ny);
              saveVoiceConfig(ny);
              if (!ny.på) stopSpeak();
              else {
                spokenRef.current = -1;
                speak("Systemene er på nett. Jeg lytter, sir.", ny);
              }
            }}
            aria-label={voice.på ? "Slå av stemme" : "Slå på stemme"}
            title={`Stemme ${voice.på ? "på" : "av"} · ${voiceName || "laster stemmer…"}`}
            className={`rounded border p-2 transition-colors ${
              voice.på
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-primary/30 text-primary/60 hover:bg-primary/10"
            }`}
          >
            {voice.på ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          </button>
        ) : null}

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
