/**
 * VERSJON & KONFIG – eksport/import av oppsettet mellom installasjoner,
 * slik at en ny Jetson-node kan hente ned alt ferdig konfigurert.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { backend, safe } from "@/lib/backend";
import type { ConfigInspect, VersionInfo } from "@/lib/backend";
import {
  APP_VERSION,
  lastNedPakke,
  lesHudDel,
  lesPakkeFraFil,
  skrivHudDel,
  tomPakke,
  lagreRollback,
  lesRollback,
  type FullBundle,
} from "@/lib/version";
import { UpdateSection } from "./UpdateSection";
import { DistributeSection } from "./DistributeSection";
import { API_VERSION } from "@/lib/contract";

const btn =
  "rounded-full border border-primary/30 bg-primary/[0.08] px-3 py-1.5 text-[9px] uppercase tracking-[0.2em] text-primary/90 transition hover:bg-primary/20 disabled:opacity-40";

function Rad({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-primary/10 py-1 last:border-0">
      <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{k}</span>
      <span className="truncate text-[10px] text-foreground/80">{v}</span>
    </div>
  );
}

export function VersionSection() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modus, setModus] = useState<"flett" | "erstatt">("flett");
  const [forhandsvis, setForhandsvis] = useState<(ConfigInspect & { fil: string }) | null>(null);
  const [rollback, setRollback] = useState<{ tid: number; pakke: FullBundle } | null>(null);
  const [utrulling, setUtrulling] = useState(0);
  const valgtPakke = useRef<FullBundle | null>(null);
  const filInput = useRef<HTMLInputElement>(null);

  const hent = useCallback(async () => {
    const { data, error } = await safe(() => backend.hentVersjon());
    setInfo(data);
    setFeil(error ? error.message : null);
  }, []);

  useEffect(() => {
    void hent();
    setRollback(lesRollback());
  }, [hent]);

  const rullTilbake = async () => {
    const lagret = rollback?.pakke;
    if (!lagret) return;
    setBusy(true);
    setMelding(null);
    const { error } = await safe(() => backend.importerKonfig(lagret, { modus: "erstatt" }));
    const hudAntall = skrivHudDel(lagret.hud);
    setMelding(
      error
        ? `Backend feilet (${error.message}). ${hudAntall} HUD-nøkler ble rullet tilbake lokalt.`
        : `Rullet tilbake til konfigurasjonen fra ${new Date(rollback!.tid).toLocaleString("nb-NO")}.`,
    );
    void hent();
    setBusy(false);
  };

  const eksporter = async () => {
    setBusy(true);
    setMelding(null);
    try {
      const { data } = await safe(() => backend.eksporterKonfig());
      const pakke: FullBundle = { ...(data ?? tomPakke()), hud: lesHudDel() ?? { versjon: APP_VERSION, nokler: {} } };
      const navn = lastNedPakke(pakke);
      setMelding(
        data
          ? `Lastet ned ${navn} (${Object.keys(pakke.dokumenter).length} backend-dokumenter + HUD-oppsett).`
          : `Backend var ikke tilgjengelig – lastet ned ${navn} med kun HUD-oppsettet.`,
      );
    } catch (e) {
      setMelding(e instanceof Error ? e.message : "Kunne ikke eksportere.");
    } finally {
      setBusy(false);
    }
  };

  const velgFil = async (file: File) => {
    setBusy(true);
    setMelding(null);
    try {
      const pakke = await lesPakkeFraFil(file);
      valgtPakke.current = pakke;
      const { data } = await safe(() => backend.sjekkKonfig(pakke));
      setForhandsvis({
        fil: file.name,
        dokumenter: data ? data.dokumenter : Object.keys(pakke.dokumenter ?? {}),
        ukjente: data ? data.ukjente : [],
        sjekksumOk: data ? data.sjekksumOk : null,
        laget: pakke.laget ?? null,
        agent: pakke.agent ?? null,
      });
      if (!data) setMelding("Backend svarte ikke – kan fortsatt gjenopprette HUD-oppsettet lokalt.");
    } catch (e) {
      setForhandsvis(null);
      setMelding(e instanceof Error ? e.message : "Ugyldig fil.");
    } finally {
      setBusy(false);
    }
  };

  const importer = async () => {
    const pakke = valgtPakke.current;
    if (!pakke) return;
    setBusy(true);
    setMelding(null);
    const forrige = await safe(() => backend.eksporterKonfig());
    lagreRollback({
      ...(forrige.data ?? tomPakke()),
      hud: lesHudDel() ?? { versjon: APP_VERSION, nokler: {} },
    });
    setRollback(lesRollback());
    const { data, error } = await safe(() => backend.importerKonfig(pakke, { modus }));
    const hudAntall = skrivHudDel(pakke.hud);
    if (data) {
      setMelding(
        `Importert: ${data.skrevet.length} backend-dokumenter og ${hudAntall} HUD-nøkler. Last siden på nytt for å se alt.`,
      );
      // Utløser automatisk utrulling til resten av klyngen (kan slås av).
      setUtrulling((n) => n + 1);
      void hent();
    } else {
      setMelding(`Backend feilet (${error?.message ?? "ukjent feil"}). ${hudAntall} HUD-nøkler ble likevel gjenopprettet lokalt.`);
    }
    setBusy(false);
  };

  return (
    <section className="space-y-3 rounded-2xl border border-primary/20 bg-primary/[0.04] p-3">
      <header className="hud-title text-[9px] text-primary/80">Versjon &amp; konfig</header>

      <div className="rounded-xl border border-primary/15 bg-background/20 px-3 py-1.5">
        <Rad k="HUD" v={APP_VERSION} />
        <Rad k="API-kontrakt" v={String(API_VERSION)} />
        <Rad k="Agent" v={info ? info.agent : "– ikke tilkoblet"} />
        <Rad k="Vert" v={info ? `${info.vert} · ${info.plattform}` : "–"} />
        <Rad k="Node.js" v={info?.node ?? "–"} />
        <Rad
          k="Konfigversjon"
          v={
            info
              ? `#${info.konfigVersjon}${info.konfigOppdatert ? ` · ${new Date(info.konfigOppdatert).toLocaleString("nb-NO")}` : ""}`
              : "–"
          }
        />
      </div>
      {feil ? <p className="text-[9px] text-destructive/80">{feil}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button className={btn} onClick={() => void hent()} disabled={busy}>
          Oppdater status
        </button>
        <button className={btn} onClick={() => void eksporter()} disabled={busy}>
          Last ned konfig-pakke
        </button>
        <button className={btn} onClick={() => filInput.current?.click()} disabled={busy}>
          Velg pakke å hente inn
        </button>
        {rollback ? (
          <button className={btn} onClick={() => void rullTilbake()} disabled={busy}>
            Rull tilbake konfig ({new Date(rollback.tid).toLocaleString("nb-NO")})
          </button>
        ) : null}
        <input
          ref={filInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void velgFil(f);
          }}
        />
      </div>

      {forhandsvis ? (
        <div className="space-y-2 rounded-xl border border-primary/20 bg-background/25 p-3">
          <div className="text-[10px] text-foreground/80">{forhandsvis.fil}</div>
          <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            {forhandsvis.dokumenter.length} dokumenter
            {forhandsvis.laget ? ` · laget ${new Date(forhandsvis.laget).toLocaleString("nb-NO")}` : ""}
            {forhandsvis.agent ? ` · agent ${forhandsvis.agent}` : ""}
            {forhandsvis.sjekksumOk === false ? " · SJEKKSUM AVVIKER" : ""}
          </div>
          <div className="flex flex-wrap gap-1">
            {forhandsvis.dokumenter.map((d) => (
              <span
                key={d}
                className="rounded-full border border-primary/25 px-2 py-0.5 text-[9px] text-primary/80"
              >
                {d}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="hud-select text-[9px]"
              value={modus}
              onChange={(e) => setModus(e.target.value as "flett" | "erstatt")}
            >
              <option value="flett">Flett inn (behold det som ikke finnes i pakken)</option>
              <option value="erstatt">Erstatt dokumentene helt</option>
            </select>
            <button className={btn} onClick={() => void importer()} disabled={busy}>
              Hent inn konfig
            </button>
            <button
              className={btn}
              onClick={() => {
                setForhandsvis(null);
                valgtPakke.current = null;
              }}
              disabled={busy}
            >
              Avbryt
            </button>
          </div>
        </div>
      ) : null}

      {melding ? <p className="text-[9px] leading-relaxed text-foreground/70">{melding}</p> : null}

      <DistributeSection trigger={utrulling} modus={modus} />

      <UpdateSection agent={info?.agent ?? null} />

      <p className="text-[9px] leading-relaxed text-muted-foreground">
        Pakken inneholder noder, regler, enheter, MQTT, TTS, RAG og HUD-oppsett – aldri passord, API-nøkler
        eller Telegram-token. Før hver import tar HUD-en vare på forrige konfig, slik at du kan rulle
        tilbake med ett klikk.
      </p>
    </section>
  );
}
