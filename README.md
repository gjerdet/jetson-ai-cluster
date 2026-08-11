# JARVIS HUD — Lokal AI-operatør for Jetson

Et minimalistisk, Jarvis-inspirert HUD som kjører i nettleseren og snakker direkte med dine egne lokale AI-noder (Jetson, Ollama, llama.cpp, mm.). Alt lagres lokalt i nettleseren; ingen sky kreves for kjernefunksjonene.

## Hva den gjør

- **Flere modeller samtidig**: Koble til så mange lokale noder og sky-modeller du vil. Lastbalansering fordeler kall automatisk.
- **Evaluator**: Arbeidernoder scorer primærsvaret og slår sammen til et forbedret `ENDELIG SVAR` når poengsummen er lav.
- **Verktøykall-loop**: Jarvis kan lese MQTT, liste noder, hente systemdata og be om world-briefs før den svarer.
- **World Monitor**: Global telemetri med kartlag for konflikt, naturkatastrofer, infrastruktur, sykdom, cybertrusler, m.m.
- **Smarthus**: MQTT-bro mot ESP32, Raspberry Pi og Home Assistant. Tidsserier, varsler, regler og auto-oppdagelse.
- **Enhetsregister**: ESP32/ESP8266/Raspberry Pi med autogenerert kode, koblingsskjema og dokumentasjon.
- **Graf-dashbord**: Bygg moduler for MQTT-data og systemintegrasjoner (TrueNAS, Proxmox, UniFi, Homey).

## Kjør lokalt på Jetson

Du trenger **Node.js 20+** (eller Bun) og Git. På Jetson Nano Super anbefales Node.js via [nvm](https://github.com/nvm-sh/nvm) eller den innebygde pakkebehandleren.

```sh
# 1. Hent koden fra GitHub (se GitHub-integrasjon under)
git clone <din-github-url>
cd <repository-name>

# 2. Installer avhengigheter
npm install
# eller: bun install

# 3. Start utviklingsserveren
npm run dev
# eller: bun dev
```

Appen starter på `http://localhost:8080` (eller den porten Vite melder). Åpne den i nettleseren på Jetson, eller sett Jetson-IP-en i nettleseren på en annen maskin i samme nettverk (`http://<jetson-ip>:8080`).

> **Tips**: For å eksponere på alle nettverksgrensesnitt, sett `host: true` i `vite.config.ts` eller kjør `npm run dev -- --host`.

### Bygg for produksjon

```sh
npm run build
npm run preview
```

## Koble til ChatGPT / sky-modeller

HUD-en snakker **OpenAI-kompatibelt** (`/v1/chat/completions`). Du kan derfor legge inn:

| Tjeneste | Base-URL | Modell-eksempel |
|---|---|---|
| **OpenAI / ChatGPT** | `https://api.openai.com/v1` | `gpt-4o-mini`, `gpt-4o` |
| **Google Gemini** | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash-lite` |
| **OpenRouter** | `https://openrouter.ai/api/v1` | `google/gemini-3.6-flash` |
| **Lokal Ollama** | `http://<jetson-ip>:11434/v1` | `llama3.2`, `hermes3` |

Slik legger du til en sky-modell:

1. Åpne **SYSTEM** → **MODELLER**.
2. Klikk ønsket sky-knapp (ChatGPT, Gemini, OpenRouter, …).
3. Lim inn API-nøkkelen i feltet **api-nøkkel**.
4. Sett ønsket rolle: **primær** (svarer brukeren), **arbeider** (evaluerer/hjelper) eller **observatør**.
5. Skru den på.

> **Sikkerhet**: API-nøkkelen lagres kun i nettleserens localStorage. Den sendes direkte til leverandørens API fra nettleseren. Bruk en skrivebegrenset nøkkel der det er mulig.

## Koble til lokal AI på Jetson

På Jetson Nano Super kjører du for eksempel Ollama:

```sh
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2
ollama serve
```

Legg deretter til en node i **MODELLER**:

- **Navn**: `JETSON-01`
- **Base URL**: `http://127.0.0.1:11434/v1` (hvis du er på samme maskin) eller `http://<jetson-ip>:11434/v1` (fra en annen maskin)
- **Modell**: `llama3.2`
- **Rolle**: `primær`

## GitHub-integrasjon

For å få koden ut på GitHub slik at du kan klone den til Jetson:

1. I Lovable-editoren: Klikk **Plus (+)**-menyen nederst til venstre i chat-feltet.
2. Velg **GitHub** → **Connect project**.
3. Autoriser Lovable GitHub App.
4. Velg konto/organisasjon og lag repository.

Deretter kloner du repository-et til Jetson og følger stegene under **Kjør lokalt på Jetson**.

Les mer: [Lovable GitHub-integrasjon](https://docs.lovable.dev/integrations/github)

## Miljøvariabler (valgfritt)

Noen funksjoner bruker server-side proxy-funksjoner for å unngå CORS. Når du kjører lokalt kan du sette:

```sh
# For Telegram-varsler via Lovable connector-gateway
TELEGRAM_API_KEY=<din-telegram-bot-token>
```

Settes i `.env` eller eksporteres før `npm run dev`.

## Teknisk stakk

- TanStack Start
- React 19 + TypeScript
- Tailwind CSS v4
- MQTT over WebSocket
- D3-geo for kart
- Recharts for grafer

## Lisens

Dette er din egen kode. Bruk, endre og del den som du vil.
