/**
 * Jarvis bakgrunnsmotor
 * ---------------------
 * Egen prosess som kjører initiativ- og selvlæringsarbeidet uavhengig av
 * web-backenden. Da fortsetter Jarvis å lære, rydde og teste seg selv selv om
 * GUI-et er lukket eller backenden startes på nytt.
 *
 * Deler data med backenden gjennom AGENT_DATA (JSON-dokumenter + kunnskap.db).
 * Av/på-bryteren i GUI-et skrives til data/motor.json og leses her hvert minutt.
 *
 * Start:  JARVIS_MOTOR_PROSESS=1 node motor.mjs
 */
process.env.JARVIS_MOTOR_PROSESS = "1";

import { initStore, warmLatest, flushNow } from "./lib/store.mjs";
import { start as startInitiative, stop as stopInitiative, isActive } from "./lib/initiative.mjs";

const INTERVALL = Number(process.env.JARVIS_MOTOR_INTERVALL_MS || 60_000);

await initStore();
await warmLatest();

startInitiative(INTERVALL);

console.log(`[jarvis-motor] bakgrunnsmotor startet (pid ${process.pid}, tikk hvert ${Math.round(INTERVALL / 1000)}. sek)`);
console.log(`[jarvis-motor] autonomi er ${isActive() ? "på" : "av"} – styres fra GUI-et under SYSTEM.`);

// Skriv ventende endringer til disk jevnlig, så backenden ser dem.
const lagring = setInterval(() => flushNow(), 15_000);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[jarvis-motor] avslutter (${sig})`);
    clearInterval(lagring);
    stopInitiative();
    flushNow();
    process.exit(0);
  });
}

process.on("unhandledRejection", (e) => console.error("[jarvis-motor] ubehandlet feil:", e?.message || e));
process.on("uncaughtException", (e) => console.error("[jarvis-motor] uventet feil:", e?.message || e));
