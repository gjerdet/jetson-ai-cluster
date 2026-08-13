import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SANDBOX = process.env.SANDBOX || os.tmpdir();

export function runPing({ host, count = 2, timeout = 5 }) {
  const safeHost = String(host ?? "").trim();
  if (!safeHost) throw new Error("Mangler host.");
  const safeCount = Math.max(1, Math.min(Number(count) || 2, 30));
  const safeTimeout = Math.max(1, Math.min(Number(timeout) || 5, 30));

  const tmp = path.join(SANDBOX, `_ping_${Date.now()}.sh`);
  const script = [
    "#!/usr/bin/env bash",
    "set -u",
    'HOST="' + safeHost.replace(/"/g, '\\"') + '"',
    'COUNT="' + String(safeCount) + '"',
    'TIMEOUT="' + String(safeTimeout) + '"',
    'if [ -z "$HOST" ]; then echo "Mangler host"; exit 2; fi',
    'if ping -c"$COUNT" -W"$TIMEOUT" "$HOST" >/dev/null 2>&1; then',
    '  echo "ICMP_OK"',
    "  exit 0",
    "fi",
    'echo "ICMP_FAIL"',
    'for PORT in 443 80 8443 22 1883 8080; do',
    '  if (echo >/dev/tcp/$HOST/$PORT) >/dev/null 2>&1; then',
    '    echo "TCP_OK $PORT"',
    "    exit 0",
    "  fi",
    "done",
    'echo "TCP_FAIL"',
    "exit 1",
  ].join("\n") + "\n";

  fs.writeFileSync(tmp, script, "utf8");
  try {
    const r = execSync(`bash "${tmp}"`, {
      shell: true,
      cwd: SANDBOX,
      encoding: "utf8",
      timeout: Math.max((safeTimeout + 2) * 1000, 2000),
    });
    const stdout = (r || "").trim();
    return {
      host: safeHost,
      ok: stdout.includes("ICMP_OK") || stdout.includes("TCP_OK"),
      code: 0,
      timedOut: false,
      ms: 0,
      stdout: stdout,
      stderr: "",
    };
  } catch (e) {
    const stdout = (e.stdout || "").trim();
    const stderr = (e.stderr || "").trim();
    return {
      host: safeHost,
      ok: stdout.includes("ICMP_OK") || stdout.includes("TCP_OK"),
      code: e.status ?? 1,
      timedOut: e.signal === "SIGTERM" || false,
      ms: 0,
      stdout: stdout,
      stderr: stderr,
    };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}
