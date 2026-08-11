import type { HudConfig } from "./hud-store";
import { agentCfg, agentRun, agentWriteScript, type ExecResult } from "./local-agent";

/** Én forventning malen må innfri i selvtesten før skriptet regnes som trygt å kjøre. */
export type TemplateCheck = {
  label: string;
  /** Sjekker resultatet av selvtest-kjøringen. */
  test: (r: ExecResult) => boolean;
};

export type TemplateParam = {
  key: string;
  label: string;
  value: string;
  hint?: string;
};

export type ScriptTemplate = {
  id: string;
  name: string;
  summary: string;
  lang: "bash" | "python" | "node";
  file: string;
  params: TemplateParam[];
  /** Bygger skriptinnholdet. Skriptet skal støtte `--selftest` uten sideeffekter. */
  body: (p: Record<string, string>) => string;
  checks: TemplateCheck[];
};

const ok0 = (label = "avslutter med kode 0"): TemplateCheck => ({
  label,
  test: (r) => r.code === 0 && !r.timedOut,
});
const has = (needle: string, label?: string): TemplateCheck => ({
  label: label ?? `stdout inneholder «${needle}»`,
  test: (r) => (r.stdout ?? "").includes(needle),
});
const fast = (ms: number): TemplateCheck => ({
  label: `bruker under ${ms} ms`,
  test: (r) => (r.ms ?? 0) < ms,
});
const noStderr: TemplateCheck = {
  label: "ingen feil på stderr",
  test: (r) => !(r.stderr ?? "").trim(),
};

