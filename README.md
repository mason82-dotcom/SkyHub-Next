# SkyHub Next

**GitHub-Repository:** https://github.com/mason82-dotcom/SkyHub-Next  
**Hinweis:** Der frühere Repository-Slug `mason82-dotcom/SkyHub` leitet auf `SkyHub-Next` weiter. Das lokale Legacy-Verzeichnis `~/Projekte/SkyHub` ist weiterhin getrennt vom Entwicklungsverzeichnis `~/Projekte/SkyHub-Next` zu behandeln.

**Version 0.1.0 – Entwicklungsstand.** Die Branch-Suffixe v1/v2/v3/v4 sind keine Produktversionen.

SkyHub Next ist die **aktive Entwicklungsbasis im Repository-Root**. Sie verarbeitet DJI-Cloud-API-Telemetrie mit Node.js/Express, Socket.IO, MQTT, Redis und PostGIS und stellt ein kompaktes statisches Live-Dashboard bereit. Der Integrationsstand enthält eine **optional aktivierbare, authentifizierte und nur lesende Medien-API**; sie ist im Standard-Compose nicht mit MinIO-Zugangsdaten verdrahtet. Ein produktionsreifer Missionseditor und echte Analyse-Worker sind nicht freigegeben. Der Root-Code ist **nicht automatisch identisch** mit dem aktuell auf dem Raspberry Pi betriebenen alten Dienst.

## Aktueller Projektstand (23.10.2026)

**CI-Abnahme für M3M:** Der eigenständige [Raster-/Katalog-Prüfworkflow](.github/workflows/m3m-offline-acceptance.yml) ist durch PR #101 im Hauptbranch registriert und muss vor Zusammenführung dieser Komponenten auf genau dem finalen PR-Commit sowohl die echten NumPy-/Rasterio-Testfälle als auch die HTTP-/Berechtigungstests erfolgreich ausführen.

**Experimentelle M3M-Smart-Farming-Bausteine:** Offline-Worker für begrenzte TIFF-/DEDAL-/Rasterprüfungen, eine separate Oberfläche unter `/smart-farming.html` und ein **standardmäßig deaktivierter**, Bearer-geschützter Katalog mit gehashten Metadaten. Keine bestätigte radiometrische Kalibrierung, keine Kartentiles, Ausbringkarte, Agras-Ansteuerung oder DJI-Flugfreigabe. [Runbook und Abnahmegrenzen](docs/smart-farming-m3m-consolidation-review-2026-10-23.md). Kein Pi-Deployment durch Git-Merge.

**Passiver Flight-Area-Laborbaustein:** Die isolierten Module `backend/dji-flight-area-events.js` und `backend/dji-flight-area-sync-monitor.js` validieren synthetische DJI-Ereignisse, Soll-Hashes und Revisionszustände. Kein Runtime-Import, keine MQTT-Antwort, keine Flight-Area-Updates, keine luftrechtliche oder fliegerische Freigabe. Details: [Offline-Event-Inspector](docs/dji-flight-area-integration.md) und [Revisionsmonitor](docs/dji-flight-area-sync-monitor.md).

**Broker-Integrationsstand:** [Raspberry-Pi-Mosquitto-Migrationsanleitung](docs/pi-mosquitto-migration.md). Der Root-Stack kann optional Mosquitto/1883 statt EMQX/1884 konfigurieren, verlangt jedoch übereinstimmende `SKYHUB_MQTT_BROKER_KIND`-, `SKYHUB_MQTT_REQUIRED_PORT`- und MQTT-URL-Werte. Dies konfiguriert keinen Broker und ist **kein Live-Pi-Update**. Echte MQTT-ACL, Pilot-2-Session und Drohnen-OSD müssen separat überprüft werden.

