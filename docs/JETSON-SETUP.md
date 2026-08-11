# Jarvis på Jetson

## 0. Ett-kommandos oppsett (anbefalt)

Kjør dette på Jetson-en – det installerer Ollama, henter modellene, setter opp
agenten som systemd-tjeneste og skriver ut innloggingen:

```bash
sudo bash agent/scripts/install-jetson.sh
```

Deretter: åpne web-GUI-et, åpne **NODER** og bruk **HURTIGOPPSETT**. Skriv inn
Jetson-IP-en, så registreres chat-noden (llama3.2:3b), Hermes-noden (hermes3:8b)
og backend-adressen automatisk, med tilkoblingstest på hvert steg.

Trinnene under er den manuelle varianten av det samme.

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
bun install
```

## 4. Start HUD-en

```sh
bun run dev -- --host
```

Åpne i nettleseren:

- På Jetson selv: `http://localhost:8080`
- Fra PC/mobil på samme nett: `http://192.168.1.50:8080`

For produksjon:

```sh
bun run build
bun run start   # eller: bun run preview
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

## HTTPS/TLS

Tre veier – velg én.

**1) Caddy (enklest, fornyer sertifikat selv)**
```bash
sudo apt install caddy
sudo cp agent/proxy/Caddyfile /etc/caddy/Caddyfile   # bytt ut domenet
sudo cp agent/proxy/caddy.env.example /etc/caddy/.env
sudo nano /etc/caddy/.env
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl restart caddy
```
Node2-blokken terminerer TLS separat og sender trafikken til Node2-agenten.
Hvis Caddy kjører direkte på Node2, sett `JARVIS_NODE2_UPSTREAM=127.0.0.1:8787`.
Sett `AGENT_TRUST_PROXY=1` i `agent.env` så rate-limiting ser riktig klient-IP.

## Tester

Installer utviklingsavhengighetene før testkjøring; `vitest` ligger i
`devDependencies` og følger ikke med hvis installasjonen bruker produksjonsmodus:

```bash
bun install
bun run test
bun run test:backend-sync   # bare synk-laget
```

Ikke bruk `--production` eller `NODE_ENV=production` når testene installeres.

**2) Nginx + certbot**
```bash
sudo cp agent/proxy/jarvis.nginx.conf /etc/nginx/sites-available/jarvis
sudo ln -s /etc/nginx/sites-available/jarvis /etc/nginx/sites-enabled/
sudo certbot --nginx -d jarvis.dittdomene.no
sudo nginx -t && sudo systemctl reload nginx
```
Også her: `AGENT_TRUST_PROXY=1`.

**3) TLS direkte i agenten (bare LAN)**
```bash
./agent/scripts/make-cert.sh jarvis.local
# i agent.env:
AGENT_TLS_CERT=/opt/jarvis/agent/certs/cert.pem
AGENT_TLS_KEY=/opt/jarvis/agent/certs/key.pem
AGENT_HTTP_REDIRECT_PORT=8786    # valgfri: http → https
```
Selvsignert gir nettleseradvarsel første gang. Godta den, eller importer
`certs/cert.pem` som klarert sertifikat på maskinene dine.

Agenten setter `Strict-Transport-Security` automatisk når trafikken er
kryptert – enten direkte, eller når proxyen sender `X-Forwarded-Proto: https`.

## Tester

```bash
npm test           # hele pakken: kontrakt, backend-klient, sikkerhet, ende-til-ende
npx vitest         # watch-modus
```
Ende-til-ende-testen starter en ekte agent på en tilfeldig port med midlertidig
datamappe, og sjekker CORS, innlogging, rate-limiting, krypterte nøkler og backup.

## Kunnskapsbase (lokal RAG)

Jarvis kan lese dine egne dokumenter og bruke dem som kontekst i chatten.

1. Hent en embedding-modell på Jetson-en:
   ```bash
   ollama pull nomic-embed-text
   ```
2. Åpne **SYSTEM → KUNNSKAP** i HUD-en (krever innlogging mot backend-en).
3. Last opp PDF-er, tekstfiler eller notater, eller lim inn en nettadresse.
4. Dokumentene deles i biter, får vektorer fra modellen og lagres i SQLite
   (`AGENT_DATA/kunnskap.db`, standard `agent/data/kunnskap.db`).
5. I chatten henter Jarvis automatisk de mest relevante bitene før svaret,
   og viser kildene under svaret. Slås av med bryteren i KUNNSKAP-fanen.

Uten embedding-modell fungerer basen fortsatt – da faller søket tilbake på
nøkkelord. Kjør «Reindekser alt» etter at modellen er på plass.

## Stemme: Piper via agenten + trening av egen stemme

1. Kjør en Piper HTTP-server på Jetson (f.eks. `piper-http` på port 5000).
2. I HUD: **SYSTEM → STEMME** → motor **AGENT (Jetson)**. Da går talen via
   `POST /api/tts/tale` på agenten (autentisert, ingen CORS-trøbbel).
3. Treningsklipp lastes opp i samme fane. Agenten lagrer dem i
   `AGENT_DATA/stemmeklipp` og lager et LJSpeech-manifest (`metadata.csv`).
4. Finetune en eksisterende modell:
   ```bash
   python3 -m piper_train.preprocess --input-dir data/stemmeklipp \
     --output-dir data/piper-train --language en --sample-rate 22050 \
     --dataset-format ljspeech
   python3 -m piper_train --dataset-dir data/piper-train \
     --resume_from_checkpoint en_GB-alan-medium.ckpt --max_epochs 2000
   python3 -m piper_train.export_onnx <ckpt> min-jarvis.onnx
   ```
5. Legg `.onnx` + `.onnx.json` i piper-serverens modellmappe og skriv
   modellnavnet i feltet «Piper-modell».

10–20 min ren tale holder til finetuning; 30–60 min gir best resultat.
