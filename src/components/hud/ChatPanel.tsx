import { useEffect, useRef, useState } from "react";
import { SendHorizonal, Loader2 } from "lucide-react";
import { callNode, type ChatMsg } from "@/lib/hud-client";
import { systemPrompt, type HudConfig } from "@/lib/hud-store";

export function ChatPanel({ config }: { config: HudConfig }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const active = config.nodes.filter((n) => n.enabled);
  const primary = active.find((n) => n.role === "primary") ?? active[0];
  const workers = active.filter((n) => n.id !== primary?.id && n.role !== "observer");

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    if (!primary) {
      setError("Ingen aktiv node. Åpne NODER og aktiver minst én.");
      return;
    }
    setError(null);
    const next: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const answer = await callNode(primary, next);
      const out: ChatMsg[] = [
        ...next,
        { role: "assistant", content: answer, node: primary.name },
      ];
      if (config.collaboration && workers.length > 0) {
        for (const w of workers) {
          const review = await callNode(w, [
            {
              role: "system",
              content:
                "Du er en samarbeidende modell. Vurder og forbedre svaret fra primærmodellen. Vær kort og konkret.",
            },
            { role: "user", content: `Spørsmål: ${text}\n\nSvar fra primær:\n${answer}` },
          ]);
          out.push({ role: "assistant", content: review, node: w.name });
        }
      }
      setMessages(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ukjent feil");
    } finally {
      setBusy(false);
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
