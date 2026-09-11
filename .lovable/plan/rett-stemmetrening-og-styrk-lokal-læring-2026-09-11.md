# Rett stemmetrening og styrk lokal læring

## Mål
- Få norsk bokmål gjennom Piper uten feilen `Failed to set voice: no`.
- Sørge for at Jarvis kan oppdage kunnskapshull, søke på nettet og lagre nyttig kunnskap lokalt.

## Endringer
1. Bytt Piper sitt eSpeak-språk fra den ugyldige koden `no` til bokmålskoden `nb` i både ny og eldre treningsflyt.
2. Legg inn en tidlig språktest mot Piper/eSpeak før en lang treningsjobb starter, med en tydelig feil dersom bokmålsstemmen mangler.
3. Forbedre feiltolkingen i treningskøen slik at språkfeil peker på riktig årsak og løsning.
4. Kontroller og fullfør koblingen mellom chat, nettsøk, lokal kunnskapslagring, refleksjon og varige læringsregler.
5. La Jarvis søke etter manglende fagkunnskap når lokale kilder ikke er nok, men beholde innlært innhold lokalt med kildehenvisning.

## Kontroll
- Kjør skall- og JavaScript-syntakskontroller.
- Kjør relevante tester og bekreft at prosjektet bygger uten feil.
- Bekreft at treningskommandoen bruker `nb`, og at læringsverktøyene er tilgjengelige i chatten.

## Avgrensning
En full stemmetrening kan bare sluttføres på Jetson-maskinvaren. Denne endringen fjerner den konkrete språkfeilen og stopper tidligere med en presis beskjed hvis eSpeak-data mangler.
