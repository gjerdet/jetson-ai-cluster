import { useEffect, useState } from "react";
import { Play, Square, Volume2 } from "lucide-react";
import {
  loadVoiceConfig,
  saveVoiceConfig,
  listVoices,
  onVoicesReady,
  pickJarvisVoice,
  speakBrowser,
  speakPiper,
  speakBackend,
  stopSpeak,
  voiceSupported,
  type VoiceConfig,
} from "@/lib/voice";
import { VoiceTraining } from "./VoiceTraining";

const TESTTEKST = "Systemene er på nett, sir. Alle noder rapporterer normal drift.";

export function VoiceSection() {
  const [cfg, setCfg] = useState<VoiceConfig>(() => loadVoiceConfig());
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [status, setStatus] = useState("");

  useEffect(() => onVoicesReady(() => setVoices(listVoices())), []);

  const patch = (p: Partial<VoiceConfig>) => {
    const ny = { ...cfg, ...p };
    setCfg(ny);
    saveVoiceConfig(ny);
  };

  const test = async () => {
    setStatus("spiller av…");
    try {
      if (cfg.engine === "piper") await speakPiper(TESTTEKST, cfg);
      else if (cfg.engine === "backend") await speakBackend(TESTTEKST, cfg);
      else speakBrowser(TESTTEKST, cfg);
      setStatus("ok");
    } catch (e) {
      setStatus(`feil: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const auto = pickJarvisVoice(voices, cfg.voiceURI);

  return (
    <div className="space-y-3">
      <Row label="Stemme aktiv">
        <button
          onClick={() => patch({ på: !cfg.på })}
          className={`rounded-full border px-3 py-1 text-[10px] transition-colors ${
            cfg.på
              ? "border-primary/60 bg-primary/20 text-primary"
              : "border-primary/20 text-muted-foreground"
          }`}
        >
          {cfg.på ? "PÅ" : "AV"}
        </button>
      </Row>

      <Row label="Motor">
        <div className="flex gap-1">
          {(["browser", "piper", "backend"] as const).map((m) => (
            <button
              key={m}
              onClick={() => patch({ engine: m })}
              className={`rounded-full border px-3 py-1 text-[10px] transition-colors ${
                cfg.engine === m
                  ? "border-primary/60 bg-primary/20 text-primary"
                  : "border-primary/20 text-muted-foreground hover:text-primary"
              }`}
            >
              {m === "browser" ? "NETTLESER" : m === "piper" ? "PIPER (direkte)" : "AGENT (Jetson)"}
            </button>
          ))}
        </div>
      </Row>

      {cfg.engine === "backend" ? (
        <Row label="Piper-modell">
          <input
            value={cfg.piperVoice ?? ""}
            onChange={(e) => patch({ piperVoice: e.target.value })}
            placeholder="en_GB-alan-medium"
            className="hud-input w-full"
          />
        </Row>
      ) : null}

      {cfg.engine === "browser" ? (
        <>
          <Row label="Stemme">
            <select
              value={cfg.voiceURI ?? ""}
              onChange={(e) => patch({ voiceURI: e.target.value })}
              className="hud-select w-full"
            >
              <option value="">Auto ({auto ? auto.name : "ingen funnet"})</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} · {v.lang}
                  {v.localService ? " · lokal" : ""}
                </option>
              ))}
            </select>
          </Row>
          {!voiceSupported() ? (
            <p className="text-[10px] text-muted-foreground">
              Nettleseren støtter ikke Web Speech API — bruk piper.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <Row label="Piper-URL">
            <input
              value={cfg.piperUrl ?? ""}
              onChange={(e) => patch({ piperUrl: e.target.value })}
              placeholder="http://jetson.local:5000/api/tts"
              className="hud-input w-full"
            />
          </Row>
          <Row label="Piper-modell">
            <input
              value={cfg.piperVoice ?? ""}
              onChange={(e) => patch({ piperVoice: e.target.value })}
              placeholder="en_GB-alan-medium"
              className="hud-input w-full"
            />
          </Row>
        </>
      )}

      <Slider
        label={`Tempo – ${cfg.rate.toFixed(2)}`}
        min={0.5}
        max={2}
        value={cfg.rate}
        onChange={(v) => patch({ rate: v })}
      />
      {cfg.engine === "browser" ? (
        <Slider
          label={`Tonehøyde – ${cfg.pitch.toFixed(2)}`}
          min={0}
          max={2}
          value={cfg.pitch}
          onChange={(v) => patch({ pitch: v })}
        />
      ) : null}
      <Slider
        label={`Volum – ${Math.round(cfg.volume * 100)}%`}
        min={0}
        max={1}
        value={cfg.volume}
        onChange={(v) => patch({ volume: v })}
      />

      <div className="flex items-center gap-2">
        <button
          onClick={test}
          className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[10px] text-primary transition-colors hover:bg-primary/20"
        >
          <Play className="size-3" /> TEST STEMME
        </button>
        <button
          onClick={() => {
            stopSpeak();
            setStatus("stoppet");
          }}
          className="flex items-center gap-1 rounded-full border border-primary/20 px-3 py-1 text-[10px] text-muted-foreground transition-colors hover:text-primary"
        >
          <Square className="size-3" /> STOPP
        </button>
        {status ? (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Volume2 className="size-3" /> {status}
          </span>
        ) : null}
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Piper kjører lokalt på Jetson (f.eks. <code>piper-http</code> på port 5000) og gir langt mer
        filmatisk JARVIS-klang enn nettleserstemmene. Egen trent stemme legges inn ved å peke
        «Piper-modell» til din <code>.onnx</code>-modell.
      </p>

      <div className="border-t border-primary/15 pt-3">
        <VoiceTraining />
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="hud-title text-[9px] text-muted-foreground">{label}</span>
      <div>{children}</div>
    </label>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Row label={label}>
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[oklch(0.78_0.13_200)]"
      />
    </Row>
  );
}
