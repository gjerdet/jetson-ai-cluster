/**
 * OPPDATERING & ROLLBACK – kommandoene du trenger på Jetson-noden,
 * med kopiknapp så du slipper å skrive dem av.
 */
import { useState } from "react";
import { Check, Copy } from "lucide-react";

const btn =
  "rounded-full border border-primary/30 bg-primary/[0.08] px-3 py-1.5 text-[9px] uppercase tracking-[0.2em] text-primary/90 transition hover:bg-primary/20 disabled:opacity-40";

const KOMMANDOER: { id: string; tittel: string; forklaring: string; kommando: string }[] = [
  {
    id: "oppdater",
    tittel: "Oppdater til siste versjon",
    forklaring: "Tar sikkerhetskopi av data og agent.env, henter ny kode, bygger og restarter tjenesten.",
    kommando: "sudo /opt/jarvis/agent/scripts/update-jetson.sh main",
  },
  {
    id: "versjon",
    tittel: "Oppdater til en bestemt versjon",
    forklaring: "Bytt ut taggen med den versjonen du vil kjøre, f.eks. v2.1.0.",
    kommando: "sudo /opt/jarvis/agent/scripts/update-jetson.sh v2.1.0",
  },
  {
    id: "rollback",
    tittel: "Rull tilbake programvaren",
    forklaring: "Går tilbake til forrige commit og gjenoppretter dataene fra siste sikkerhetskopi.",
    kommando:
      "cd /opt/jarvis && git checkout HEAD@{1} && cp -a .oppdatering/$(ls -1 .oppdatering | tail -1)/data/. agent/data/ && sudo systemctl restart jarvis-agent",
  },
  {
    id: "kopier",
    tittel: "Se sikkerhetskopiene",
    forklaring: "Hver oppdatering legger en tidsstemplet kopi av data og agent.env her.",
    kommando: "ls -1 /opt/jarvis/.oppdatering",
  },
  {
    id: "logg",
    tittel: "Følg loggen etter oppdatering",
    forklaring: "Sjekk at agenten starter rent igjen.",
    kommando: "journalctl -u jarvis-agent -f -n 100",
  },
];

export function UpdateSection({ agent }: { agent: string | null }) {
  const [kopiert, setKopiert] = useState<string | null>(null);

  const kopier = async (id: string, tekst: string) => {
    try {
      await navigator.clipboard.writeText(tekst);
      setKopiert(id);
      setTimeout(() => setKopiert((v) => (v === id ? null : v)), 1800);
    } catch {
      setKopiert(null);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-primary/15 bg-background/20 p-3">
      <header className="hud-title text-[9px] text-primary/80">Oppdatering &amp; rollback</header>
      <p className="text-[9px] leading-relaxed text-muted-foreground">
        {agent
          ? `Noden kjører agent ${agent}. Kjør kommandoene i et terminalvindu på Jetson-noden.`
          : "Ikke koblet til en agent akkurat nå. Kommandoene kjøres i et terminalvindu på Jetson-noden."}{" "}
        Konfigurasjonen din rulles tilbake herfra i GUI-et; selve programvaren rulles tilbake med git,
        slik at HUD-en aldri kan sette noden ut av drift.
      </p>

      <ul className="space-y-2">
        {KOMMANDOER.map((k) => (
          <li key={k.id} className="rounded-lg border border-primary/15 bg-primary/[0.03] p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] text-foreground/85">{k.tittel}</p>
                <p className="text-[9px] leading-relaxed text-muted-foreground">{k.forklaring}</p>
              </div>
              <button
                className={`${btn} shrink-0`}
                onClick={() => void kopier(k.id, k.kommando)}
                aria-label={`Kopier kommando: ${k.tittel}`}
              >
                {kopiert === k.id ? <Check className="size-3" /> : <Copy className="size-3" />}
              </button>
            </div>
            <code className="mt-1 block break-all rounded bg-background/40 px-2 py-1 font-mono text-[9px] text-primary/80">
              {k.kommando}
            </code>
          </li>
        ))}
      </ul>
    </div>
  );
}
