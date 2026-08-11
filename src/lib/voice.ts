// Stemme for JARVIS — kjører 100 % lokalt i nettleseren via Web Speech API.
// Velger automatisk den mest «Jarvis-aktige» stemmen: britisk engelsk mann,
// litt lav tonehøyde og rolig tempo (Iron Man-butler).

const NØKKEL = "jarvis.voice";

export type VoiceEngine = "browser" | "piper";

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

export function stopSpeak() {
  if (!voiceSupported()) return;
  window.speechSynthesis.cancel();
}

export function speak(text: string, cfg: VoiceConfig = loadVoiceConfig()) {
  if (!voiceSupported() || !cfg.på) return;
  const ren = tekstForTale(text);
  if (!ren) return;
  stopSpeak();
  const ytring = new SpeechSynthesisUtterance(ren);
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

// Noen nettlesere laster stemmelista asynkront
export function onVoicesReady(cb: () => void) {
  if (!voiceSupported()) return () => {};
  const h = () => cb();
  window.speechSynthesis.addEventListener("voiceschanged", h);
  if (listVoices().length) cb();
  return () => window.speechSynthesis.removeEventListener("voiceschanged", h);
}
