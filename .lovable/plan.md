# Reparer Piper ONNX-eksport

## Mål
La en ferdigtrent Piper-stemme eksporteres på Jetson selv om PyTorchs nye ONNX-eksportør stopper på VITS-modellens dynamiske kontroll.

## Endringer
- Kjør Piper-eksporten med PyTorchs stabile, eldre ONNX-eksportør (`dynamo=False`).
- Behold automatisk installasjon av nødvendige ONNX-pakker.
- Gi en kort og forståelig feil dersom både ordinær og kompatibel eksport feiler.
- Utvid stemmetreningstesten slik at eksportvalget ikke kan falle bort ved senere endringer.

## Kontroll
- Valider shell-syntaks og kjør den målrettede stemmetreningstesten.
- Kontroller prosjektets automatiske byggstatus etter endringen.
