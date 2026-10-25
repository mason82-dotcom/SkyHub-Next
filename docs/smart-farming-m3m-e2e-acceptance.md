# M3M Smart Farming – durchgehende Offline-Integrationsabnahme

Stand: 24.10.2026 · Repository: `mason82-dotcom/SkyHub-Next`

## Warum dieser Test nach der Konsolidierung erforderlich ist

Die ursprünglichen elf M3M-Draft-PRs wurden über den bereits gemergten
[PR #100](https://github.com/mason82-dotcom/SkyHub-Next/pull/100) gegen
`main` konsolidiert. Der lokale Worktree-Teststarter aus
[PR #121](https://github.com/mason82-dotcom/SkyHub-Next/pull/121)
ist ebenfalls gemergt.

Die bisherigen Regressionstests prüften bereits alle Einzelmodule und
synthetische TIFF-Datensätze. Ein zusätzlicher Test kontrolliert
jetzt ausdrücklich **auch die Übergaben zwischen Python-Dateiartefakten,
dem externen Prüfsummenbeleg und dem realen Node.js-Katalogmodul**.

## Offline-Testkette

Der Test liegt unter
`tests/test_m3m_e2e_offline_catalog.py` und verwendet nur
temporäre lokale Dateien sowie synthetische M3M-ähnliche Raster.

1. Schreibe ein künstliches GeoTIFF mit **Red, Green, NIR, RedEdge, Alpha**,
   EPSG:32632 und einem transparenten NoData-Pixel.
2. Pinne die SHA-256 der synthetischen Eingangsdatei und starte die
   existierende Offline-ODM-Handoff- und Index-Pipeline.
3. Fordere die unabhängige Raster-QA mit überprüften NDVI-/NDRE-/
   GNDVI-/OSAVI-Pixeln und deaktivierten Readiness-Flags.
4. Erzeuge den separaten SHA-256-Integritätsbeleg und prüfe ihn mit
   dessen **im Test getrennt gehaltenem Hash-Pin**.
5. Erzeuge daraus den privaten, rein experimentellen Kandidaten.
6. Kopiere ausschließlich die private Kandidatendatei in einen
   temporären Katalogslot, erzeuge das kanonische Manifest und
   übergebe dessen SHA-256-Pin an **das echte**
   `backend/smart-farming-catalog.js` mit Node.js 22.
7. Prüfe vier Indexstatistiken, pseudonyme Kandidaten-ID,
   `recordSha256VerifiedAtRead=true` und
   `rasterQaRecheckedAtRead=false`.
   Sämtliche Einsatz-, Export- und Flugfreigaben bleiben false.
8. Wiederhole die Übergaben nach einer absichtlichen Manipulation
   eines versiegelten GeoTIFFs, der Kandidatendatei sowie des
   Katalogmanifests. Alle Fälle müssen **fail-closed** enden.

## Ausführung und CI

Die bestehenden rasterabhängigen Workflows
`.github/workflows/ci.yml` und
`.github/workflows/m3m-offline-acceptance.yml`
richten nun ausdrücklich **Python 3.12** und **Node.js 22** ein.
Ein Prüfschritt stellt vor dem unittest-Lauf sicher, dass NumPy,
Rasterio und Node verfügbar sind, um unbemerkte Test-Skips wegen
fehlender Laufzeitabhängigkeiten zu verhindern.

```bash
# Nur in einem separaten, bewusst freigegebenen Worktree
cd ~/Projekte/SkyHub-Next
git fetch origin
git worktree add ~/Projekte/SkyHub-M3M-E2E \
  origin/test/m3m-e2e-offline-handoff-20261024
cd ~/Projekte/SkyHub-M3M-E2E
python3 -m venv .venv-m3m
source .venv-m3m/bin/activate
python -m pip install --only-binary=:all: \
  -r backend/workers/m3m_requirements.txt
node --version
python -m unittest discover -s tests \
  -p 'test_m3m_e2e_offline_catalog.py' -v
```

Die Testkette liest **keine Pi-Medien**, schreibt weder Datenbanken,
MinIO/S3 noch MQTT und startet weder DEDAL noch DJI-Flugkommandos.
Beim Node-Test wird das direkte Katalogmodul importiert, nicht
ein echter Netzwerk-HTTP-Server. Authentifizierte HTTP-Routen werden
unabhängig von den vorhandenen Katalog-HTTP-Tests kontrolliert.

## Harte Freigabegrenzen

Dieser synthetische End-to-End-Test weist **keine**
Mavic-3M-Sensorkalibrierung, Panelkorrektur, reale Flugaufnahme,
Band-Coregistration, photogrammetrische Genauigkeit,
GeoTIFF-Quellherkunft, DEDAL-Ausführung oder
landwirtschaftliche Eignung nach.

Erst ein echter, dokumentierter M3M-Datensatz mit allen Bändern,
Kalibrierpanel, nachprüfbarem DEDAL-/ODM-Verarbeitungslauf und
Rechte-/Quellenkontrolle erlaubt die nächste wissenschaftliche
Freigabephase. Bis dahin bleiben die Indexraster und Kandidaten
**experimentell, ohne GIS-Kacheln, Verordnungs-/Düngekarten
oder DJI-Missionssteuerung**.

**Bei roter oder noch ausstehender GitHub-CI diesen Test-PR nicht mergen.**
