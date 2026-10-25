# SkyHub-Next: konsolidierte M3M-Offline-/Smart-Farming-Integration

Stand: 23.10.2026. Repository: https://github.com/mason82-dotcom/SkyHub-Next

## Ziel und Geltungsbereich

Dieser Review-Branch `feature/m3m-consolidated-mainbase-20261023` ist
**direkt auf dem aktuellen Main-Commit `d815dcecc8474489d4f72614811fe6f379451166`**
aufgebaut. Er kopiert **nur die ausgewählten 38 neuen M3M-Dateien**
aus dem experimentellen Feature-Head und ergänzt einen kleinen
geschützten API-Mount, einen Dashboard-Link, einen gezielten CI-Job,
eine korrigierte Main-basierte HTTP-Testanbindung und dieses Review.

**Nicht** enthalten: die alten Pilot-2-STS-/Medien-Vorfahren, MinIO-IAM,
S3/XMP-Range-Probes, neue MQTT-Handler, Datenbankmigrationen oder
Komponenten zur Missionsausführung. Der M3M-Raw-TIFF-Audit arbeitet nur
mit lokal bereitgestellten Dateien. Das ist eine absichtliche
Schnittstellen- und Sicherheitsgrenze und **keine vollständige
Übernahme** der Medienkette.

## Ursprüngliche gestapelte Draft-Kette

`#40` (ursprüngliche XMP-/Pilot-2-Medienbasis) →
`#48` (Reflexionsindizes) → `#51` (lokaler TIFF-Audit) →
`#55` (DEDAL-/ODM-Handoff) → `#59` (Preflight) →
`#64` (Archiv- und Hashprüfung) → `#72` (Offline-End-to-End) →
`#77` (pixelweise QA) → `#79` (Integritätsbelege) →
`#82` (privater Kandidat) → `#84` (authentifizierter Katalog) →
`#86` (separater experimenteller UI-Tab).

Alle PR-Nummern beziehen sich auf
`https://github.com/mason82-dotcom/SkyHub-Next/pull/NUMMER`.
Die historischen Drafts bleiben offen; dieser Branch ersetzt
**nicht automatisch** ihre individuellen Reviewentscheidungen.

## Selektiv konsolidierte Funktionseinheiten

1. **11** lokale Python-Worker bzw. Requirementsdateien:
   vorab gepinnter DEDAL-Auftrag, Archiv-Strukturprüfung,
   lokaler uint16-TIFF-Inhalt, Orthomosaik→Float32,
   NDVI/NDRE/GNDVI/OSAVI, vollständige Pixel-/Masken-QA,
   SHA-256-Belege und experimentelle Kandidaten.
2. **10** synthetische Python-Testmodule mit echten lokalen GeoTIFFs
   in den Rasterintegrationstests.
3. **11** technische Smart-Farming-/M3M-Dokumente.
4. **3** Dateien für den Node.js-Read-only-Katalog und dessen Tests.
5. **3** Frontend-Dateien für getrennten Tab und Schema-/UI-Tests.

Dazu auf dem **aktuellen Main-Quellstand** neu ergänzt:
geschützter, opt-in Router unter
`/api/smart-farming/candidates/`, Navigation in
`frontend/public/index.html`, separate M3M-Teststufe
in `.github/workflows/ci.yml` und Anpassung des HTTP-Tests an
die Main-Authentifizierung (das ältere `backend/http-auth.js`
ist kein Teil von Main).

## Sicherheitsgrenzen

Der Katalog wird nur bei
`SKYHUB_M3M_CATALOG_ENABLED=true` gemountet und verlangt
zusätzlich einen außerhalb des HTTP-Requests konfigurierten
privaten Katalogstamm und einen unabhängigen Manifest-SHA-256.
**Default: deaktiviert.**
Die bestehende `/api`-Tokenprüfung sowie die Authentifizierung im
Katalogrouter bleiben erforderlich. Der Heimnetz-Read-only-Bypass
gilt **nicht** für diesen Endpunkt.

