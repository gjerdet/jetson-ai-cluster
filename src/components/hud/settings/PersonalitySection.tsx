/**
 * PERSONLIGHET – rediger JARVIS' karakter, tone og språk.
 */
import { useEffect, useState } from "react";
import {
  buildPersonalityPrompt,
  defaultPersonality,
  PERSONALITY_PRESETS,
  type PersonalityConfig,
  type Tone,
  type Verbosity,
} from "@/lib/hud-store";

import { useHudConfig } from "@/lib/hud-store";
import { Field } from "@/components/hud/SettingsPanel";
import { backend, safe } from "@/lib/backend";



const btn =
  "rounded-full border border-primary/30 bg-primary/[0.08] px-3 py-1.5 text-[9px] uppercase tracking-[0.2em] text-primary/90 transition hover:bg-primary/20 disabled:opacity-40";

const select =
  "w-full rounded-md border border-primary/20 bg-background/40 px-2 py-1.5 text-[10px] text-foreground/90 outline-none focus:border-primary/50";

const textarea =
  "min-h-[60px] w-full resize-y rounded-md border border-primary/20 bg-background/40 px-2 py-1.5 text-[10px] text-foreground/90 outline-none focus:border-primary/50 placeholder:text-muted-foreground/50";

const input =
  "w-full rounded-md border border-primary/20 bg-background/40 px-2 py-1.5 text-[10px] text-foreground/90 outline-none focus:border-primary/50 placeholder:text-muted-foreground/50";

export function PersonalitySection() {
  const { config, update } = useHudConfig();

  const [p, setP] = useState<PersonalityConfig>(() => config.personality ?? defaultPersonality());

  useEffect(() => {
    setP(config.personality ?? defaultPersonality());
  }, [config.personality]);

  const lagre = async () => {
    update({ ...config, personality: p, persona: buildPersonaLine(p) });
    const system = buildPersonalityPrompt(p);
    await safe(() => backend.lagreAi({ system, personality: p }));
  };



  const velgPreset = (id: string) => {
    const funnet = PERSONALITY_PRESETS.find((x) => x.id === id);
    if (funnet) setP(funnet.personality);
  };

  const oppdater = <K extends keyof PersonalityConfig>(key: K, value: PersonalityConfig[K]) => {
    setP((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PERSONALITY_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => velgPreset(preset.id)}
            className={btn}
            title={`Last inn ${preset.label}`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Navn">
          <input
            className={input}
            value={p.name}
            onChange={(e) => oppdater("name", e.target.value)}
            placeholder="JARVIS"
          />
        </Field>
        <Field label="Rolle">
          <input
            className={input}
            value={p.role}
            onChange={(e) => oppdater("role", e.target.value)}
            placeholder="personlig AI-assistent"
          />
        </Field>
        <Field label="Tone">
          <select
            className={select}
            value={p.tone}
            onChange={(e) => oppdater("tone", e.target.value as Tone)}
          >
            <option value="formell">Formell</option>
            <option value="vennlig">Vennlig</option>
            <option value="sarkastisk">Sarkastisk</option>
            <option value="tørr">Tørr</option>
            <option value="entusiastisk">Entusiastisk</option>
            <option value="mørk">Mørk</option>
          </select>
        </Field>
        <Field label="Detaljnivå">
          <select
            className={select}
            value={p.verbosity}
            onChange={(e) => oppdater("verbosity", e.target.value as Verbosity)}
          >
            <option value="kort">Kort</option>
            <option value="balansert">Balansert</option>
            <option value="utfyllende">Utfyllende</option>
          </select>
        </Field>
        <Field label="Språk">
          <input
            className={input}
            value={p.language}
            onChange={(e) => oppdater("language", e.target.value)}
            placeholder="norsk bokmål"
          />
        </Field>
        <Field label="Fast uttrykk">
          <input
            className={input}
            value={p.catchphrase}
            onChange={(e) => oppdater("catchphrase", e.target.value)}
            placeholder="Værsågod, sir."
          />
        </Field>
      </div>

      <Field label="Bakgrunn / historie">
        <textarea
          className={textarea}
          value={p.background}
          onChange={(e) => oppdater("background", e.target.value)}
          placeholder="Kort bakgrunn som påvirker hvordan AI-en uttrykker seg..."
        />
      </Field>

      <Field label="Særtrekk (én per linje)">
        <textarea
          className={textarea}
          value={p.quirks}
          onChange={(e) => oppdater("quirks", e.target.value)}
          placeholder="- snakker presist&#10;- bruker korte statusoppsummeringer"
        />
      </Field>

      <Field label="Ekstra instruksjoner">
        <textarea
          className={textarea}
          value={p.extra}
          onChange={(e) => oppdater("extra", e.target.value)}
          placeholder="Eventuelle ekstra regler for svarene..."
        />
      </Field>

      <div className="flex items-center justify-between gap-3 border-t border-primary/10 pt-3">
        <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
          Forhåndsvis systemprompt
        </span>
        <button type="button" onClick={lagre} className={btn}>
          Lagre personlighet
        </button>
      </div>

      <pre className="max-h-[160px] overflow-auto rounded-md border border-primary/10 bg-background/30 p-2 text-[9px] leading-relaxed text-foreground/70">
        {buildPreview(config.personality ?? defaultPersonality(), p)}
      </pre>
    </div>
  );
}

function buildPersonaLine(p: PersonalityConfig): string {
  return `${p.name} – ${p.role}. Svar på ${p.language}, tone: ${p.tone}.`;
}

function buildPreview(lagret: PersonalityConfig, redigert: PersonalityConfig): string {
  const quirks = redigert.quirks
    .split("\n")
    .map((q) => q.trim())
    .filter(Boolean);
  return [
    `Du er ${redigert.name}, ${redigert.role}.`,
    `Svar på ${redigert.language}.`,
    `Tone: ${redigert.tone}.`,
    `Detaljnivå: ${redigert.verbosity}.`,
    redigert.background,
    quirks.length ? `Særtrekk:\n${quirks.map((q) => `- ${q}`).join("\n")}` : "",
    redigert.catchphrase ? `Faste uttrykk: «${redigert.catchphrase}».` : "",
    redigert.extra,
    "",
    lagret.name === redigert.name && lagret.catchphrase === redigert.catchphrase
      ? "(endringer lagres først når du klikker 'Lagre personlighet')"
      : "(ikke lagret enda)",
  ]
    .filter(Boolean)
    .join("\n\n");
}
