# Reparer automatisk Piper/PyTorch-oppsett

## Mål
En vanlig Jarvis-oppdatering skal etterlate Piper-miljøet klart med NVIDIA PyTorch og CUDA, uten manuell installasjon.

## Endringer
- Bygg og kontroller Piper-miljøet selv om PyTorch mangler i system-Python.
- Installer NVIDIA PyTorch direkte i Python-miljøet Piper faktisk bruker.
- La oppdateringen forsøke full reparasjon av et eksisterende, ufullstendig Piper-miljø i stedet for å hoppe over det.
- Avslutt oppdateringen med en tydelig kontroll av `torch`, CUDA, Lightning og Piper-trening.
- Behold sikker fallback og forståelige feilmeldinger dersom NVIDIA-pakken ikke kan lastes ned.

## Teknisk
- Juster kontrollflyten i `installer-piper.sh` og `update-jetson.sh`.
- Valider shell-syntaks, relevante tester og prosjektbygg etter endringen.