Der Katalog bietet nur NDVI-/NDRE-/GNDVI-/OSAVI-**Kennzahlen**,
keine GeoTIFFs, GPS-Daten, Kartenkacheln, Dateipfade,
Düngungsempfehlungen, Ausbringkarten, Exporte, DJI-Kommandos
oder Uploads. Browserantworten nennen ausdrücklich, dass
kein Raster-QA-Neulauf bei jedem GET erfolgt.

Alle Claims `radiometricCalibrationVerified`,
`reflectanceReady`, `operationalUseAllowed`,
`prescriptionExportAllowed`, `flightMissionAllowed`
bleiben `false`.

Keine Änderungen an Pi-`.env`, Docker-Stacks, MQTT-Broker,
Redis, PostGIS, MinIO, Zugangsdaten oder realen Fluggeräten.

## Nachgewiesene Prüfungen und offene Gates

- Alle Branchabhängigkeiten und PR-Zustände wurden am 23.10.2026
  gegen GitHub abgeglichen: Die Drafts #48 bis #86 sind offen und
  intern linear gestapelt, aber der Feature-Tip ist gegenüber Main
  **217 Commits voraus und 53 zurück**. Direkter Merge der alten
  Gesamt-Branchkette ist daher nicht vertretbar.
- Der alte Workflow `m3m-raster-offline.yml` meldet wiederholt
  `failure` mit **null ausgeführten Jobs**. Die Ursache ist anhand
  des GitHub-Job-API-Ergebnisses nicht abschließend bestimmbar; die
  jeweiligen grünen allgemeinen GitHub-Checks sind deshalb kein
  Nachweis für Rasterio-End-to-End-Tests.
- Der neue Main-basierte Review-Branch verwendet stattdessen den
  etablierten Workflow `.github/workflows/ci.yml` und **einen
  eigenständigen `m3m-raster-integration`-Job** mit Python 3.12,
  verpflichtender `pip --only-binary`-Installation von NumPy,
  Rasterio und anderen Offline-Abhängigkeiten sowie allen
  `test_m3m_*.py`-Tests. Frontend-Tests laufen zusätzlich in
  den bestehenden Node-22-Prüfungen.
- Ein erfolgreicher Workflow ist **erst nach GitHub-Run-Abschluss**
  belegt; fehlerhafte Integrationsfälle müssen vor jedem Merge
  repariert werden.
- Kein echter DEDAL-0.1.1-Code wurde installiert oder ausgeführt;
  reales Mavic-3M-Multispektralbild, Panelreferenz,
  Bandregistrierung, wissenschaftliche Kalibrierung, Provenienz,
  reproduzierbare Orthofotos und freigegebene Vegetationskarten
  bleiben offene Hardware-/Fachabnahmen.

## Merge-Entscheidung

**Nur nach erfolgreicher isolierter Raster- und allgemeiner CI,
Sicherheitsreview und geprüfter Branch-Diff zulässig.**
Die Katalogfunktion bleibt bei einem zukünftigen Merge zu Main
ausgeschaltet. Ein Git-Merge ist kein Pi-Deployment.

Bis dahin verbleibt dieser Konsolidierungs-PR im **Draft-Zustand**
und es werden **keine** alten gestapelten Drafts geschlossen,
als merged bezeichnet oder nach Main übernommen.


## Mainbasierter Folgebranch

Die nächste isolierte Übernahme erfolgt unter `feature/m3m-consolidated-main-latest-20261023` auf dem neueren Main-Stand nach TAK-Tab PR #93. Der historische Mergekonflikt von PR #88 wird nicht über einen Merge seiner älteren Historie gelöst. Die Kompatibilität mit dem aktuellen Server, der CI und dem neuen Dashboard ist separat neu zu prüfen; keine Pi- oder Hardwarefreigabe folgt daraus.
