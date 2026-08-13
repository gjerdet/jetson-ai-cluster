/**
 * Automatisk oppgaveutfører for agenten.
 * Tar en plan, finner neste steg, utfører det via AI eller verktøy, og logger evaluering.
 */
import { listPlans, getPlan, nesteSteg, oppdaterSteg, markerPlanFerdig, loggPlan } from "./planner.mjs";
import { evaluateChatReply } from "./evaluator.mjs";
import { askAi, askJson } from "./ai.mjs";
import { runPing } from "./ping-tool.mjs";

export async function runPlanOnce(planId) {
  const plan = getPlan(planId);
  if (!plan || plan.status !== "aktiv") return { ok: false, error: "Plan ikke aktiv eller ikke funnet." };
  if (!plan.steg || plan.steg.length === 0) return { ok: false, error: "Planen har ingen steg." };

  const step = nesteSteg(plan);
  if (!step) {
    markerPlanFerdig(planId, { status: "fullført", oppsummering: "Alle steg fullført." });
    return { ok: true, ferdig: true, melding: "Plan fullført." };
  }

  loggPlan(planId, `Kjører steg ${step.id}: ${step.navn}`);
  oppdaterSteg(planId, step.id, { status: "aktiv" });

  let resultat = null;
  let evaluering = null;

  try {
    if (step.type === "verktøy") {
      const navn = (step.verktøy?.navn || step.beskrivelse || "").toLowerCase();
      if (navn.includes("ping")) {
        const host = String(step.verktøy?.args?.host || step.beskrivelse.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/)?.[0] || "192.168.1.1");
        const antall = Number(step.verktøy?.args?.antall || step.beskrivelse.match(/antall\s*:?\s*(\d+)/)?.[1] || 2);
        const timeout = Number(step.verktøy?.args?.timeout || step.beskrivelse.match(/timeout\s*:?\s*(\d+)/)?.[1] || 5);
        resultat = await runPing({ host, antall, timeout });
      } else {
        resultat = await askAi(`Kjør verktøy for: ${step.beskrivelse}. Beskriv hva du gjorde og resultatet.`, { temperature: 0.2 });
      }
    } else if (step.type === "sjekk") {
      resultat = await askAi(`Hent oppdatert data for: ${step.beskrivelse}. Svar konkret og faktabasert.`, { temperature: 0.2 });
    } else {
      resultat = await askAi(step.beskrivelse, { temperature: 0.4 });
    }

    try {
      evaluering = await evaluateChatReply({
        spørsmål: `${plan.mål} – steg ${step.id}`,
        svar: String(resultat),
        verktøy: step.type === "verktøy" ? [String(resultat).slice(0, 100)] : [],
      });
    } catch (e) {
      evaluering = { score: null, feil: String(e) };
    }

    oppdaterSteg(planId, step.id, { status: "fullført", resultat });
    loggPlan(planId, `Steg ${step.id} fullført. Evaluering: ${evaluering?.score ?? "?"}/10`);

    return {
      ok: true,
      steg: { id: step.id, navn: step.navn, resultat, evaluering },
    };
  } catch (e) {
    oppdaterSteg(planId, step.id, { status: "feilet", resultat: String(e) });
    loggPlan(planId, `Steg ${step.id} feilet: ${String(e)}`);
    return { ok: false, steg: { id: step.id, navn: step.navn, error: String(e) }, evaluering };
  }
}

export async function runPlanUntilDone(planId, maks = 10) {
  const results = [];
  for (let i = 0; i < maks; i++) {
    const r = await runPlanOnce(planId);
    results.push(r);
    if (!r.ok || r.ferdig) break;
  }
  return results;
}