export const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  {
    id: "service-start",
    name: "Service-start",
    summary: "Starter (eller restarter) en systemd-tjeneste og verifiserer at den er aktiv.",
    lang: "bash",
    file: "service-start.sh",
    params: [
      { key: "tjeneste", label: "tjeneste", value: "ollama", hint: "systemd unit-navn" },
      { key: "ventSek", label: "vent (sek)", value: "5" },
    ],
    body: (p) => `#!/usr/bin/env bash
set -uo pipefail
SERVICE="\${SERVICE:-${p["tjeneste"]}}"
WAIT="\${WAIT:-${p["ventSek"]}}"

if [ "\${1:-}" = "--selftest" ]; then
  echo "SELVTEST: service-start"
  [ -n "$SERVICE" ] && echo "OK tjenestenavn: $SERVICE" || { echo "FEIL: tomt tjenestenavn"; exit 1; }
  command -v systemctl >/dev/null 2>&1 && echo "OK systemctl finnes" || echo "ADVARSEL: systemctl mangler"
  case "$WAIT" in ''|*[!0-9]*) echo "FEIL: ugyldig ventetid"; exit 1;; *) echo "OK ventetid: $WAIT s";; esac
  echo "SELVTEST FULLFORT"
  exit 0
fi

echo "Starter $SERVICE …"
systemctl restart "$SERVICE" || systemctl start "$SERVICE"
sleep "$WAIT"
systemctl is-active --quiet "$SERVICE" && echo "AKTIV: $SERVICE" || { echo "FEIL: $SERVICE er ikke aktiv"; systemctl status "$SERVICE" --no-pager | head -20; exit 1; }
`,
    checks: [ok0(), has("SELVTEST FULLFORT"), has("OK tjenestenavn"), fast(10000)],
  },
  {
    id: "docker-health",
    name: "Docker healthcheck",
    summary: "Sjekker at en container kjører og er «healthy», og skriver ut siste logglinjer.",
    lang: "bash",
    file: "docker-health.sh",
    params: [
      { key: "container", label: "container", value: "ollama" },
      { key: "logglinjer", label: "logglinjer", value: "20" },
    ],
    body: (p) => `#!/usr/bin/env bash
set -uo pipefail
NAME="\${NAME:-${p["container"]}}"
LINES="\${LINES:-${p["logglinjer"]}}"

if [ "\${1:-}" = "--selftest" ]; then
  echo "SELVTEST: docker-health"
  [ -n "$NAME" ] && echo "OK containernavn: $NAME" || { echo "FEIL: tomt containernavn"; exit 1; }
  case "$LINES" in ''|*[!0-9]*) echo "FEIL: logglinjer må være tall"; exit 1;; *) echo "OK logglinjer: $LINES";; esac
  command -v docker >/dev/null 2>&1 && echo "OK docker finnes" || echo "ADVARSEL: docker mangler"
  echo "SELVTEST FULLFORT"
  exit 0
fi

STATE=$(docker inspect -f '{{.State.Status}}' "$NAME" 2>/dev/null || echo "mangler")
HEALTH=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}ingen{{end}}' "$NAME" 2>/dev/null || echo "ingen")
echo "Container: $NAME · status=$STATE · health=$HEALTH"
docker logs --tail "$LINES" "$NAME" 2>&1 | tail -n "$LINES"
[ "$STATE" = "running" ] || exit 1
[ "$HEALTH" = "unhealthy" ] && exit 1
exit 0
`,
    checks: [ok0(), has("SELVTEST FULLFORT"), has("OK containernavn"), fast(10000)],
  },
  {
    id: "logg-innhenting",
    name: "Logg-innhenting",
    summary: "Henter siste loggposter for en tjeneste og oppsummerer feil og advarsler.",
    lang: "bash",
    file: "logg-innhenting.sh",
    params: [
      { key: "tjeneste", label: "tjeneste", value: "jarvis-agent" },
      { key: "siden", label: "siden", value: "1 hour ago" },
      { key: "linjer", label: "maks linjer", value: "200" },
    ],
    body: (p) => `#!/usr/bin/env bash
set -uo pipefail
SERVICE="\${SERVICE:-${p["tjeneste"]}}"
SINCE="\${SINCE:-${p["siden"]}}"
LINES="\${LINES:-${p["linjer"]}}"

if [ "\${1:-}" = "--selftest" ]; then
  echo "SELVTEST: logg-innhenting"
  [ -n "$SERVICE" ] && echo "OK tjeneste: $SERVICE" || { echo "FEIL: tom tjeneste"; exit 1; }
  [ -n "$SINCE" ] && echo "OK tidsrom: $SINCE" || { echo "FEIL: tomt tidsrom"; exit 1; }
  case "$LINES" in ''|*[!0-9]*) echo "FEIL: linjer må være tall"; exit 1;; *) echo "OK linjer: $LINES";; esac
  command -v journalctl >/dev/null 2>&1 && echo "OK journalctl finnes" || echo "ADVARSEL: journalctl mangler"
  echo "SELVTEST FULLFORT"
  exit 0
fi

LOG=$(journalctl -u "$SERVICE" --since "$SINCE" -n "$LINES" --no-pager 2>&1)
echo "$LOG"
echo "---"
echo "Feil: $(printf '%s' "$LOG" | grep -ci 'error\\|failed\\|critical')"
echo "Advarsler: $(printf '%s' "$LOG" | grep -ci 'warn')"
`,
    checks: [ok0(), has("SELVTEST FULLFORT"), has("OK tidsrom"), fast(10000)],
  },
  {
    id: "disk-varsel",
    name: "Diskplass-varsel",
    summary: "Varsler når en monteringspunkt passerer en fyllgrense.",
    lang: "bash",
    file: "disk-varsel.sh",
    params: [
      { key: "sti", label: "sti", value: "/" },
      { key: "grense", label: "grense (%)", value: "85" },
    ],
    body: (p) => `#!/usr/bin/env bash
set -uo pipefail
PATH_TO_CHECK="\${PATH_TO_CHECK:-${p["sti"]}}"
LIMIT="\${LIMIT:-${p["grense"]}}"

if [ "\${1:-}" = "--selftest" ]; then
  echo "SELVTEST: disk-varsel"
  [ -n "$PATH_TO_CHECK" ] && echo "OK sti: $PATH_TO_CHECK" || { echo "FEIL: tom sti"; exit 1; }
  case "$LIMIT" in ''|*[!0-9]*) echo "FEIL: grense må være tall"; exit 1;; esac
  [ "$LIMIT" -ge 1 ] && [ "$LIMIT" -le 99 ] && echo "OK grense: $LIMIT%" || { echo "FEIL: grense utenfor 1-99"; exit 1; }
  echo "SELVTEST FULLFORT"
  exit 0
fi

USED=$(df -P "$PATH_TO_CHECK" | awk 'NR==2 {gsub("%","",$5); print $5}')
echo "Bruk på $PATH_TO_CHECK: $USED% (grense $LIMIT%)"
[ "$USED" -ge "$LIMIT" ] && { echo "VARSEL: over grensen"; exit 1; }
echo "OK"
`,
    checks: [ok0(), has("SELVTEST FULLFORT"), has("OK grense"), noStderr, fast(8000)],
  },
  {
    id: "gpu-telemetri",
    name: "GPU/Jetson-telemetri",
    summary: "Leser GPU-last, minne og temperatur og returnerer JSON.",
    lang: "python",
    file: "gpu-telemetri.py",
    params: [{ key: "runder", label: "runder", value: "1" }],
    body: (p) => `#!/usr/bin/env python3
import json, subprocess, sys, shutil

ROUNDS = int("${p["runder"]}" or 1)

def selftest():
    print("SELVTEST: gpu-telemetri")
    assert ROUNDS >= 1, "runder må være minst 1"
    print("OK runder:", ROUNDS)
    print("OK verktøy:", "nvidia-smi" if shutil.which("nvidia-smi") else "faller tilbake til /sys")
    print(json.dumps({"gpu": None, "dryrun": True}))
    print("SELVTEST FULLFORT")

def read():
    if shutil.which("nvidia-smi"):
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu",
             "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10).stdout.strip()
        vals = [v.strip() for v in out.split(",")]
        return {"gpu_pct": vals[0], "mem_used_mb": vals[1], "mem_total_mb": vals[2], "temp_c": vals[3]}
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            return {"temp_c": round(int(f.read().strip()) / 1000, 1)}
    except OSError as e:
        return {"error": str(e)}

if "--selftest" in sys.argv:
    selftest()
else:
    for _ in range(ROUNDS):
        print(json.dumps(read()))
`,
    checks: [
      ok0(),
      has("SELVTEST FULLFORT"),
      { label: "skriver gyldig JSON", test: (r) => /\{[\s\S]*"dryrun"[\s\S]*\}/.test(r.stdout ?? "") },
      fast(15000),
    ],
  },
  {
    id: "http-helsesjekk",
    name: "HTTP-helsesjekk",
    summary: "Pinger et lokalt endepunkt og verifiserer statuskode og svartid.",
    lang: "node",
    file: "http-helsesjekk.mjs",
    params: [
      { key: "url", label: "url", value: "http://127.0.0.1:11434/api/tags" },
      { key: "maksMs", label: "maks svartid (ms)", value: "3000" },
    ],
    body: (p) => `#!/usr/bin/env node
const URL_ = process.env.TARGET || ${JSON.stringify(p["url"])};
const MAX_MS = Number(process.env.MAX_MS || ${JSON.stringify(p["maksMs"])});

if (process.argv.includes("--selftest")) {
  console.log("SELVTEST: http-helsesjekk");
  try { new URL(URL_); console.log("OK url:", URL_); }
  catch { console.log("FEIL: ugyldig url"); process.exit(1); }
  if (!Number.isFinite(MAX_MS) || MAX_MS <= 0) { console.log("FEIL: ugyldig maks svartid"); process.exit(1); }
  console.log("OK maks svartid:", MAX_MS, "ms");
  console.log("SELVTEST FULLFORT");
  process.exit(0);
}

const t0 = Date.now();
try {
  const res = await fetch(URL_, { signal: AbortSignal.timeout(MAX_MS) });
  const ms = Date.now() - t0;
  console.log(\`\${URL_} → \${res.status} på \${ms} ms\`);
  process.exit(res.ok && ms <= MAX_MS ? 0 : 1);
} catch (e) {
  console.log("FEIL:", e?.message || e);
  process.exit(1);
}
`,
    checks: [ok0(), has("SELVTEST FULLFORT"), has("OK url"), fast(10000)],
  },
];

