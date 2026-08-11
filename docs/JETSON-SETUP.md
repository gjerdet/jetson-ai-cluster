# Oppsett av JARVIS HUD på NVIDIA Jetson Nano Super

Steg-for-steg-guide fra tomt system til kjørende HUD med lokal AI-modell.
Alt kjører lokalt på din egen maskin — ingen sky er nødvendig.

---

## 0. Forutsetninger

| Krav | Detaljer |
|---|---|
| Maskinvare | Jetson Orin Nano / Nano Super, minst 8 GB RAM anbefalt |
| OS | JetPack 6.x (Ubuntu 22.04) |
| Lagring | NVMe SSD anbefalt — modellene tar 5–20 GB |
| Nettverk | Fast IP eller DHCP-reservasjon på ruteren |

Finn IP-en til Jetson:

```sh
hostname -I
```

Noter den (f.eks. `192.168.1.50`). Den brukes flere steder under.

---

## 1. Grunnpakker

```sh
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl build-essential
```

## 2. Node.js 20+

Jetson sine apt-pakker er ofte for gamle. Bruk nvm:

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
node -v   # skal vise v20.x
```

## 3. Hent koden

Koble prosjektet til GitHub fra Lovable-editoren (**Plus (+) → GitHub → Connect project**), og deretter:

```sh
git clone <din-github-url> jarvis
cd jarvis
npm install
```

## 4. Start HUD-en

```sh
npm run dev -- --host
```

Åpne i nettleseren:

- På Jetson selv: `http://localhost:8080`
- Fra PC/mobil på samme nett: `http://192.168.1.50:8080`

For produksjon:

```sh
npm run build
npm run start   # eller: npm run preview
```

---

## 5. Installer lokal AI-modell (Ollama)

```sh
curl -fsSL https://ollama.com/install.sh | sh
```

La Ollama lytte på hele nettverket slik at HUD-en når den fra andre maskiner:

```sh
sudo systemctl edit ollama
```

Legg inn:

```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
```

Så:

```sh
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

Hent modeller (velg etter minne):

```sh
ollama pull llama3.2:3b      # rask, lett
ollama pull hermes3:8b       # sterk resonnering
ollama pull qwen2.5:7b       # god på verktøykall
```

Test:

```sh
curl http://localhost:11434/v1/models
```

---

## 6. Legg modellen inn i HUD-en

1. Klikk reaktoren i midten → **SYSTEM**.
2. Gå til fanen **MODELLER** → **legg til modell**.
3. Fyll inn:
   - **Navn**: `JETSON-01`
   - **Base URL**: `http://192.168.1.50:11434/v1`
   - **Modell**: `llama3.2:3b`
   - **Rolle**: `primær`
4. Skru den **på**.

Legg gjerne til en modell til med rolle **arbeider** (f.eks. `hermes3:8b`) — den brukes av evaluatoren til å score og forbedre svarene.

Sjekk resultatet i fanen **AGENTER**: der ser du alle agenter, roller og hvilke verktøy de har.

---

## 7. Flere Jetson-noder

Gjenta steg 1–5 på node nummer to, og legg den inn som en ny modell i **MODELLER** med rolle **arbeider**. Slå på **lastbalansering** under **SYSTEM** — kall fordeles da automatisk etter kø og svartid.

---

## 8. MQTT for smarthus (valgfritt)

HUD-en snakker MQTT over WebSocket. På Jetson:

```sh
sudo apt install -y mosquitto mosquitto-clients
sudo nano /etc/mosquitto/conf.d/websocket.conf
```

Innhold:

```
listener 1883
protocol mqtt

listener 9001
protocol websockets

allow_anonymous true
```

```sh
sudo systemctl restart mosquitto
```

I HUD-en: **SMARTHUS → diagnose** → sett broker til `ws://192.168.1.50:9001`.

---

## 9. Kjør automatisk ved oppstart

```sh
sudo nano /etc/systemd/system/jarvis.service
```

