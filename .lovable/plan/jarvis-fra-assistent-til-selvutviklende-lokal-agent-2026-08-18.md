# Jarvis: fra assistent til selvutviklende lokal agent

Målet er at Jarvis skal forstå at han er en fysisk maskin i ditt eget nett, bygge og teste sine egne verktøy, faktisk samarbeide med Hermes, kunne bruke World Monitor i chat, og bruke ledig tid på å bli bedre.

Valg fra dialogen som styrer planen: full lokal autonomi med revisjonslogg og rollback, sandkasse = isolert VM med lesende tilgang til eget LAN, ledig-tid = ingen chat på 10 min + lav GPU-last.

---

## 1. Han skal skjønne at han er lokal

I dag finnes en «evidensport» som krever verktøykjøring for lokale spørsmål, men han mangler en fast selvforståelse. Vi gir ham et **maskin-ID-kort** som bygges av backend ved oppstart og oppdateres hvert 5. minutt: vertsnavn, modell (Jetson Orin Nano Super), CPU/GPU, minne, OS, aktivt LAN-grensesnitt, IP/CIDR, gateway, DNS, tjenester, Ollama-modeller og klyngenoder.

- Kortet legges først i systemprompten hver tur, slik at han aldri må gjette.
- All maskinvare-, nettverks- og driftsinformasjon markeres som «kun fra måling»: finnes ikke fersk måling, sier han det i stedet for å svare.
- Vi utvider den deterministiske veien fra IP/gateway/DNS til også maskinvare, tjenestestatus, diskbruk og modell-liste, slik at disse spørsmålene aldri når språkmodellen ubekreftet.
- Egen selvtest: en fast «hvem er du»-sjekk som kjøres etter hver oppdatering og varsler hvis kortet ikke stemmer med målt virkelighet.

## 2. Flinkere til å lage egne verktøy

Verktøygeneratoren finnes, men er en engangsting: lag JSON, kjør én test, ferdig.

- **Lukket sløyfe**: beskrivelse → generer → test i sandkasse → les feilmelding → forbedre → test igjen (opptil 3 runder) før verktøyet aktiveres.
- **Auto-forslag**: når et svar mangler et verktøy han trenger, foreslår og bygger han det selv i stedet for å svare «det kan jeg ikke».
- **Bruksstatistikk** per verktøy (antall kall, feilrate, snittid). Verktøy som feiler ofte plukkes automatisk opp til forbedring i ledig tid.
- **Verktøybibliotek i HUD**: se, teste, redigere, rulle tilbake og slå av/på – både innebygde og selvlagde.
- Genererte verktøy blir førsteklasses i chat-loopen (samme katalog og samme sporing som de innebygde).

## 3. Bedre kobling mot Hermes

I dag deleger han via `spor_kollega`, men koblingen faller sammen i praksis.

- **Kollega-diagnose**: en test som går hele veien (nå adressen → modellen svarer → svaret kommer tilbake i chat) og sier nøyaktig hvilket ledd som ryker, med adresse, HTTP-status og forslag til fiks.
- Samme robuste kall-kjede som chatten bruker (flere endepunkt-varianter, riktig modell-id, fornuftige tidsavbrudd, ingen ugyldige felt mot OpenAI-kompatible servere).
- **Kollega-register**: hver node får en profil (hva den er god til, kontekstlengde, snittsvartid), slik at han velger riktig kollega i stedet for «første ledige».
- **Samtale mellom modellene**: delegerte oppgaver kan gå flere runder (Jarvis spør → Hermes svarer → Jarvis følger opp) med hele utvekslingen synlig i chatten.
- Feil mot kollega skal aldri bli stille: de vises som verktøyfeil med årsak.

## 4. World Monitor i chat

- `world_brief` utvides med filtre: emne, region, lag (konflikt, cyber, atom, DEFCON …), tidsrom og antall.
- Nye verktøy: `world_sok` (fritekstsøk i hendelsene) og `world_lag` (status per lag, inkl. Pentagon Pizza/DEFCON).
- Feeden holdes varm i bakgrunnen, slik at chatten svarer med en gang i stedet for å vente på lasting.
- Svar oppgir alltid kilde og tidsstempel per hendelse.

## 5. Sandkasse for testing

