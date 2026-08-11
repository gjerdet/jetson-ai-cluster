import { useState } from "react";
import { Rocket, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { pingNode } from "@/lib/hud-client";
import { setBackendUrl, backendUrl } from "@/lib/backend";
import type { HudConfig, ModelNode } from "@/lib/hud-store";

type Steg = { navn: string; status: "venter" | "kjører" | "ok" | "feil"; melding?: string };

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$|^[a-zA-Z0-9.-]+$/;

/**
 * Hurtigoppsett: skriv inn Jetson-adressen, så settes AI-nodene (llama + Hermes)
 * og backend-adressen opp automatisk, med tilkoblingstest på hvert steg.
 */
export function QuickSetup({
  config,
  update,
}: {
  config: HudConfig;
  update: (c: HudConfig) => void;
}) {
  const [vert, setVert] = useState(
    () => backendUrl().replace(/^https?:\/\//, "").split(":")[0] || "192.168.1.50",
  );
  const [chat, setChat] = useState("llama3.2:3b");
  const [hermes, setHermes] = useState("hermes3:8b");
  const [steg, setSteg] = useState<Steg[]>([]);
  const [kjører, setKjører] = useState(false);

  const sett = (i: number, p: Partial<Steg>) =>
    setSteg((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const kjør = async () => {
    if (!IP_RE.test(vert.trim())) return;
    const host = vert.trim();
    const ollama = `http://${host}:11434/v1`;
    const backend = `http://${host}:8787`;

    const start: Steg[] = [
      { navn: `Kontakt Ollama på ${host}`, status: "venter" },
      { navn: `Registrer chat-node (${chat})`, status: "venter" },
      { navn: `Registrer Hermes-node (${hermes})`, status: "venter" },
      { navn: `Koble til backend på ${host}:8787`, status: "venter" },
    ];
    setSteg(start);
    setKjører(true);

    // 1. Ollama
    sett(0, { status: "kjører" });
    const chatNode: ModelNode = {
      id: "node-jetson",
      name: "JETSON-01",
      baseUrl: ollama,
      model: chat,
      role: "primary",
      duties: ["chat", "verktoy"],
      weight: 1,
      enabled: true,
    };
    const ms = await pingNode(chatNode).catch(() => null);
    if (ms == null) {
      sett(0, { status: "feil", melding: "Ingen svar. Sjekk at Ollama kjører med OLLAMA_HOST=0.0.0.0:11434." });
      setKjører(false);
      return;
    }
    sett(0, { status: "ok", melding: `${ms} ms` });

    // 2 + 3. Noder
    sett(1, { status: "kjører" });
    const hermesNode: ModelNode = {
      id: "node-hermes",
      name: "HERMES",
      baseUrl: ollama,
      model: hermes,
      role: "worker",
      duties: ["chat", "verktoy", "evaluator"],
      weight: 1,
      enabled: true,
    };
    const andre = config.nodes.filter((n) => n.id !== "node-jetson" && n.id !== "node-hermes");
    update({ ...config, nodes: [chatNode, hermesNode, ...andre], loadBalance: true });
    sett(1, { status: "ok", melding: chat });

    sett(2, { status: "kjører" });
    const hMs = await pingNode(hermesNode).catch(() => null);
    sett(2, {
      status: hMs == null ? "feil" : "ok",
      melding: hMs == null ? `Kjør «ollama pull ${hermes}» på Jetson-en` : `${hMs} ms`,
    });

    // 4. Backend
    sett(3, { status: "kjører" });
    setBackendUrl(backend);
    try {
      const r = await fetch(`${backend}/health`, { signal: AbortSignal.timeout(5000) });
      sett(3, {
        status: r.ok ? "ok" : "feil",
        melding: r.ok ? "Logg inn under SYSTEM › Backend" : `HTTP ${r.status}`,
      });
    } catch {
      sett(3, { status: "feil", melding: "Agenten svarer ikke – kjør install-jetson.sh" });
    }
    setKjører(false);
  };

  return (
    <section className="rounded border border-primary/25 bg-primary/5 p-2">
      <p className="hud-title mb-2 text-[10px] text-primary/90">
        <Rocket className="mr-1 inline size-3" />
        HURTIGOPPSETT
      </p>
      <p className="mb-2 text-[10px] text-muted-foreground">
        Kjør først <code className="text-primary/80">sudo bash agent/scripts/install-jetson.sh</code> på
        Jetson-en. Skriv så inn adressen her, så kobles alt opp.
      </p>
      <div className="grid grid-cols-3 gap-2">
        <label className="col-span-3 text-[9px] text-muted-foreground">
          Jetson IP / vertsnavn
          <input
            value={vert}
            onChange={(e) => setVert(e.target.value)}
            placeholder="192.168.1.50"
            className="hud-input mt-0.5 w-full text-[11px]"
          />
        </label>
        <label className="col-span-3 text-[9px] text-muted-foreground sm:col-span-1">
          Chat-modell
          <input value={chat} onChange={(e) => setChat(e.target.value)} className="hud-input mt-0.5 w-full text-[11px]" />
        </label>
        <label className="col-span-3 text-[9px] text-muted-foreground sm:col-span-1">
          Hermes-modell
          <input
            value={hermes}
            onChange={(e) => setHermes(e.target.value)}
            className="hud-input mt-0.5 w-full text-[11px]"
          />
        </label>
        <button
          onClick={() => void kjør()}
          disabled={kjører}
          className="hud-btn hud-btn-hoverable hud-title col-span-3 text-[10px] text-primary sm:col-span-1 sm:self-end"
        >
          {kjører ? <Loader2 className="mr-1 inline size-3 animate-spin" /> : null}
          koble opp
        </button>
      </div>

      {steg.length ? (
        <ul className="mt-2 space-y-1">
          {steg.map((s, i) => (
            <li key={i} className="flex items-baseline gap-2 text-[10px]">
              {s.status === "ok" ? (
                <CheckCircle2 className="size-3 shrink-0 text-primary" />
              ) : s.status === "feil" ? (
                <XCircle className="size-3 shrink-0 text-destructive" />
              ) : s.status === "kjører" ? (
                <Loader2 className="size-3 shrink-0 animate-spin text-primary/70" />
              ) : (
                <span className="size-3 shrink-0 rounded-full border border-primary/30" />
              )}
              <span className={s.status === "feil" ? "text-destructive" : "text-foreground/80"}>
                {s.navn}
                {s.melding ? <span className="text-muted-foreground"> · {s.melding}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
