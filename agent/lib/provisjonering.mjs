/**
 * Automatisk innrullering av nye noder over SSH.
 *
 * HUD-en sender bare IP, brukernavn og passord. Agenten logger seg inn på
 * maskinen, installerer Ollama, henter modellene, åpner Ollama for LAN-et
 * og registrerer noden i klyngeregisteret – helt uten manuelle steg.
 *
 * Flere maskiner kan rulles ut samtidig (f.eks. seks Jetson-er på én gang);
 * hver får sin egen jobb med live logg som GUI-et poller.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const jobber = new Map(); // id -> jobb
const MAKS_JOBBER = 40;
const MAKS_LINJER = 400;

const rensIp = (v) => String(v || "").trim();
const gyldigVert = (v) => /^[a-zA-Z0-9._-]+$/.test(v) && v.length <= 253;

function nyJobb(vert, navn) {
  const jobb = {
    id: randomUUID().slice(0, 8),
    vert,
    navn,
    status: "venter", // venter | kjorer | ok | feil
    startet: Date.now(),
    ferdig: null,
    steg: "",
    feil: null,
    logg: [],
  };
  jobber.set(jobb.id, jobb);
  // Rydd de eldste jobbene så minnet ikke vokser.
  if (jobber.size > MAKS_JOBBER) {
    const eldst = [...jobber.values()].sort((a, b) => a.startet - b.startet)[0];
    if (eldst) jobber.delete(eldst.id);
  }
  return jobb;
}

function logg(jobb, linje) {
  for (const l of String(linje).split("\n")) {
    const t = l.replace(/\s+$/, "");
    if (!t) continue;
    jobb.logg.push({ tid: Date.now(), tekst: t });
    const m = /^::STEG::\s*(.+)$/.exec(t);
    if (m) jobb.steg = m[1];
  }
  if (jobb.logg.length > MAKS_LINJER) jobb.logg.splice(0, jobb.logg.length - MAKS_LINJER);
}

/** Bash-skriptet som kjøres på den nye maskinen (sendes inn på stdin). */
function bootstrap() {
  return `
set -euo pipefail
si() { echo "::STEG:: $*"; }

si "Kobler til $(hostname) som $(whoami)"
SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo -n"; fi

si "Installerer Ollama"
if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
else
  echo "Ollama finnes allerede"
fi

si "Åpner Ollama for nettverket"
$SUDO mkdir -p /etc/systemd/system/ollama.service.d
printf '[Service]\\nEnvironment="OLLAMA_HOST=0.0.0.0:11434"\\nEnvironment="OLLAMA_KEEP_ALIVE=30m"\\n' \\
  | $SUDO tee /etc/systemd/system/ollama.service.d/override.conf >/dev/null
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now ollama >/dev/null 2>&1 || echo "Klarte ikke starte ollama-tjenesten"
for i in $(seq 1 45); do curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done

si "Henter modeller: $JARVIS_MODELLER"
for m in $JARVIS_MODELLER; do
  echo "→ $m"
  ollama pull "$m" || echo "Klarte ikke hente $m"
done

si "Verifiserer at Ollama svarer på $JARVIS_IP:11434"
curl -fsS --max-time 10 "http://$JARVIS_IP:11434/api/tags" >/dev/null

si "Registrerer noden hos master"
LAST="{\\"id\\":\\"$JARVIS_NODE_ID\\",\\"name\\":\\"$JARVIS_NAVN\\",\\"baseUrl\\":\\"http://$JARVIS_IP:11434/v1\\",\\"model\\":\\"$JARVIS_HOVEDMODELL\\",\\"role\\":\\"$JARVIS_ROLLE\\",\\"duties\\":[$JARVIS_DUTIES],\\"weight\\":1,\\"enabled\\":true}"
curl -fsS --max-time 20 -X POST "$JARVIS_MASTER/api/noder/registrer" \\
  -H "content-type: application/json" \\
  -H "x-agent-token: $JARVIS_TOKEN" \\
  -d "$LAST"
echo
si "Ferdig"
`;
}

