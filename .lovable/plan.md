# JARVIS AGI/autonomipakke — implementasjonsplan

Mål: Gjøre den lokale JARVIS-agenten på Jetson-klyngen selvstyrende, lærende og proaktiv, med full autonomi innenfor sikkerhetsregler.

## 1. Vedvarende episodisk minne

- Ny SQLite-tabell `minne` i `agent/lib/store.mjs`:
  - `id`, `tid`, `type` (hendelse/beslutning/faktum/erfaring), `kontekst`, `innhold`, `viktighet`, `kilder JSON`, `utløp`.
- API-endepunkter:
  - `POST /minne/lagre` — lagre hendelse/beslutning fra chat, verktøy eller evaluator.
  - `POST /minne/hent` — hent relevante minner basert på vektorsøk/embedding eller nøkkelord.
  - `GET /minne/tidslinje` — siste N hendelser.
- Embedding genereres lokalt via Ollama (f.eks. `nomic-embed-text`) eller fallback til nøkkelord.
- Minne injiseres automatisk i systemprompt ved hver AI-forespørsel.

## 2. Mål- og planleggingssystem

- Ny modul `agent/lib/planner.mjs`:
  - Mottar et høynivåmål fra bruker eller eget initiativ.
  - Bruker AI til å bryte målet ned i deloppgaver med avhengigheter.
  - Lagrer plan i SQLite-tabell `planer` med status `venter/aktiv/fullført/feilet`.
- API-endepunkter:
  - `POST /plan/lag` — lag plan fra mål.
  - `POST /plan/utfør-steg` — kjør neste steg (kaller verktøy/AI).
  - `GET /plan/aktiv` — vis aktiv plan.
  - `POST /plan/avbryt` — avbryt plan.
- Bakgrunnsjobb sjekker `planer` hvert minutt og utfører neste aktive steg.

## 3. Selvevaluering og læringsløkke

- Utvide `agent/lib/evaluator.mjs`:
  - Etter hver AI-respons/verktøykjede scorer den: var svaret nyttig? Var verktøyene riktige? Ble målet nådd?
  - Hvis score < terskel, skriv `erfaring` til minne med hva som gikk galt og forbedringsforslag.
  - Ved lav score kan den be om nytt forsøk fra en annen node (failover).
- API-endepunkter:
  - `POST /evaluator/vurder` — manuell eller automatisk vurdering.
  - `GET /evaluator/rapport` — siste vurderinger og lærte erfaringer.

## 4. Multimodalitet (kamera + lyd)

- Ny modul `agent/lib/vision.mjs`:
  - Ta bilde fra USB/CSI-kamera på Jetson.
  - Send til lokal VLM (f.eks. `llava` eller `moondream`) via Ollama.
  - Returner beskrivelse til chat/minne.
- Ny modul `agent/lib/audio.mjs`:
  - "Always-on" lytting via VAD (voice activity detection) med `silero-vad` eller PicoVoice.
  - Wake-word "Jarvis" aktiverer talegjenkjenning (Whisper via Ollama).
- API-endepunkter:
  - `POST /vision/analyser` — analyser kamerabilde.
  - `POST /audio/lytt` — start/stopp lytting.
  - WebSocket for sanntids lydstrøm.
- GUI: knapp i chat for "Se med kamera", visuell lydstatus.

## 5. Eget initiativ / bakgrunnsprosess

- Ny modul `agent/lib/initiativ.mjs`:
  - Periodisk (f.eks. hvert 5. minutt) vurderer den:
    - Sensorverdier (MQTT)
    - Minne (uleste varsler, ufullførte planer)
    - Brukerhistorikk (tid på døgnet, vaner)
  - Genererer forslag til handlinger.
  - Med "full autonomi" utfører den godkjente, lavrisiko-handlinger selv (sende statusmelding, starte plan, justere smarthus).
  - Høyrisiko-handlinger krever fortsatt eksplisitt godkjenning.
- API-endepunkter:
  - `GET /initiativ/forslag` — hent gjeldende forslag.
  - `POST /initiativ/aktiver` — slå autonomi på/av.
  - `POST /initiativ/godkjenn` — godkjenn et forslag manuelt.

## 6. Verktøygenerering i sandkasse

- Utvide `agent/lib/tools.mjs`:
  - AI kan be om å lage et nytt verktøy.
  - Modellen får en mal og må returnere JavaScript-kode + beskrivelse + input-skjema.
  - Koden kjøres i en isolert sandkasse (VM2/Node VM med begrenset kontekst).
  - Verktøyet lagres i `verktoy` SQLite-tabell og blir tilgjengelig for fremtidige kjeder.
- API-endepunkter:
  - `POST /verktoy/generer` — be AI generere verktøy.
  - `POST /verktoy/test` — test generert verktøy uten å lagre.
  - `GET /verktoy/liste` — vis alle verktøy.
- GUI: "Opprett verktøy"-knapp i chat, liste over egendefinerte verktøy.

## 7. Sikkerhet og sandkasse

- All autonom handling logges i `audit`-tabell.
- Kommando-hvitelisting fra tidligere beholdes.
- Verktøygenerering kjøres i egen VM med timeout, ingen nettverk, ingen filsystem utenom `/tmp`.
- Høyrisiko-handlinger (f.eks. SSH, omstart, sletting) krever godkjenning uansett autonomi-modus.

## 8. GUI-utvidelser

- Nytt panel: **AGI/MINNE**
  - Tidslinje over hendelser.
  - Aktiv plan og deloppgaver.
  - Autonomi-bryter og forslagsliste.
  - Lærte erfaringer fra evaluator.
- Utvide **ChatPanel**:
  - Vis "Jarvis tenker" med aktiv plan/minne.
  - Kamera-knapp og taleaktivering.
  - Verktøygenereringsflyt.
- Utvide **HealthPanel**:
  - Status på bakgrunnsprosesser (initiativ, planlegger, evaluator).

## 9. Integrasjon med eksisterende kode

- `agent/lib/contract.mjs` utvides med nye typer for minne, planer, verktøy.
- `agent/lib/api.mjs` får nye ruter.
- `agent/lib/telegram.mjs` får autonome meldinger og godkjenningsknapper.
- `agent/scripts/install-jetson.sh` og `oppsett.sh` oppdateres for å laste VLM/Whisper/embedding-modeller.

## Akseptansekriterier

- Chat kan referere til noe som skjedde for en time siden via minne.
- Bruker kan si "planlegg en helg med familien" og JARVIS lager en plan med steg.
- Evaluatoren skriver automatisk en erfaring hvis et verktøykall feiler.
- Initiativ-prosessen sender en Telegram-melding uten å bli spurt (innen godkjente rammer).
- AI kan generere og bruke et nytt verktøy i chat.
- Alle nye ruter har tester.

## Risikoer

- Jetson Nano 8 GB har begrenset RAM; VLM + LLM samtidig kan krasje. Løsning: last én modell av gangen, bruk lastbalanserer.
- Full autonomi kan føre til uønskede handlinger. Løsning: streng audit, hvitelisting, og tydelig autonomi-bryter.
