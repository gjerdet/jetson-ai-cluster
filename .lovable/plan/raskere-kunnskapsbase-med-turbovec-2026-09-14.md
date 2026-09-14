# Raskere kunnskapsbase med turbovec

## Mål
Kunnskapssøket i Jarvis regner i dag likhet på alle biter i JavaScript, med vektorene lagret som tekst. Det blir tregt og minnekrevende når antall dokumenter vokser. turbovec komprimerer vektorene kraftig og søker mye raskere, helt lokalt på Jetson.

Etter endringen skal søket bruke turbovec når det er installert, og falle tilbake til dagens metode automatisk ellers – uten at noe må gjøres manuelt.

## Slik blir det for deg
- Ny knapp «INSTALLER TURBOVEC» i kunnskapspanelet, samme flyt som AirLLM-installasjonen (jobb med live logg).
- Statuslinje som viser: installert / kjører, antall indekserte biter, hvilken metode siste søk brukte (turbovec, vektor eller nøkkelord) og søketid i millisekunder.
- Knapp «BYGG INDEKS PÅ NYTT» hvis du bytter embedding-modell eller vil rydde opp.
- Søk og chat fungerer nøyaktig som før hvis turbovec ikke er installert – ingenting går i stykker.

## Teknisk gjennomføring

### 1. Lokal indekstjeneste
- `agent/scripts/installer-turbovec.sh`: eget Python-miljø i `/opt/jarvis/turbovec/.venv` (`--system-site-packages`), `pip install turbovec`, faller tilbake til bygging fra kilde hvis hjul mangler for ARM64. Bruker `apt-felles.sh` for låsventing og pakkereparasjon, samme flock-mønster som AirLLM. Skriver venv-stien til `/var/lib/jarvis/data/turbovec-venv.sti`.
- `agent/scripts/turbovec-server.py`: liten HTTP-tjeneste på port 11600 med `/health`, `/legg-til` (id + vektor), `/sok` (vektor + topK), `/slett` (dokId), `/statistikk`, `/nullstill`. Indeksen lagres på disk under `DATA_DIR/turbovec/` og lastes ved oppstart.

### 2. Node-side
- `agent/lib/turbovec.mjs`: konfig (port, aktiv), status, start/stopp av tjenesten, installasjonsjobb – samme struktur som `airllm.mjs`.
- `agent/lib/rag.mjs`:
  - `addDocument` sender nye bit-vektorer til turbovec når tjenesten svarer; SQLite forblir eneste sannhetskilde for tekst og vektorer.
  - `search` prøver turbovec først, henter bit-tekst fra SQLite på id, og faller tilbake til dagens cosinus-løkke ved feil eller manglende tjeneste. Returnerer `metode: "turbovec" | "vektor" | "nokkelord"` og `msBrukt`.
  - `deleteDocument` fjerner også fra indeksen.
  - Ny `rebuildIndex()` som strømmer alle lagrede vektorer inn i turbovec i grupper.
- `ragStats()` utvides med indeksstatus.

### 3. API og GUI
- Nye ruter under eksisterende `/kunnskap`-prefiks: `/kunnskap/indeks` (GET status), `/kunnskap/indeks/installer`, `/start`, `/stopp`, `/bygg` (POST, admin).
- Kontrakter i `agent/lib/contract.d.mts` og typer via `src/lib/contract.ts`; klientkall i `src/lib/backend.ts`.
- `src/components/hud/KnowledgePanel.tsx`: statuslinje, installasjons-/start-/byggknapper og loggvisning, i samme HUD-stil som AirLLM-seksjonen.

### 4. Oppdatering av noden
`update-jetson.sh` installerer turbovec idempotent når det mangler, med `HOPP_OVER_TURBOVEC=1` som unntak. Installasjonen er valgfri: feiler den, logges det som advarsel og Jarvis kjører videre på dagens søk.

## Validering
`bash -n` på skriptene, `python3 -m py_compile` på tjenesten, `node --check`, typecheck, tester og bygg. Ekte turbovec-kjøring må verifiseres på Jetson etter oppdatering.