**Integrationsnachtrag (23.10.2026, nach den früheren Main-Audits):** [PR #89](https://github.com/mason82-dotcom/SkyHub-Next/pull/89) wurde als eigenständige, rein offline genutzte WPML/KMZ-Bibliothek gemergt (Merge `1a2a01cf6331256697e27c1e8846f0746bf90f01`). Der Editor und die browserlokale Routenbibliothek sind vorhanden, aber weder mit der DJI-Flugsteuerung noch einer produktiven Backend-Missions-API verbunden; der SQL-Routendraft ist nicht installiert. [PR #65](https://github.com/mason82-dotcom/SkyHub-Next/pull/65) ergänzt die isolierte FlightHub-2-On-Premises-Frontend-Referenz (Merge `0a85f92881aa4571ffc4b5b7bc86d35b8e81b0ee`), ausdrücklich ohne FlightHub-Runtime, Projekttoken oder Steuerpfad. Die früheren Statusabschnitte unten dokumentieren ihren damaligen Zeitpunkt und ersetzen diese Ergänzung nicht.

**Raspberry-Pi-Betriebsgrenze:** Der Code erwartet im Standard-Compose weiterhin MQTT auf Hostport **1884** und `scripts/pi-preflight.sh` prüft ausdrücklich den historischen Container `skyhub_emqx`. Nach dem zuletzt gemeldeten Pi-Umbau (EMQX entfernt; Mosquitto auf **1883**) ist das nicht mehr ohne weiteres kompatibel. Aktuelle Listener, Broker-ACL, Zieltopics und Compose-Environment zuerst vor Ort lesen und den MQTT-Vertrag separat migrations- und CI-sicher überarbeiten. Bis dahin nur Git-Synchronisierung, statische Tests und Diagnose; **nicht** `scripts/pi-update-backend.sh --apply`, `docker compose up`, Portumbiegung oder Broker-Neukonfiguration ausführen.

**Integrationsnachtrag 23.10.2026:** Die drei read-only DJI-Lebenszyklus-PRs [#74](https://github.com/mason82-dotcom/SkyHub-Next/pull/74), [#78](https://github.com/mason82-dotcom/SkyHub-Next/pull/78) und [#83](https://github.com/mason82-dotcom/SkyHub-Next/pull/83) sind in dieser Reihenfolge nach `main` gemergt. Enthalten sind ausschließlich die **nicht am Server verdrahtete** Missionsbeobachtung, die strikte `services_reply`-Korrelation und das isolierte PostgreSQL-CAS-Journal einschließlich Offline-/CI-Tests. **Kein Missionsversand, keine produktive Journalmigration, keine Pi-Installation und keine Hardwarefreigabe.** Siehe [Beobachtungslebenszyklus](docs/dji-rpc-lifecycle-observation.md), [RPC-Vertrag](docs/dji-flighttask-rpc-integration.md) und [Persistenzgrenzen](docs/dji-flighttask-durable-journal.md).

**Integrationsnachtrag 24.10.2026:** [PR #108](https://github.com/mason82-dotcom/SkyHub-Next/pull/108) wurde nach erfolgreicher Node- und isolierter PostgreSQL-CI nach `main` gemergt. Der [read-only Multi-Missions-Router](docs/dji-flighttask-multimission-router.md) findet Kandidaten ausschließlich im autorisierten Workspace über `gatewaySn` + `tid` + `bid` (Service-Antwort) beziehungsweise `gatewaySn` + `flight_id` (Fortschrittsereignis). **Bei null oder mehreren Treffern findet keine Zustandsänderung statt.** Die Weitergabe läuft über die [isolierte Workspace-Autorisierung](docs/dji-flighttask-journal-access.md) und den [CAS-Journalspeicher](docs/dji-flighttask-durable-journal.md); für abgelaufene terminale Beobachtungen gibt es einen [separaten Offline-Retention-Vertrag](docs/dji-flighttask-journal-retention.md). Keine Anbindung an `backend/server.js`, kein MQTT-Kommando, kein produktives PostgreSQL-Schema, keine Pi-Installation und keine DJI-Hardwarefreigabe. CI-Status der **anderen** M3M-Akzeptanz-Workflows ist gesondert zu bewerten, nicht aus der grünen Haupt-CI abzuleiten.

**Nachtrag 24.10.2026 (Pi-Betrieb):** Der opt-in Broker-Typ `mosquitto-dedicated` (authentifiziertes Mosquitto auf Port 1884, [PR #118](https://github.com/mason82-dotcom/SkyHub-Next/pull/118), siehe [Migrationsanleitung](docs/pi-mosquitto-migration.md)) ist in `main`. Über ihn wurde die RC Pro Enterprise mit Mavic 3M direkt gelesen bestätigt (8/8 Kriterien, 6/6 M3M-Erweiterungspfade frisch, 0,5 Hz ohne Lücken; [Hardware-Abnahmestatus](docs/hardware-acceptance-status-2026-10-24.md)). Das ist eine lesende Bodenbeobachtung, kein Flugtest. Neu dokumentiert: die [Bewertung von FlightHub 2 On-Premises](docs/dji-flighthub2-on-premises-bewertung.md) (nicht auf dem Pi und nicht mit der M3M nutzbar) und der [lokale Cloud-API-Demo-Testweg](docs/cloud-api-demo-lokal.md) mit Offline-Karte. Zum Zeitpunkt dieses Eintrags offen: [#123](https://github.com/mason82-dotcom/SkyHub-Next/pull/123) (Probe-Geisterobjekt `SKYHUBPROBE`), [#124](https://github.com/mason82-dotcom/SkyHub-Next/pull/124) (Broker-/Update-Skript-Tests) und [#138](https://github.com/mason82-dotcom/SkyHub-Next/pull/138) (Host-InfluxDB absichern).

**Verbindliche Bestandsaufnahme:** [Projektstand, offene Entwicklungszweige und Integrationsgates](docs/projektstand-2026-10-23.md).
Die Main-Basis nach [#61](https://github.com/mason82-dotcom/SkyHub-Next/pull/61) (HTTP-Fix), [#47](https://github.com/mason82-dotcom/SkyHub-Next/pull/47) (synthetisches Protokollaudit) und [#66](https://github.com/mason82-dotcom/SkyHub-Next/pull/66) (rein lesende Hardwarediagnostik) ist Commit
[`64e427c3d9488da80a391cd43d0308771f480955`](https://github.com/mason82-dotcom/SkyHub-Next/commit/64e427c3d9488da80a391cd43d0308771f480955)
(vom 23.10.2026). Der nachfolgende Stand unterscheidet ausdrücklich **Main**,
**offene/gestapelte Pull Requests**, **in den Integrationsbranch gemergte PRs**,
**CI-Nachweise** und **Hardwarebeobachtungen**.

- **In Main:** DJI-MQTT-Leseeingang, Topologie/Registry, Pilot-2-HTTPS-Kopplung,
  statisches Dashboard, Feldfrische, HMS/Tracks, optionale begrenzte Topologie-Antwort
  und PostGIS-/Redis-Basis; außerdem die korrigierte DJI-Modell-Felddiagnose
  sowie den **nicht im Server gemounteten, synthetischen Offline-DJI-1.18-Paritätsaudit**.
  Zusätzlich **isolierte Offline-Hardwareprüfer** für RC Pro/M3M und RC Plus 2/M4T,
  M3M-Feldlücken-Klassifikation und synthetische Regressionen; die reale
  RC-Plus-2/M4T-Hardwareabnahme ist weiterhin ausstehend.
  Hinzugekommen ist die **nur lokal aufrufbare M3M-Dateinamen-Inventur aus [#68](https://github.com/mason82-dotcom/SkyHub-Next/pull/68)** (RGB/G/R/RE/NIR-Gruppenzähler, alle Reflexions-/NDVI-Flags `false`). Der gesondert geprüfte PR-#24-Integrationsstand enthält zusätzlich optionale, authentifizierte MinIO-Leseendpunkte; **kein** Pilot-2-Medienupload.
  Ebenfalls integriert: [#73](https://github.com/mason82-dotcom/SkyHub-Next/pull/73), ein **inaktiver, separat zu injizierender S3-ListObjectsV2-Vertrag** mit Prefix-/Cursor-/Mengengrenzen. Der im Integrationsstand hinzugekommene S3-Reader ist separat vom strikt scoped List-only-Vertrag; er bleibt standardmäßig deaktiviert und benötigt eigenständig geprüfte Reader-Credentials.
  Flugspuraufzeichnung und Medien-API bleiben standardmäßig aus.
- **Nicht produktiv freigegeben:** das neue Command Center, Pilot-2-Medien-HTTPS/STS,
  Live-XMP-/Band-Kalibrierung, WPML-/KMZ-Offline-Inspektion, NDVI-/NDRE-Rasterexperimente,
  YOLO11, Thermal-Geolokalisierung und HiveMind-Simulationslabor.
  Teilkomponenten sind in offenen PRs beziehungsweise im separaten Integrationszweig.
- **Abgrenzung:** Ein Merge in `develop/skyhub-integrated-readonly-20261022`
  ist kein Merge nach `main`, und ein erfolgreicher CI-Lauf ist keine Pi-Installation
  oder DJI-Hardwarefreigabe. Kein Missionsversand, kein allgemeiner Sensor-Messwertnachweis.
- **Dokumentationsregel:** Historische Protokolle bleiben datiert; der verifizierte
  Stichtagsstand steht im verlinkten Integrationsregister.

## WPML-Routenbibliothek (noch **nicht** produktiv freigegeben)

Die über [PR #89](https://github.com/mason82-dotcom/SkyHub-Next/pull/89) in `main` integrierte WPML-Bibliothek stellt ausschließlich **Offline-Komponenten** unter `/wpml-editor.html`, `/wpml-route-library.html` und `/wpml-survey-preview.html` bereit. Dazu gehören strikt validierte KMZ/WPML-Inspektion, lokale Routenrevisionen, Action Groups sowie explizites **unverschlüsseltes** Browser-Backup. WPML wird nicht als DJI-Flugauftrag versendet.

Der zentrale PostgreSQL-Routenentwurf `backend/db/migrations/003_wpml_route_library_draft.sql` bleibt deaktiviert (Default-Deny-RLS). Keine automatische Migration, kein MQTT-Publish, keine DJI-/Pilot-2-Hardwarefreigabe und keine Änderung an produktiven Raspberry-Pi-Diensten. [WPML-Integrationsgates](docs/wpml-main-integration.md) und [technische WPML-Referenz](docs/dji-waylines-sdk-reference.md).

## Projektstruktur

| Pfad | Zweck |
|---|---|
| `backend/` | Server, DJI-/MQTT-Adapter, Registry, Topologie, Pilot-Pairing, Track-Store und Tests |
| `frontend/public/` | Statische Dashboard- und Pilot-2-Oberfläche (kein Build-Schritt) |
| `scripts/` | Pi-Preflight, Diagnose, Backup und Cutover-Audit |
| `docs/` | Architektur, Sicherheit, Betrieb und Migrationskonzept |
| `docker-compose.yml` / `.env.example` | **Aktive** SkyHub-Next-Staging-Konfiguration |
| `stacks/legacy-skyhub/` | **Archivierter Snapshot – nicht starten** |
| `stacks/caddy/` | Übernommene Caddy-Konfiguration als Referenz |

## Dokumentation

- [Dokumentationswegweiser](docs/index.md)
- [Konfigurationsreferenz: Env, Compose, Flags und Startgrenzen](docs/config-reference.md)
- [API-Referenz: HTTP, Socket.IO, MQTT und Zugriffsmatrix](docs/api-reference.md)
- [Projektstand 23.10.2026: Main, PR-Ketten, Test-/Hardware-Evidenz](docs/projektstand-2026-10-23.md)
- [Priorisierter Integrationsplan: PR-Basisgraph, Reihenfolge und Prüfbedingungen](docs/integration-priorities-2026-10-23.md)
- [Gemeinsame Offline-Hardwarediagnostik: RC Pro/M3M, RC Plus 2/M4T](docs/hardware-diagnostics-consolidation.md)
- [M3M-Kamerafeldlücken ohne Thermografie-Fehlschluss](docs/m3m-camera-gap-analysis.md)
- [M3M-Medieninventur Phase 1: rein lokale Dateinamen- und Bandzähler](docs/m3m-offline-media-inventory.md)
- [Experimenteller S3-Lesekontrakt: begrenzte ListObjectsV2-Pagination, noch kein Live-Client](docs/m3m-s3-read-contract.md)
- [RC Plus 2/Matrice 4T: read-only Hardware-Prüfverfahren](docs/hardware-rc-plus2-m4t.md)
- [Architektur, Komponenten, Telemetrie-Integrität und API](docs/architecture.md)
- [Betrieb, Tests, Pi-Preflight und historische Diagnosebefunde](docs/ops.md)
- [Sicherheitsmodell, Authentifizierung, TLS und LAN-Zugriff](docs/security.md)
- [Trennung vom Legacy-Stack und Migrationsübersicht](docs/legacy-migration.md)
- [Legacy-Abhängigkeitsaudit und Bereinigungsentscheidung](docs/legacy-dependency-audit.md)
- [Betriebswerkzeuge: Nur lesen, Dateien schreiben oder Live-System ändern](docs/scripts.md)
- [Detaillierter Cutover- und Rollback-Plan](docs/skyhub-legacy-takeover.md)
- [DJI MQTT-/OSD-Integration](docs/mqtt-osd-integration.md)
- [DJI Cloud-API-Kompatibilität](docs/dji-cloud-api-compatibility.md)
- [Offline Cloud-API-1.18-Protokoll-Paritätsaudit (16 synthetische Fälle)](docs/dji-protocol-parity-audit.md)
- [Archivhinweise](stacks/README.md)

## Positionsaufzeichnung (standardmäßig deaktiviert)

Die Live-Telemetrie, Kartendarstellung und MQTT-OSD-Verarbeitung laufen
unabhängig von der PostGIS-Flugspuraufzeichnung. Mit
`SKYHUB_TRACK_RECORDING_ENABLED=false` (Standard) werden keine neuen
`drone_telemetry`-Punkte gespeichert; auch die automatische Löschung
alter Spurpunkte ist pausiert. Bestehende Spuren bleiben in der Datenbank
und sind weiterhin über die lesende Track-API abrufbar. Der Health-Endpunkt
meldet dann `trackRecordingEnabled:false`. Erst explizites `true`
und ein gezieltes Backend-Update aktivieren die Aufnahme wieder.
Die lokale `.env` bleibt unverändert.

## Erweiterte Live-Telemetrie

Das Dashboard zeigt neben den bisherigen Basiswerten zusätzliche bereits
durch den DJI-Parser unterstützte OSD-Felder an: Kurs, Vertikalgeschwindigkeit,
Nick-/Rollwinkel und Positionsqualitätscode. Außerdem wertet der Parser
optionale DJI-OSD-Felder für Wind (Geschwindigkeit und achtteiliger Richtungssektor),
kumulierte Flugzeit/-strecke sowie SDR-/4G-Verbindungszustände und 4G-Qualität
aus. Fehlende oder durch DJI mit ungültigen Sentinelwerten gemeldete
Messwerte werden nicht erraten. Nicht gemeldete optionale Felder
werden nicht als Messwerte ausgegeben; ein RTK-Fix-Code wird nicht mit dem
RTK-Ein/Aus-Schalter gleichgesetzt. Der Geräte-Snapshot enthält zuletzt
beobachtete Einzelwerte, deren Aktualität nun feldweise ausgewiesen wird.
Die DJI-MQTT-Verbindung, die Positionsaufzeichnung und die Pilot-Kopplung
bleiben unverändert.

### Feldgenaue Aktualität ohne Speicherung

SkyHub hält zu jedem empfangenen DJI-OSD-Feld `telemetryFieldAt` und
`telemetryFieldTimeVerified` in der flüchtigen Live-Registry im RAM.
Sie können über den geschützten HTTP-/WebSocket-Kanal abgerufen werden, werden
aber vor dem Schreiben in den Redis-Gerätecache explizit ausgeschlossen. Diese Metadaten
erscheinen in der bestehenden authentifizierten Geräte-API und ermöglichen
dem Dashboard, Einzelwerte als aktuell (weniger als 15 Sekunden),
veraltet, nicht empfangen oder „Zeit ungeprüft“ zu markieren. `(0,0)`
und unvollständige Koordinaten aktualisieren die Zeiten früherer gültiger
GPS-Fixes nicht. Ein anderes, frisch empfangenes OSD-Feld macht einen
alten Messwert nicht frisch. Die automatische Aktualisierung der Feld-
statuslabels baut die Gerätekarten nicht neu auf. Es werden keine
neuen PostGIS-Daten geschrieben und
`SKYHUB_TRACK_RECORDING_ENABLED=false` bleibt unverändert.

## Read-only-Feldinventar für Pilot 2

Auf dem Pi lässt sich mit `node scripts/pi-telemetry-fields-check.js` die
Verfügbarkeit von DJI-OSD-Feldern **getrennt nach Geräteklasse** prüfen.
Die fünf typischen RC-Felder werden separat von Fluggeräte-Telemetrie
ausgewertet. Weitere optionale Felder und gerätespezifisch nicht anwendbare
Felder werden getrennt aufgeführt. „Nicht beobachtet“ bedeutet weder
„nicht unterstützt“ noch „Parser defekt“.
 Die Ausführung nutzt nur
`docker compose exec` und den vorhandenen Backend-Zugriff auf die Geräte-API.
Ausgegeben werden ausschließlich Feldnamen und boolesche GPS-/OSD-Zustände,
**keine** Seriennummern, GPS-Koordinaten, Messwerte oder Zugangsdaten.
Keine Datei wird geschrieben. Der Report zeigt Felder, die im aktuellen
Geräte-Snapshot schon einmal beobachtet wurden; er ist kein Nachweis
für Werte im letzten einzelnen OSD-Paket.

## Sicher prüfen – ohne Deployment

```bash
node --check backend/server.js
node --test backend/test/*.test.js
python3 -m unittest discover -s tests -p 'test_*.py'
docker compose --env-file .env.example config --quiet
```

Diese Befehle starten keine SkyHub-Container. Die Compose-Konfigurationsprüfung führt keine Laufzeitvalidierung von MQTT, DJI-Hardware oder Caddy durch. Der Pi-spezifische, rein lesende Vorabcheck ist `bash scripts/pi-preflight.sh`; Details und Grenzen stehen in [Betrieb](docs/ops.md).

## Isolierte Staging-Umgebung

Das Root-Compose verwendet den Projektnamen `skyhub-next`, standardmäßig **127.0.0.1:4001** für das Backend und den vorhandenen Pi-EMQX auf **Hostport 1884**. Ein separates EMQX wird **nicht** gestartet; Port **4000** gehört bis zu einem ausdrücklich freigegebenen Cutover dem bisherigen Dienst. `.env` bleibt lokal und darf nicht versioniert werden. `.env.example` enthält nur Platzhalter und ist keine startfertige Konfiguration.

**Nicht** `docker compose up` im Archiv `stacks/legacy-skyhub/` ausführen und keine Docker-Container oder Datenvolumes im Rahmen eines Repo-Cleanups ersetzen. Produktivmigration und DJI-Hardwareabnahme sind getrennte Arbeitsschritte: [Legacy-Migration](docs/legacy-migration.md).

## Fortgesetzte Roadmap: DJI-Karte und PostGIS (P1/P2)

Der konsolidierte Root-Stack enthält die isoliert getesteten PostGIS- und Backup-/Restore-Prüfungen sowie eine standardmäßig deaktivierte DJI-Kartengruppen-GET-Route. Die serverseitige Pilot-Workspace-Bindung erlaubt ausschließlich lesenden Zugriff auf verteilte Gruppen. Die Mutationsengine samt revisionsbasierten Transaktionen und Audit ist **nur ein interner Entwurf**, nicht vom Backend geladen. Weder DJI-Karten-Schreib-APIs noch Missionen sind freigeschaltet.

- [DJI-Cloud-API-Referenz und Meilensteine](docs/dji-reference-roadmap.md)
- [DJI-Map-Elementvertrag](docs/dji-map-element-contract.md)
- [Workspace-Berechtigungen und Pilot-RBAC](docs/dji-map-access.md)
- [Interner Mutationsvertrag und Audit (kein Live-Schreibpfad)](docs/dji-map-mutation-contract.md)
- [Isolierte PostGIS- und Dump-/Restore-Tests](docs/postgis-isolated-validation.md)
- [Entwicklungsplan und Fortschritt](docs/entwicklungsplan-2026-10-20.md)

**Pi-Update:** Ein Git-Merge ist kein Deployment. Vor einem Update auf dem Pi lokale `.env`, Overrides und persistente PostGIS-Daten sichern, nur das bestehende Backend aktualisieren und danach über `/api/health` prüfen. Keine Compose-Volumes löschen, keine Legacy-Dienste starten und keine offenen DJI-Feature-Flags ungeprüft aktivieren.