/** Kjører bootstrap-skriptet på én maskin over SSH. */
function kjor(jobb, { vert, bruker, passord, master, token, modeller, rolle, oppgaver, nodeId }) {
  return new Promise((resolve) => {
    const miljo = {
      JARVIS_IP: vert,
      JARVIS_NAVN: jobb.navn,
      JARVIS_NODE_ID: nodeId,
      JARVIS_MASTER: master,
      JARVIS_TOKEN: token,
      JARVIS_MODELLER: modeller.join(" "),
      JARVIS_HOVEDMODELL: modeller[0],
      JARVIS_ROLLE: rolle,
      JARVIS_DUTIES: oppgaver.map((o) => `\\"${o}\\"`).join(","),
    };
    const settEnv = Object.entries(miljo)
      .map(([k, v]) => `${k}=${JSON.stringify(String(v))}`)
      .join(" ");

    const sshArgs = [
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ConnectTimeout=15",
      "-o", "NumberOfPasswordPrompts=1",
      `${bruker}@${vert}`,
      `env ${settEnv} bash -s`,
    ];
    // sshpass lar oss bruke passordet fra GUI-et. Uten passord brukes SSH-nøkkel.
    const cmd = passord ? "sshpass" : "ssh";
    const args = passord ? ["-e", "ssh", ...sshArgs] : sshArgs;

    let barn;
    try {
      barn = spawn(cmd, args, {
        env: { ...process.env, ...(passord ? { SSHPASS: passord } : {}) },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      jobb.status = "feil";
      jobb.feil = String(e?.message || e);
      logg(jobb, jobb.feil);
      return resolve(jobb);
    }

    barn.on("error", (e) => {
      const t = String(e?.message || e);
      jobb.feil = t.includes("ENOENT") && passord
        ? "sshpass mangler på master. Installer med: sudo apt install -y sshpass"
        : t;
      logg(jobb, jobb.feil);
    });
    barn.stdout.on("data", (d) => logg(jobb, d.toString()));
    barn.stderr.on("data", (d) => logg(jobb, d.toString()));
    barn.stdin.end(bootstrap());

    const timer = setTimeout(() => barn.kill("SIGKILL"), 30 * 60_000);
    barn.on("close", (kode) => {
      clearTimeout(timer);
      jobb.ferdig = Date.now();
      if (kode === 0) {
        jobb.status = "ok";
        jobb.steg = "Noden er med i klyngen";
      } else {
        jobb.status = "feil";
        jobb.feil = jobb.feil || `SSH avsluttet med kode ${kode}`;
        if (kode === 5 || kode === 255) jobb.feil = jobb.feil + " – sjekk IP, brukernavn og passord.";
      }
      resolve(jobb);
    });
  });
}

/**
 * Starter innrullering av én eller flere maskiner.
 * `verter`: liste med IP-er/vertsnavn. Alt annet er felles for hele puljen.
 */
export function startProvisjonering({
  verter = [],
  bruker = "",
  passord = "",
  master = "",
  token = "",
  modeller = ["llama3.2:3b"],
  rolle = "worker",
  oppgaver = ["chat", "verktoy"],
  navnPrefiks = "NODE",
  parallelt = 3,
} = {}) {
  const liste = [...new Set(verter.map(rensIp).filter(Boolean))];
  if (!liste.length) throw new Error("Ingen IP-adresser oppgitt.");
  if (liste.length > 24) throw new Error("Maks 24 maskiner per pulje.");
  for (const v of liste) if (!gyldigVert(v)) throw new Error(`Ugyldig adresse: ${v}`);
  if (!/^[a-zA-Z0-9._-]{1,32}$/.test(bruker)) throw new Error("Ugyldig brukernavn.");
  if (!master) throw new Error("Mangler adressen til master (backend).");
  if (!token) throw new Error("AGENT_TOKEN er ikke satt på master – kan ikke registrere noder.");
  const mod = modeller.map((m) => String(m).trim()).filter((m) => /^[\w.\-:/]+$/.test(m));
  if (!mod.length) throw new Error("Oppgi minst én modell.");

  const jobbListe = liste.map((vert, i) => {
    const nr = String(i + 1).padStart(2, "0");
    return nyJobb(vert, `${navnPrefiks}-${nr}`);
  });

  // Kjør i puljer så vi ikke metter nettverket når seks Jetson-er henter modeller.
  (async () => {
    const kø = jobbListe.map((jobb, i) => ({ jobb, vert: liste[i] }));
    const arbeidere = Array.from({ length: Math.max(1, Math.min(parallelt, 6)) }, async () => {
      for (;;) {
        const neste = kø.shift();
        if (!neste) return;
        neste.jobb.status = "kjorer";
        neste.jobb.steg = "Kobler til over SSH";
        await kjor(neste.jobb, {
          vert: neste.vert,
          bruker,
          passord,
          master,
          token,
          modeller: mod,
          rolle,
          oppgaver,
          nodeId: `node-${neste.vert.replace(/[^a-zA-Z0-9]/g, "-")}`,
        });
      }
    });
    await Promise.all(arbeidere);
  })();

  return { jobber: jobbListe.map(offentlig) };
}

const offentlig = (j) => ({
  id: j.id,
  vert: j.vert,
  navn: j.navn,
  status: j.status,
  steg: j.steg,
  startet: j.startet,
  ferdig: j.ferdig,
  feil: j.feil,
  logg: j.logg.slice(-120),
});

export function hentJobber() {
  return [...jobber.values()].sort((a, b) => b.startet - a.startet).map(offentlig);
}

export function hentJobb(id) {
  const j = jobber.get(id);
  return j ? offentlig(j) : null;
}

export function tomJobber() {
  jobber.clear();
}
