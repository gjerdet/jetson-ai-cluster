# Robust netthenting for Jarvis

## Mål
Jarvis skal hente relevant og fersk informasjon fra nettsteder oftere, og ikke svare med menytekst, gamle data eller oppdiktet innhold.

## Endringer
- Forbedre nettsideleseren til å prioritere artikkeloverskrifter, publiseringstid, hovedinnhold, strukturerte nyhetsdata og RSS-lenker.
- Validere resultatet før det gis til modellen, slik at tomme, blokkerte eller irrelevante sider oppdages.
- Legge inn automatisk reservevei: direkte side → nettstedets RSS/nyhetsdata → målrettet nettsøk mot domenet.
- Sørge for at svar om «nyeste» eller «nå» bruker de hentede kildene ordrett og viser URL og tidspunkt når det finnes.
- Legge til tester for nyhetssider, blokkeringer og irrelevante sider.

## Teknisk
- Samle robust HTML-ekstraksjon i den lokale bakgrunnstjenesten og tilsvarende serverleser.
- Beholde dagens gratis, lokale oppsett; ingen API-nøkler eller betalte tjenester.
- Begrense antall forsøk og tidsbruk, og returnere konkrete feil dersom alle veier feiler.
