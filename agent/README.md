# Jarvis lokal agent

Liten Node-tjeneste som kjører på Jetson (eller Pi) og gir HUD-en **kontrollert** OS-tilgang:
hvitelistede kommandoer og en **sandkasse** der Jarvis kan skrive og teste egne skript.

Ingen npm-avhengigheter – kun Node 18+.

## Start

```bash
cd agent
AGENT_TOKEN="$(openssl rand -hex 24)" node server.mjs
```

Skriv ned tokenet – det limes inn i HUD-en under **SYSTEM → KOBLINGER → LOKAL AGENT**.

### Miljøvariabler

| Variabel | Standard | Betydning |
| --- | --- | --- |
| `AGENT_PORT` | `8787` | Port |
| `AGENT_HOST` | `0.0.0.0` | Lytteadresse |
| `AGENT_TOKEN` | *(tom)* | Bearer-token. **Sett den alltid.** |
| `AGENT_SANDBOX` | `./sandbox` | Mappen skript skrives og kjøres i |
| `AGENT_MAX_TIMEOUT` | `60000` | Maks kjøretid per kall (ms) |
| `AGENT_MAX_OUTPUT` | `200000` | Maks tegn output |
| `AGENT_ALLOW` | innebygd liste | Komma-separert hviteliste av kommandoer |
| `AGENT_ALLOW_WRITE` | `0` | `1` tillater `systemctl start/stop`, `docker run` osv. |
| `AGENT_ALLOW_NETWORK` | `1` | `0` setter blindvei-proxy for skript |

## Endepunkter

| Metode | Sti | Beskrivelse |
| --- | --- | --- |
| GET | `/health` | Status, last, minne, hviteliste |
| POST | `/exec` | `{ cmd, args[], timeoutMs }` – kun hvitelistede kommandoer |
| GET | `/scripts` | Lister filer i sandkassen |
| POST | `/scripts` | `{ name, content }` – lagrer skript |
| GET | `/scripts/:navn` | Leser skript |
| DELETE | `/scripts/:navn` | Sletter skript |
| POST | `/run` | `{ lang: bash\|python\|node, name?, content?, args[], timeoutMs }` – kjører i sandkassen |

## Sikkerhet

- Alt krever `Authorization: Bearer $AGENT_TOKEN`.
- Kun kommandoer i hvitelisten kan kjøres; `systemctl`, `journalctl` og `docker` er låst til
  lesende underkommandoer med mindre `AGENT_ALLOW_WRITE=1`.
- Skript kjøres med `cwd` og `HOME` satt til sandkassen, tom miljøkontekst og hard tidsgrense.
- Filnavn saneres, og stier utenfor sandkassen avvises.
- Kjør agenten som en **egen bruker med få rettigheter**, ikke root, og eksponer den kun på LAN.

Ekstra isolasjon (anbefalt hvis tilgjengelig):

```bash
# kjør hele agenten i en container med egen sandkasse-volum
docker run --rm -p 8787:8787 -e AGENT_TOKEN=... -v $PWD/sandbox:/app/sandbox \
  --read-only --tmpfs /tmp --memory 512m --pids-limit 128 node:20-alpine \
  node /app/server.mjs
```

## Autostart (systemd)

```ini
# /etc/systemd/system/jarvis-agent.service
[Unit]
Description=Jarvis lokal agent
After=network.target

[Service]
User=jarvis
WorkingDirectory=/opt/jarvis/agent
Environment=AGENT_TOKEN=ditt-token
Environment=AGENT_SANDBOX=/opt/jarvis/agent/sandbox
ExecStart=/usr/bin/node /opt/jarvis/agent/server.mjs
Restart=always
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/jarvis/agent/sandbox

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now jarvis-agent
```