export const templateById = (id: string) => SCRIPT_TEMPLATES.find((t) => t.id === id);

export function renderTemplate(tpl: ScriptTemplate, overrides: Record<string, string> = {}): string {
  const p: Record<string, string> = {};
  for (const param of tpl.params) p[param.key] = (overrides[param.key] ?? param.value).trim() || param.value;
  return tpl.body(p);
}

export type TemplateTestResult = {
  passed: boolean;
  results: { label: string; ok: boolean }[];
  run: ExecResult;
};

/** Kjører malens innebygde `--selftest` i sandkassen og verifiserer forventningene. */
export async function testTemplate(
  config: HudConfig,
  tpl: ScriptTemplate,
  overrides: Record<string, string> = {},
): Promise<TemplateTestResult> {
  const cfg = agentCfg(config);
  const content = renderTemplate(tpl, overrides);
  const run = await agentRun(cfg, { lang: tpl.lang, content, args: ["--selftest"] });
  const results = tpl.checks.map((c) => ({ label: c.label, ok: !run.error && c.test(run) }));
  return { passed: results.every((r) => r.ok), results, run };
}

/** Verifiserer først, og lagrer bare i sandkassen hvis alle forventninger holder. */
export async function installTemplate(
  config: HudConfig,
  tpl: ScriptTemplate,
  overrides: Record<string, string> = {},
): Promise<{ test: TemplateTestResult; saved?: string }> {
  const test = await testTemplate(config, tpl, overrides);
  if (!test.passed) return { test };
  const cfg = agentCfg(config);
  const saved = await agentWriteScript(cfg, tpl.file, renderTemplate(tpl, overrides));
  return { test, saved: saved.name };
}

export function formatTemplateTest(tpl: ScriptTemplate, t: TemplateTestResult): string {
  const lines = [
    `Mal-test «${tpl.name}» (${tpl.lang}): ${t.passed ? "BESTÅTT" : "IKKE BESTÅTT"}`,
    ...t.results.map((r) => `${r.ok ? "✓" : "✗"} ${r.label}`),
  ];
  if (t.run.error) lines.push(`Feil: ${t.run.error}`);
  else if (t.run.stdout?.trim()) lines.push(`stdout:\n${t.run.stdout.trim().slice(0, 2000)}`);
  if (t.run.stderr?.trim()) lines.push(`stderr:\n${t.run.stderr.trim().slice(0, 1000)}`);
  return lines.join("\n");
}
