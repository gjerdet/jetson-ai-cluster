import { useCallback, useEffect, useState } from "react";
import {
  backend,
  backendUrl,
  backendToken,
  setBackendUrl,
  type BackendRule,
  type BackendStatus,
  type BackendUser,
  type RuleEvent,
  type SampleSummary,
} from "@/lib/backend";

const field =
  "w-full rounded-full border border-primary/20 bg-primary/[0.04] px-4 py-2 text-xs text-foreground/90 outline-none transition focus:border-primary/50";
const btn =
  "rounded-full border border-primary/25 bg-primary/[0.06] px-4 py-1.5 text-[10px] uppercase tracking-[0.2em] text-primary/80 transition hover:bg-primary/15";
const label = "text-[9px] uppercase tracking-[0.25em] text-foreground/40";

/** BACKEND-fane: innlogging, MQTT-lytter, regelmotor, Telegram og historikk – alt lokalt på Jetson. */
export function BackendPanel() {
  const [url, setUrl] = useState(backendUrl());
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [user, setUser] = useState<BackendUser | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [epost, setEpost] = useState("");
  const [passord, setPassord] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setFeil(null);
    try {
      const s = await backend.status();
      setStatus(s);
      if (backendToken()) {
        try {
          setUser(await backend.me());
        } catch {
          setUser(null);
        }
      }
    } catch (e) {
      setStatus(null);
      setFeil(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const auth = async (mode: "login" | "register") => {
    setBusy(true);
    setFeil(null);
    try {
      setUser(mode === "login" ? await backend.login(epost, passord) : await backend.register(epost, passord));
      setPassord("");
      await refresh();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className={label}>LOKAL BACKEND (JETSON)</div>
        <div className="flex gap-2">
          <input
            className={field}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://192.168.1.50:8787"
          />
          <button
            className={btn}
            onClick={() => {
              setBackendUrl(url);
              void refresh();
            }}
          >
            KOBLE
          </button>
        </div>
        {feil ? <div className="text-[10px] text-destructive/80">{feil}</div> : null}
        {status ? (
          <div className="grid grid-cols-2 gap-2 text-[10px] text-foreground/60 sm:grid-cols-4">
            <Stat k="VERT" v={status.vert} />
            <Stat k="OPPETID" v={`${Math.round(status.oppetidSek / 60)} min`} />
            <Stat k="MQTT" v={status.mqtt.tilkoblet ? "TILKOBLET" : "AV"} />
            <Stat k="REGLER" v={`${status.regler.aktive}/${status.regler.antall}`} />
          </div>
        ) : null}
      </section>

      {!user ? (
        <section className="space-y-2">
          <div className={label}>{status?.trengerOppsett ? "OPPRETT FØRSTE BRUKER (ADMIN)" : "INNLOGGING"}</div>
          <input className={field} placeholder="e-post" value={epost} onChange={(e) => setEpost(e.target.value)} />
          <input
            className={field}
            type="password"
            placeholder="passord"
            value={passord}
            onChange={(e) => setPassord(e.target.value)}
          />
          <div className="flex gap-2">
            <button className={btn} disabled={busy} onClick={() => void auth(status?.trengerOppsett ? "register" : "login")}>
              {status?.trengerOppsett ? "OPPRETT" : "LOGG INN"}
            </button>
            {user ? null : (
              <button className={btn} disabled={busy} onClick={() => void auth("register")}>
                NY BRUKER
              </button>
            )}
          </div>
        </section>
      ) : (
        <>
          <div className="flex items-center justify-between text-[10px] text-foreground/60">
            <span>
              Innlogget som <span className="text-primary/80">{user.email}</span> ({user.role})
            </span>
            <button
              className={btn}
              onClick={async () => {
                await backend.logout();
                setUser(null);
              }}
            >
              LOGG UT
            </button>
          </div>
          <MqttSection onChange={refresh} />
          <RulesSection />
          <TelegramSection />
          <HistorySection />
          <EventLog events={status?.regler.sisteHendelser ?? []} />
        </>
      )}
    </div>
  );
}

const Stat = ({ k, v }: { k: string; v: string }) => (
  <div className="rounded-2xl border border-primary/10 bg-primary/[0.03] px-3 py-2">
    <div className="text-[8px] uppercase tracking-[0.25em] text-foreground/35">{k}</div>
    <div className="text-primary/80">{v}</div>
  </div>
);

function MqttSection({ onChange }: { onChange: () => void }) {
  const [cfg, setCfg] = useState({ url: "mqtt://127.0.0.1:1883", topics: "#", enabled: false });
  useEffect(() => {
    backend
      .hentMqtt()
      .then((m) => setCfg({ url: m.url, topics: (m.topics ?? ["#"]).join(", "), enabled: !!m.enabled }))
      .catch(() => {});
  }, []);
  return (
    <section className="space-y-2">
      <div className={label}>MQTT-LYTTER (DØGNDRIFT)</div>
      <input className={field} value={cfg.url} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} />
      <input
        className={field}
        value={cfg.topics}
        onChange={(e) => setCfg({ ...cfg, topics: e.target.value })}
        placeholder="emner, kommaseparert"
      />
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-[10px] text-foreground/60">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
          />
          AKTIV
        </label>
        <button
          className={btn}
          onClick={async () => {
            await backend.lagreMqtt({
              url: cfg.url,
              topics: cfg.topics.split(",").map((t) => t.trim()).filter(Boolean),
              enabled: cfg.enabled,
            });
            onChange();
          }}
        >
          LAGRE
        </button>
      </div>
    </section>
  );
}

const tomRegel = (): BackendRule => ({
  navn: "Ny regel",
  aktiv: true,
  emne: "",
  operator: "over",
  verdi: "",
  pauseSek: 300,
  handlinger: [{ type: "telegram", tekst: "{regel}: {emne} = {verdi}" }],
});

function RulesSection() {
  const [regler, setRegler] = useState<BackendRule[]>([]);
  useEffect(() => {
    backend.hentRegler().then((r) => setRegler(r.regler)).catch(() => {});
  }, []);
  const patch = (i: number, p: Partial<BackendRule>) =>
    setRegler(regler.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <div className={label}>REGELMOTOR</div>
        <div className="flex gap-2">
          <button className={btn} onClick={() => setRegler([...regler, tomRegel()])}>
            + REGEL
          </button>
          <button className={btn} onClick={() => void backend.lagreRegler(regler)}>
            LAGRE
          </button>
        </div>
      </div>
      {regler.map((r, i) => (
        <div key={r.id ?? i} className="space-y-2 rounded-2xl border border-primary/10 bg-primary/[0.03] p-3">
          <div className="flex gap-2">
            <input className={field} value={r.navn} onChange={(e) => patch(i, { navn: e.target.value })} />
            <button className={btn} onClick={() => setRegler(regler.filter((_, idx) => idx !== i))}>
              SLETT
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <input className={field} placeholder="emne" value={r.emne} onChange={(e) => patch(i, { emne: e.target.value })} />
            <select
              className={field}
              value={r.operator}
              onChange={(e) => patch(i, { operator: e.target.value as BackendRule["operator"] })}
            >
              <option value="over">over</option>
              <option value="under">under</option>
              <option value="lik">lik</option>
              <option value="endres">endres</option>
            </select>
            <input
              className={field}
              placeholder="verdi"
              value={String(r.verdi)}
              onChange={(e) => patch(i, { verdi: e.target.value })}
            />
            <input
              className={field}
              type="number"
              value={r.pauseSek}
              onChange={(e) => patch(i, { pauseSek: Number(e.target.value) })}
            />
          </div>
          {r.handlinger.map((h, hi) => (
            <div key={hi} className="grid grid-cols-3 gap-2">
              <select
                className={field}
                value={h.type}
                onChange={(e) =>
                  patch(i, {
                    handlinger: r.handlinger.map((x, xi) =>
                      xi === hi ? { ...x, type: e.target.value as "mqtt" | "telegram" | "logg" } : x,
                    ),
                  })
                }
              >
                <option value="telegram">telegram</option>
                <option value="mqtt">mqtt</option>
                <option value="logg">logg</option>
              </select>
              <input
                className={field}
                placeholder={h.type === "mqtt" ? "emne" : "—"}
                value={h.emne ?? ""}
                onChange={(e) =>
                  patch(i, {
                    handlinger: r.handlinger.map((x, xi) => (xi === hi ? { ...x, emne: e.target.value } : x)),
                  })
                }
              />
              <input
                className={field}
                placeholder="tekst / payload"
                value={h.type === "mqtt" ? (h.payload ?? "") : (h.tekst ?? "")}
                onChange={(e) =>
                  patch(i, {
                    handlinger: r.handlinger.map((x, xi) =>
                      xi === hi
                        ? h.type === "mqtt"
                          ? { ...x, payload: e.target.value }
                          : { ...x, tekst: e.target.value }
                        : x,
                    ),
                  })
                }
              />
            </div>
          ))}
          <label className="flex items-center gap-2 text-[10px] text-foreground/50">
            <input type="checkbox" checked={r.aktiv} onChange={(e) => patch(i, { aktiv: e.target.checked })} />
            AKTIV
          </label>
        </div>
      ))}
    </section>
  );
}

function TelegramSection() {
  const [cfg, setCfg] = useState({ enabled: false, token: "", chatIds: "", allowlist: true });
  const [melding, setMelding] = useState<string | null>(null);
  useEffect(() => {
    backend
      .hentTelegram()
      .then((t) => setCfg({ enabled: t.enabled, token: t.token, chatIds: (t.chatIds ?? []).join(", "), allowlist: t.allowlist !== false }))
      .catch(() => {});
  }, []);
  return (
    <section className="space-y-2">
      <div className={label}>TELEGRAM-BOT</div>
      <input
        className={field}
        placeholder="bot-token fra @BotFather"
        value={cfg.token}
        onChange={(e) => setCfg({ ...cfg, token: e.target.value })}
      />
      <input
        className={field}
        placeholder="godkjente chat-ID-er (send /start til boten)"
        value={cfg.chatIds}
        onChange={(e) => setCfg({ ...cfg, chatIds: e.target.value })}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[10px] text-foreground/60">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
          AKTIV
        </label>
        <button
          className={btn}
          onClick={async () => {
            await backend.lagreTelegram({
              enabled: cfg.enabled,
              token: cfg.token,
              allowlist: cfg.allowlist,
              chatIds: cfg.chatIds
                .split(",")
                .map((s) => Number(s.trim()))
                .filter((n) => Number.isFinite(n) && n !== 0),

            });
            setMelding("Lagret.");
          }}
        >
          LAGRE
        </button>
        <button
          className={btn}
          onClick={async () => {
            try {
              await backend.testTelegram("Test fra Jarvis HUD.");
              setMelding("Testmelding sendt.");
            } catch (e) {
              setMelding(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          TEST
        </button>
        {melding ? <span className="text-[10px] text-foreground/50">{melding}</span> : null}
      </div>
    </section>
  );
}

function HistorySection() {
  const [rows, setRows] = useState<SampleSummary[]>([]);
  useEffect(() => {
    backend
      .maalinger({ fra: Date.now() - 24 * 3600_000 })
      .then((r) => setRows(r.oppsummering))
      .catch(() => {});
  }, []);
  return (
    <section className="space-y-2">
      <div className={label}>SENSORHISTORIKK (24T)</div>
      {rows.length === 0 ? (
        <div className="text-[10px] text-foreground/40">Ingen målinger lagret ennå.</div>
      ) : (
        <div className="max-h-52 space-y-1 overflow-y-auto">
          {rows.map((r) => (
            <div
              key={r.emne}
              className="flex items-center justify-between rounded-xl border border-primary/10 bg-primary/[0.03] px-3 py-1.5 text-[10px]"
            >
              <span className="text-foreground/70">{r.emne}</span>
              <span className="text-primary/70">
                {r.siste} · min {r.min} · maks {r.maks} · snitt {Math.round(r.snitt * 100) / 100} · n={r.antall}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EventLog({ events }: { events: RuleEvent[] }) {
  if (!events.length) return null;
  return (
    <section className="space-y-2">
      <div className={label}>SISTE REGELHENDELSER</div>
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {events.map((e) => (
          <div key={e.id} className="rounded-xl border border-primary/10 bg-primary/[0.03] px-3 py-1.5 text-[10px] text-foreground/60">
            <span className="text-primary/70">{new Date(e.tid).toLocaleTimeString("nb-NO")}</span> · {e.regel} ·{" "}
            {e.emne} = {String(e.verdi)} → {e.handling}
            {e.feil ? <span className="text-destructive/80"> · {e.feil}</span> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
