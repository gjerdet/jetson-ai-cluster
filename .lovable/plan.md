# Skriptlager + nettsøkskort i chatten

## Del 1 – Skriptlageret (hva Jarvis skriver og tester)

### Hva han kan skrive
- Python (hovedspråket for oppgaver du ber om)
- Bash (system, nettverk, oppsett)
- Node/JavaScript (API-kall, JSON-behandling)

### Fast rutine når du ber om et skript
1. Han spør kort om det som mangler (se «Hva du må gi» under).
2. Skriver skriptet og lagrer det i sandkassen på Jetson.
3. Kjører det med tidsgrense og fanger opp feil.
4. Retter og kjører på nytt i inntil tre runder.
5. Leverer skriptet i chatten sammen med: hva som ble testet, hva som gikk bra,
   og hva som ikke kunne testes lokalt (f.eks. tilgang til TrueNAS eller Homey).

### Hva han tester
- At skriptet starter uten syntaksfeil
- At det kjører helt gjennom på testdata
- At det gir forventet utdata / riktig sluttkode
- At det håndterer manglende fil, tom inndata og feil argumenter
- At farlige operasjoner (sletting, omstart) krever et eksplisitt bekreftelsesflagg

### Hva du må gi for å starte
- Hva skriptet skal gjøre, med ett konkret eksempel
- Hvor det skal kjøre (Jetson, TrueNAS, Proxmox, PC)
- Inndata: filsti, mappe, IP eller API-adresse
- Ønsket resultat: fil, utskrift i terminalen, Telegram-melding
- Om det skal kjøres én gang eller på fast tidspunkt
- Eventuelle brukernavn/nøkler – de lagres lokalt, aldri i chatten

### Nytt i skriptlageret
- En egen SKRIPT-fane i SYSTEM som viser lagrede skript, siste testkjøring
  (bestått/feilet), kjøretid og logg.
- Knapper for å kjøre, laste ned og slette et skript.
- Et kort «testrapport»-felt i chatten under hvert leverte skript.

## Del 2 – Nettsøkskort i chatten
- Nytt kort som vises i chatten når Jarvis søker: søkeordet, 3–5 treff med
  tittel, kilde og et kort utdrag på et par linjer.
- Hvert treff kan åpnes, og har knappen «Lær av denne» som lagrer innholdet
  varig i den lokale kunnskapsbasen.
- Kortet vises både når du selv ber om søk og når han søker på eget initiativ,
  så du alltid ser hvor kunnskapen kom fra.
- Alt går via Jetson – ingen sky, ingen nettleserskanning.

## Teknisk
- Backend: utvider `agent/lib/laering.mjs` (`sokWeb`) med en ren søkerute som
  returnerer strukturerte treff, og legger til `/laering/sok` i `agent/lib/api.mjs`.
- Verktøy: `nett_sok` i `src/lib/agent-tools.ts` som returnerer et markert
  `[[SOKEKORT]]`-blokk som chatten kan rendre; `laer_om` gjenbrukes for lagring.
- Frontend: nytt `SokeKort.tsx` som `MeldingInnhold.tsx` gjenkjenner ved siden av
  kodeblokker, og en `SkriptSection.tsx` i SYSTEM koblet mot sandkasse-rutene.
- Skriptrutinen strammes i systemprompten: alltid `skript_test` før levering,
  alltid testrapport i svaret.

## Etterpå
Last inn på noden med:
`cd ~/jetson-ai-cluster && git pull && sudo bash agent/scripts/update-jetson.sh`