```ini
[Unit]
Description=JARVIS HUD
After=network.target

[Service]
Type=simple
User=jetson
WorkingDirectory=/home/jetson/jarvis
ExecStart=/home/jetson/.nvm/versions/node/v20.19.0/bin/npm run start
Restart=on-failure
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now jarvis
sudo systemctl status jarvis
```

---

## 10. Feilsøking

| Symptom | Løsning |
|---|---|
| HUD-en når ikke modellen | Sjekk `OLLAMA_HOST=0.0.0.0:11434` og at brannmuren slipper porten gjennom |
| «Failed to fetch» i chat | Base-URL må inneholde `/v1` på slutten |
| Treg generering | Bruk mindre modell (3B/7B), eller kvantisert `q4` |
| Ingen data i World Monitor | Krever internett — kartlagene hentes fra åpne kilder |
| MQTT kobler ikke | Bruk `ws://` (ikke `mqtt://`) og port 9001 |
| Tom skjerm ved `--host` | Åpne port 8080: `sudo ufw allow 8080` |

---

## 11. Ytelsestips for Jetson

```sh
sudo nvpmodel -m 0      # maks ytelsesmodus
sudo jetson_clocks      # lås klokkene høyt
sudo tegrastats         # følg med på GPU/RAM
```

Kjør Jetson med vifte og NVMe hvis du skal kjøre modeller over 7B.

## Lokal agent (OS-tilgang + skript-sandkasse)

Vil du at Jarvis skal kunne kjøre kommandoer og teste egne skript på Jetson, kjør agent-tjenesten:

```bash
cd jarvis/agent
AGENT_TOKEN="$(openssl rand -hex 24)" node server.mjs
```

Lim URL (`http://<jetson-ip>:8787`) og token inn i HUD-en under **SYSTEM → KOBLINGER → LOKAL AGENT**,
og trykk «test tilkobling». Da får Jarvis verktøyene `agent_status`, `os_kjor`, `skript_lag`,
`skript_kjor`, `skript_test`, `skript_liste` og `skript_slett`.

Kun hvitelistede kommandoer kjøres, skript kjøres i mappen `agent/sandbox` med tidsgrense, og
«bekreft kjøring» spør deg før hver kjøring. Full dokumentasjon: `agent/README.md`.

## Deploy: Docker eller systemd

### Alternativ A – Docker (enklest)

```bash
cd agent
cp agent.env.example .env          # sett AGENT_TOKEN
docker compose up -d --build
docker compose logs -f
```

Data ligger i volumet `jarvis-data`. `network_mode: host` gjør at agenten når
MQTT-megler og ESP32-enheter på LAN-et.

### Alternativ B – systemd (kjører direkte på Jetson)

```bash
sudo useradd -r -s /usr/sbin/nologin jarvis || true
sudo mkdir -p /opt/jarvis /var/lib/jarvis /etc/jarvis
sudo cp -r agent /opt/jarvis/
sudo cp agent/agent.env.example /etc/jarvis/agent.env
sudo chmod 600 /etc/jarvis/agent.env      # sett AGENT_TOKEN her
sudo chown -R jarvis:jarvis /opt/jarvis /var/lib/jarvis

sudo cp agent/jarvis-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jarvis-agent
journalctl -u jarvis-agent -f
```

## HTTPS/TLS

HUD-en kjører på HTTPS, og nettlesere blokkerer kall fra HTTPS til HTTP.
Slå derfor på TLS på agenten:

```bash
cd agent
./scripts/make-cert.sh 192.168.1.50 jetson.local   # bytt til din IP
```

Sett så i `/etc/jarvis/agent.env` (eller docker-compose):

```
AGENT_TLS_CERT=/var/lib/jarvis/certs/agent.crt
AGENT_TLS_KEY=/var/lib/jarvis/certs/agent.key
```

Start på nytt, åpne `https://<jetson-ip>:8787/api/status` én gang i nettleseren
og godta det selvsignerte sertifikatet. Deretter setter du samme adresse i
**SYSTEM → BACKEND**. `tls: true` i statusen bekrefter at det er kryptert.
