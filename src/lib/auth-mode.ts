/**
 * Global bryter for innlogging i HUD-en.
 *
 * Satt til `false` mens systemet kjører i et lukket lokalt miljø:
 * ingen innloggingsside, ingen preview-gate, alle paneler snakker
 * direkte med backend-en. Sett til `true` for å slå innlogging på igjen
 * (og sett AGENT_KREV_INNLOGGING=1 på Jetson-agenten samtidig).
 */
export const KREV_INNLOGGING = false;

/** Lokal «bruker» som brukes når innlogging er slått av. */
export const LOKAL_BRUKER = {
  id: "lokal",
  email: "lokal@jarvis",
  role: "admin" as const,
  created: 0,
};
