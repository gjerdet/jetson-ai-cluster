# Rett Piper-trening med små datasett

## Mål
Alle opplastede klipp skal finnes under trening, og batchstørrelsen skal passe Pipers faktiske treningsdeling.

## Endringer
- Normaliser første kolonne i treningsmanifestet til klipp-ID uten `.wav`, siden aktiv Piper legger til filendelsen selv.
- Sett eksplisitt validerings- og testdeling for små datasett, slik at åtte klipp ikke reduseres til bare tre treningsklipp.
- Beregn batchstørrelsen fra samme deling og logg hvor mange klipp som brukes til trening, validering og test.
- Legg til en lokal regresjonstest for doble `.wav`-navn og små datasett.

## Kontroll
- Valider shell-syntaks og den nye regresjonstesten.
- Kjør relevante prosjekttester og bekreft at prosjektet bygger uten feil.

## Avgrensning
Den pågående jobben bruker allerede lastet skript og må avbrytes. Endringen gjelder neste trening etter vanlig Jarvis-oppdatering.
