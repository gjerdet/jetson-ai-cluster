/**
 * Enkel reverse proxy fra agent-porten til det bygde web-GUI-et.
 *
 * Bakgrunn: agenten lytter på 8443 (TLS) mens GUI-serveren (jarvis-gui) kjører
 * på 8080. Går man til https://<jetson>:8443 i nettleseren fikk man rå JSON.
 * Nå videresendes alt som ikke er agent-/API-ruter til GUI-serveren, slik at
 * én adresse gir både HUD og API.
 */
import http from "node:http";

const GUI_HOST = process.env.JARVIS_GUI_HOST || "127.0.0.1";
const GUI_PORT = Number(process.env.JARVIS_GUI_PORT || 8080);
export const GUI_PROXY_AKTIV = process.env.JARVIS_GUI_PROXY !== "0";

/** Ruter som agenten selv eier – disse skal aldri proxes. */
const AGENT_RUTER = new Set([
  "/",
  "/health",
  "/exec",
  "/script",
  "/nett/sjekk",
  "/nett/skann",
]);

export function skalProxes(route, req) {
  if (!GUI_PROXY_AKTIV) return false;
  if (route.startsWith("/api") || route === "/auth" || route.startsWith("/auth/")) return false;
  if (AGENT_RUTER.has(route)) {
    // Rot-ruten er nyttigere som GUI i nettleseren; JSON-status ligger på /health.
    if (route === "/" && req.method === "GET" && (req.headers.accept || "").includes("text/html")) return true;
    return false;
  }
  return true;
}

export function proxyTilGui(req, res) {
  const opts = {
    host: GUI_HOST,
    port: GUI_PORT,
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: `${GUI_HOST}:${GUI_PORT}` },
  };
  const upstream = http.request(opts, (svar) => {
    res.writeHead(svar.statusCode || 502, svar.headers);
    svar.pipe(res);
  });
  upstream.on("error", (err) => {
    if (res.headersSent) return res.end();
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(
      `Web-GUI-et svarer ikke på http://${GUI_HOST}:${GUI_PORT} (${err.message}).\n` +
        "Sjekk: sudo systemctl status jarvis-gui\n",
    );
  });
  req.pipe(upstream);
}
