# SkyHub-Next: M3M-Konsolidierung und Offline-Abnahme

**Stand: 24.10.2026** · Repository: https://github.com/mason82-dotcom/SkyHub-Next

## Bestätigte Integration nach main

Die eigentliche, zuvor aus elf Draft-PRs gestapelte M3M-Funktionalität
ist bereits über [PR #100](https://github.com/mason82-dotcom/SkyHub-Next/pull/100)
in **main** übernommen worden. Die Korrektur des fehlerhaften
M3M-Workflow-YAMLs wurde über
[PR #107](https://github.com/mason82-dotcom/SkyHub-Next/pull/107)
ebenfalls gemergt.

Für den Main-Commit `42bba3c95f4ae41dcbbe374132a83d7a5ab8fe47`
lief [SkyHub Next checks #40049459608](https://github.com/mason82-dotcom/SkyHub-Next/actions/runs/40049459608)
**erfolgreich mit vier ausgeführten Jobs**:

- `m3m-raster-integration`: Python-Syntax, unabhängige Binärpakete,
  synthetische Raster- und Integritätssuites sowie CLI-Hilferouten.
  Das zugehörige Jobprotokoll dokumentiert **138 Python-Tests und OK**.
- `dji-parser-tests`: Node-Backendtests, Smart-Farming-UI-Vertrag,
  Konfigurations- und Containerprüfung.
- `isolated-postgis-integration` und
  `isolated-postgis-backup-restore`: grüne isolierte DB-Prüfungen.

Dies sind **echte GitHub-Jobausführungen** und nicht nur Statusmeldungen
ohne Job. Die ursprünglichen älteren M3M-Workflow-Fehler mit null
Jobs gelten nicht als fehlgeschlagene Raster-Suiten.

## Warum PR #104 nicht nach main gehört

[Draft-PR #104](https://github.com/mason82-dotcom/SkyHub-Next/pull/104)
wurde unabhängig vom bereits abgeschlossenen PR #100 erstellt. Zum
Zeitpunkt der letzten Prüfung war er **14 Commits hinter** und
**18 Commits vor** aktuellem main; GitHub gab `mergeable=false` zurück.
Von 47 betroffenen M3M-Artefakten waren **34 bytegleich** mit main,
weitere 10 waren auf main durch neuere Anpassungen ersetzt worden.
Ein Merge des alten Drafts könnte Auth-, UI- und CI-Härtungen
überschreiben. Der alte Branch bleibt zur historischen
Nachvollziehbarkeit bestehen, ist aber **keine zweite Integrationsquelle**.

Die fehlende ergonomische Funktion, eine ausdrücklich isolierte
Offline-Abnahme anzustoßen, wird separat übertragen als
`scripts/m3m-offline-verify.sh` mit zusätzlichen
Fail-Closed-Tests. Sie verändert weder den Main-Server noch
Docker-, MQTT-, MinIO- oder DJI-Betriebskonfigurationen.

## Optionaler Offline-Laborlauf

**Nur in einem separaten, verlinkten Git-Worktree**; der Hauptklon
wird aus Sicherheitsgründen abgewiesen.

```bash
cd ~/Projekte/SkyHub-Next
git fetch origin
git worktree add ~/Projekte/SkyHub-M3M-Lab \
  origin/chore/m3m-offline-handoff-20261024
cd ~/Projekte/SkyHub-M3M-Lab

python3 -m venv .venv-m3m
source .venv-m3m/bin/activate
python -m pip install --only-binary=:all: \
  -r backend/workers/m3m_requirements.txt
npm ci --prefix backend --ignore-scripts --no-audit --no-fund

SKYHUB_M3M_OFFLINE_LAB=1 bash scripts/m3m-offline-verify.sh
```

Wichtig: Der Starter selbst installiert nichts und verlangt
eine eigene Python-venv, ein echtes (nicht symlinkbasiertes)
`backend/node_modules` und den Opt-in-Wert.
Er verweigert die Ausführung aus dem primären Git-Checkout.
Die synthetischen Tests verwenden lokale temporäre Testbilder,
keine produktive Pi-Medienablage.

Ein bestandenes Ergebnis belegt lediglich die implementierten
Mathematik- und Sicherheitsverträge; **nicht** den tatsächlichen
DEDAL-Quellcode, Reflexionspanel-Kalibrierung, exakte Bandregistrierung,
Flächengenauigkeit, Agronomie oder Flugfreigabe.

## Verbleibende fachliche Freigabegates

Vor realen multispektralen Karten und Agro-/WPML-/Agras-Ausgaben sind
mindestens folgende Nachweise erforderlich:

1. Originales DEDAL-Archiv, Lizenz, CLI und ausführbare Verarbeitung
   reproduzierbar und sicher prüfen.
2. Vollständigen, dokumentiert kalibrierten Mavic-3M-Datensatz
   mit Green/Red/RedEdge/NIR, Panelreferenz und Prüftargets auswerten.
3. Band-Coregistration und reflektanzbasierte Qualitätsgrenzen
   unabhängig bestätigen.
4. Authentifizierte, versionierte Datensatzverknüpfung und
   autorisierte Tile-/GIS-Vorschau separat abnehmen.

Bis dahin gelten `reflectanceReady=false`,
`operationalUseAllowed=false`,
`prescriptionExportAllowed=false` und
`flightMissionAllowed=false`. Es wurde keine
Pi-Bereitstellung, Aktivierung des optionalen Katalogs oder
Missionsübertragung vorgenommen.
