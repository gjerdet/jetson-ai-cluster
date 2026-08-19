// Stemme for JARVIS — kjører 100 % lokalt i nettleseren via Web Speech API.
// Velger automatisk den mest «Jarvis-aktige» stemmen: britisk engelsk mann,
// litt lav tonehøyde og rolig tempo (Iron Man-butler).

import { ROUTES } from "@/lib/contract";

const NØKKEL = "jarvis.voice";

export type VoiceEngine = "browser" | "piper" | "backend";

export type VoiceConfig = {
  på: boolean;
  engine: VoiceEngine;
  rate: number; // 0.5 – 2
  pitch: number; // 0 – 2
  volume: number; // 0 – 1
  voiceURI?: string; // overstyr automatisk valg (nettleser)
  piperUrl?: string; // f.eks. http://jetson.local:5000/api/tts
  piperVoice?: string; // modellnavn, f.eks. en_GB-alan-medium
};

export const STANDARD_VOICE: VoiceConfig = {
  på: false,
  engine: "browser",
  rate: 0.94,
  pitch: 0.82,
  volume: 1,
  piperUrl: "http://localhost:5000/api/tts",
  piperVoice: "en_GB-alan-medium",
};


export function loadVoiceConfig(): VoiceConfig {
  if (typeof localStorage === "undefined") return STANDARD_VOICE;
  try {
    const raw = localStorage.getItem(NØKKEL);
    return raw ? { ...STANDARD_VOICE, ...(JSON.parse(raw) as Partial<VoiceConfig>) } : STANDARD_VOICE;
  } catch {
    return STANDARD_VOICE;
  }
}

export function saveVoiceConfig(c: VoiceConfig) {
  try {
    localStorage.setItem(NØKKEL, JSON.stringify(c));
  } catch {
    /* ignorer */
  }
}

export function voiceSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function listVoices(): SpeechSynthesisVoice[] {
  if (!voiceSupported()) return [];
  return window.speechSynthesis.getVoices();
}

// Rangering: kjente britiske mannsstemmer først, deretter en-GB, så en-*
const FORETRUKNE = [
  "daniel",
  "arthur",
  "google uk english male",
  "microsoft ryan",
  "microsoft george",
  "oliver",
  "james",
  "en-gb-standard-b",
];

export function pickJarvisVoice(
  voices: SpeechSynthesisVoice[],
  ønsket?: string,
): SpeechSynthesisVoice | undefined {
  if (!voices.length) return undefined;
  if (ønsket) {
    const valgt = voices.find((v) => v.voiceURI === ønsket);
    if (valgt) return valgt;
  }
  const poeng = (v: SpeechSynthesisVoice) => {
    const navn = v.name.toLowerCase();
    const idx = FORETRUKNE.findIndex((f) => navn.includes(f));
    let p = idx >= 0 ? 100 - idx : 0;
    if (v.lang.toLowerCase().startsWith("en-gb")) p += 40;
    else if (v.lang.toLowerCase().startsWith("en")) p += 10;
    if (/female|kvinne|samantha|zira|karen|serena/.test(navn)) p -= 30;
    if (/male|mann/.test(navn)) p += 15;
    if (v.localService) p += 5;
    return p;
  };
  return [...voices].sort((a, b) => poeng(b) - poeng(a))[0];
}

// Rydder bort markdown, kodeblokker, emoji og HUD-etiketter før opplesning
export function tekstForTale(t: string, maks = 700): string {
  const ren = t
    .replace(/```[\s\S]*?```/g, " kodeblokk utelatt. ")
    .replace(/\[TOOL[^\]]*\]/gi, " ")
    .replace(/https?:\/\/\S+/g, " lenke ")
    .replace(/[*_#`>|]/g, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return ren.length > maks ? `${ren.slice(0, maks)}…` : ren;
}

let piperAudio: HTMLAudioElement | null = null;

export function stopSpeak() {
  if (voiceSupported()) window.speechSynthesis.cancel();
  if (piperAudio) {
    piperAudio.pause();
    piperAudio.src = "";
    piperAudio = null;
  }
}

// Piper kjører lokalt på Jetson (piper-http / wyoming-piper med HTTP-fasade)
export async function speakPiper(text: string, cfg: VoiceConfig) {
  const url = (cfg.piperUrl ?? "").trim();
  if (!url) throw new Error("Mangler piper-URL");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: cfg.piperVoice, speaker_id: 0, length_scale: 1 / cfg.rate }),
  });
  if (!res.ok) throw new Error(`Piper svarte ${res.status}`);
  const blob = await res.blob();
  stopSpeak();
  const lyd = new Audio(URL.createObjectURL(blob));
  lyd.volume = cfg.volume;
  piperAudio = lyd;
  await lyd.play();
}

// Går via den lokale Jarvis-agenten (/api/tts/tale), som snakker med Piper.
export async function speakBackend(text: string, cfg: VoiceConfig) {
  const { backendUrl, backendToken } = await import("@/lib/backend");
  const token = backendToken();
  const res = await fetch(`${backendUrl()}/api${ROUTES.tts}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ tekst: text, modell: cfg.piperVoice, lengthScale: 1 / cfg.rate }),
  });
  if (!res.ok) {
    const raw = await res.text();
    let detalj = raw;
    try {
      const parsed = JSON.parse(raw) as { error?: string; message?: string };
      detalj = parsed.error || parsed.message || raw;
    } catch {
      // Piper/backend kan svare med ren tekst.
    }
    throw new Error(`Backend svarte ${res.status}${detalj ? `: ${detalj.slice(0, 300)}` : ""}`);
  }
  const blob = await res.blob();
  stopSpeak();
  const lyd = new Audio(URL.createObjectURL(blob));
  lyd.volume = cfg.volume;
  piperAudio = lyd;
  await lyd.play();
}

export function speakBrowser(text: string, cfg: VoiceConfig) {
  if (!voiceSupported()) return;
  stopSpeak();
  const ytring = new SpeechSynthesisUtterance(text);
  const stemme = pickJarvisVoice(listVoices(), cfg.voiceURI);
  if (stemme) {
    ytring.voice = stemme;
    ytring.lang = stemme.lang;
  }
  ytring.rate = cfg.rate;
  ytring.pitch = cfg.pitch;
  ytring.volume = cfg.volume;
  window.speechSynthesis.speak(ytring);
}

export function speak(text: string, cfg: VoiceConfig = loadVoiceConfig()) {
  if (!cfg.på) return;
  const ren = tekstForTale(text);
  if (!ren) return;
  if (cfg.engine === "piper") {
    void speakPiper(ren, cfg).catch(() => speakBrowser(ren, cfg));
    return;
  }
  if (cfg.engine === "backend") {
    void speakBackend(ren, cfg).catch(() => speakBrowser(ren, cfg));
    return;
  }
  speakBrowser(ren, cfg);
}


// Noen nettlesere laster stemmelista asynkront
export function onVoicesReady(cb: () => void) {
  if (!voiceSupported()) return () => {};
  const h = () => cb();
  window.speechSynthesis.addEventListener("voiceschanged", h);
  if (listVoices().length) cb();
  return () => window.speechSynthesis.removeEventListener("voiceschanged", h);
}
