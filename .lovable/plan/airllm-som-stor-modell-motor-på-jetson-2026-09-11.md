# AirLLM som stor-modell-motor på Jetson

## Hva AirLLM gir deg

AirLLM laster én modell-lag om gangen inn på GPU-en i stedet for hele modellen. Det gjør at en stor modell (30B–70B) kan kjøre på en Jetson med lite minne, uten sky og uten API-nøkler.

## Ærlig forventning

Dette er ikke en rask motor. Fordi hvert lag leses fra disk for hvert svar, tar en 70B-modell typisk flere minutter per svar på en Jetson Nano Super. Den er nyttig når kvalitet betyr mer enn fart — for eksempel grundig planlegging, kodegjennomgang eller analyse som kan kjøre i bakgrunnen — mens Ollama fortsatt tar all vanlig chat.

Derfor blir AirLLM lagt inn som en egen "tung, lokal" modell Jarvis kan velge, ikke som erstatning for dagens modell.

## Slik blir det bygget

1. **Installasjon fra GUI-et.** Nytt valg under SYSTEM → MODELLER: "Installer AirLLM". Det setter opp et eget Python-miljø, installerer AirLLM, og laster ned modellen du velger. Bruker samme apt/venv-rutiner som Piper-installasjonen, så låser og halvinstallerte pakker håndteres automatisk.

2. **Lokal tjeneste med kjent grensesnitt.** AirLLM kjøres bak en liten lokal server på port 11500 som snakker samme språk som Ollama og OpenRouter. Da dukker den opp som en helt vanlig node i node-listen, og alt som allerede finnes — ruting, lastbalansering, token-budsjett, evaluator — virker uten endringer.

3. **Modellvalg og nedlasting.** Ferdige valg for de vanligste størrelsene (8B, 14B, 32B, 70B) med anslått diskplass og forventet svartid, så du ser hva du går til før nedlastingen starter.

4. **Ruting.** Jarvis bruker AirLLM bare når oppgaven er merket som tung og du har slått den på. Småprat og raske spørsmål går fortsatt til Ollama. Med "lokal-først" allerede aktiv betyr det at Jarvis kan slippe å bruke betalte sky-tokens på tunge oppgaver — den kan i stedet vente på det lokale svaret.

5. **Status og logg.** Egen visning som viser om tjenesten kjører, hvilken modell som er lastet, minnebruk og siste svartid — samme stil som treningskøen.

## Teknisk oppsummering

- `agent/scripts/installer-airllm.sh` — venv, `pip install airllm`, modellnedlasting, gjenbruk av `apt-felles.sh`.
- `agent/scripts/airllm-server.py` — minimal HTTP-server med `/v1/chat/completions`, `/v1/models` og `/health`, sekvensiell kø (én forespørsel om gangen).
- `agent/lib/airllm.mjs` — start/stopp/status som bakgrunnsjobb, samme jobbmønster som `trening.mjs`.
- `agent/lib/api.mjs` — ruter `/airllm/status` (GET), `/airllm/installer` (POST), `/airllm/start` (POST), `/airllm/stopp` (POST).
- `agent/lib/contract.mjs` + `contract.d.mts` + `src/lib/backend.ts` — klientkontrakter.
- `src/components/hud/settings/AirllmSection.tsx` + fane i `SettingsPanel.tsx`.
- `src/lib/model-router.ts` — AirLLM-noder klassifiseres som `tung` og `lokal`, med lengre tidsgrense.
- Timeout for denne noden settes høyt (standard 30 min) i `agent/lib/ai-endpoint.mjs`-kallet.

## Rekkefølge

Først installasjon + tjeneste + status (så du kan teste én modell), deretter ruting og GUI-finpuss.