- Sandkassen får **lesende nettilgang til eget LAN** og lokale tjenester (Ollama, MQTT, TrueNAS, Proxmox, UniFi) – ingen skriving, ingen internett-utgang, ingen `child_process`.
- Ressurstak: tidsgrense, minnegrense, maks antall utgående kall per kjøring.
- Egen arbeidskatalog per kjøring som ryddes etterpå.
- Full logg av hva sandkassen gjorde (kall, resultat, feil), synlig i HUD.

## 6. Selvforbedring og bruk av død tid

- **Ledig-detektor**: ingen chat på 10 minutter + lav GPU-last → bakgrunnsarbeid starter. Ny brukeraktivitet avbryter umiddelbart.
- **Forbedringskø** med jobber han velger selv, prioritert etter nytte:
  - reparere verktøy med høy feilrate,
  - bygge verktøy for oppgaver han nylig ikke klarte,
  - indeksere ny kunnskap i RAG,
  - kartlegge nettet og oppdatere maskin-ID-kortet,
  - evaluere egne svar fra de siste dagene og skrive lærdom til minnet,
  - teste kollega-koblinger og modellytelse.
- **Full lokal autonomi**: han kan aktivere og endre egne verktøy, minner og rutiner uten å spørre – men hver endring får en revisjonspost (hva, hvorfor, når, resultat) og kan rulles tilbake med ett klikk. Ting som treffer omverdenen (sende meldinger, skrive til andre systemer, endre systemtjenester) krever fortsatt godkjenning.
- **Læringsminne**: evalueringene skriver konkrete regler tilbake i systemprompten («ved nettverksspørsmål, kjør alltid nett_sjekk først»), slik at han faktisk endrer oppførsel over tid.
- Nytt HUD-panel **UTVIKLING**: kø, pågående jobb, hva han har endret på seg selv, gevinst/tap, og rollback.

## 7. Bedre bruk av lokale ressurser

- Modellrutingen tar hensyn til målt GPU-ledighet, kø og historisk svartid per node – ikke bare oppgavetype.
- Små/rutinemessige oppgaver holdes lokalt; kun det som virkelig trenger det går til Hermes eller sky.
- Modeller holdes varme på riktig node, og tunge modeller lastes ut når minnet trengs.
- Bakgrunnsarbeid nedprioriteres automatisk så snart du skriver i chatten.

---

## Teknisk oppsummering

Backend (`agent/`):
- `lib/identitet.mjs` (nytt): maskin-ID-kort, bygget på `gpu.mjs` + nettverkssjekk, cachet og periodisk oppfrisket.
- `lib/toolgen.mjs`: iterativ generer→test→fiks-loop, bruksstatistikk, versjonering og rollback av verktøy.
- `lib/sandkasse.mjs` (nytt): VM med hvitelistet `fetch` mot private IP-områder, ressurstak, kjøringslogg.
- `lib/kollega.mjs` (nytt): kollega-register, robust kall-kjede, ende-til-ende-diagnose, flerrunders delegering.
- `lib/initiative.mjs`: ledig-detektor (chat-inaktivitet + GPU), prioritert forbedringskø, autonom utførelse med revisjonslogg.
- `lib/evaluator.mjs` + `feedback.mjs`: evalueringer skrives til varige adferdsregler.
- `lib/balancer.mjs`: ruting på målt ledighet, kø og historisk latens.
- Nye API-ruter for identitet, verktøybibliotek, kollega-diagnose, utviklingskø og revisjon/rollback.

Frontend (`src/`):
- `lib/agent-tools.ts`: nye verktøy (`world_sok`, `world_lag`, `maskin_kort`, `verktoy_bygg`), oppdaterte regler R1–R10 med tydelig lokal-først og bygg-ditt-eget-verktøy-mandat.
- `lib/agent-policy.ts`: evidensporten dekker også maskinvare, tjenester og lagring.
- `components/hud/ChatPanel.tsx`: deterministiske svar for flere lokale spørsmålstyper, synlig kollega-utveksling.
- Nye paneler: `UtviklingPanel` (kø, revisjon, rollback) og utvidet `AgentPanel` (verktøybibliotek med statistikk og test).
- `lib/world-feed.ts`: søk, filtrering og bakgrunnsoppfriskning.

Rekkefølge: (1) identitet og lokal-forståelse, (2) sandkasse, (3) verktøysløyfe, (4) Hermes, (5) World Monitor i chat, (6) ledig tid og selvforbedring, (7) ressursruting.
