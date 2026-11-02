# SkyHub Next – Dokumentationswegweiser

**Repository:** https://github.com/mason82-dotcom/SkyHub-Next. Historische GitHub-Links wurden auf den neuen Slug normalisiert; die lokalen Pi-Verzeichnisse `SkyHub` (Legacy) und `SkyHub-Next` (Entwicklung) bleiben unterschiedlich.

**GitHub-Audit 02.11.2026:** [Aktuelle Bestandsaufnahme, PR-Triage und sichere Bereinigung](repository-audit-2026-11-02.md). Diese Momentaufnahme ersetzt nicht die auf dem Pi zu verifizierenden Betriebsdaten.

**Repository und PRs:** [Offene Pull Requests](https://github.com/mason82-dotcom/SkyHub-Next/pulls) und [`main`](https://github.com/mason82-dotcom/SkyHub-Next/tree/main) sind die Live-Ansichten. Die [GitHub-Bestandsaufnahme vom 25.10.2026](repository-status-2026-10-25.md), die [Hygieneprüfung](repository-hygiene-2026-10-25.md) und der [PR-Triagebericht](pr-triage-2026-10-24.md) sind datierte Momentaufnahmen, keine Live-Zahlen oder Mergefreigaben.

**Navigationsstand ergänzt am 02.11.2026; dokumentierter Raspberry-Pi-Betriebsstand weiter vom 27.10.2026.** Primäre Einstiegspunkte sind der [Betriebsstand des Pi vom 27.10.2026](stand-2026-10-27-betriebsstand.md), der [Main-Audit des Quellcodes](stand-2026-10-25-main-audit.md) und die [Dokumentationspflege](dokumentationspflege.md). Die bisherige Repository-Statusdatei und die umfangreichen PR-Triageberichte sind ältere Messungen **desselben Tages** und kein Ersatz für eine aktuelle GitHub-Abfrage. Diese Navigation gilt für den Root-Stack `skyhub-next`. Die wichtigste Unterscheidung ist die zwischen dem **Code auf `main`** und **noch nicht integrierten Entwicklungszweigen**.

## Raspberry-Pi-Betrieb (Stand 27.10.2026)

- [**Betriebsstand 27.10.2026**](stand-2026-10-27-betriebsstand.md) – Stack, Proxy-Peers, gemeinsamer MinIO, Backup/Restore, Neustarttests, Log-Rotation, offene Punkte (Messungen auf dem Gerät, keine Flugfreigabe).
- [Betriebsvorfälle 26.10.2026](vorfaelle-2026-10-26.md) – Postgres-Ausfall durch `docker compose up` ohne arm64-Overlay und hängendes `docker logs --tail` nach externer Log-Rotation, mit Konsequenzen.
- [Compose auf dem Pi: `scripts/pi-compose.sh`](ops.md#compose-auf-dem-pi-immer-mit-den-overlays-pi-composesh) – nie `docker compose up` ohne Overlays.
- [Gemeinsamer MinIO-Objektspeicher](minio-shared-storage.md) (Entwurfsstand 21.10., Betrieb siehe Betriebsstand) und das [Backup-/Restore-Paket `pi-minio-acceptance`](../pi-minio-acceptance/README.md) mit [Validierung](../pi-minio-acceptance/VALIDIERUNG.md).
- [Betriebswerkzeuge – Wirkung und Freigabe](scripts.md), [Mosquitto-Migration](pi-mosquitto-migration.md), [Host-InfluxDB absichern](pi-influxdb-hardening.md), [TSA-/Proxy-Härtung](tsa-proxy-hardening-2026-10-24.md).
- [Cloud-API-Demo als lokaler Testweg](cloud-api-demo-lokal.md) und das Begleitprojekt [Pi-Hub](pi-hub.md) (Weboberfläche für den Pi-Betrieb, eigenes lokales Repository).

## Sicherheit und Engineering-Review

- [Technischer Main-Review (25.10.2026)](engineering-audit-2026-10-25.md) – Proxy-Trust-Risiken auf dem damaligen Stand; der Sicherheitsentwurf ist inzwischen **in `main` (PR #176) und auf dem Pi ausgerollt**.
- [Exakte Caddy/HTTP-Proxy-Peers: Migration, Abnahme, Rollback](proxy-trust-rollout.md) – umgesetzt; der Peer ist das Docker-Gateway der Bridge, nicht `127.0.0.1`. Nach einem Neuanlegen des Netzes erneut mit `scripts/pi-proxy-peer-check.sh` prüfen.

## Zuerst lesen

1. [README / Produktumfang](../README.md), [Main-Audit 25.10.2026](stand-2026-10-25-main-audit.md), [Dokumentationsregeln](dokumentationspflege.md) und [Live-PRs](https://github.com/mason82-dotcom/SkyHub-Next/pulls)
2. [Projektstand 23.10.2026 / verifizierter Main-SHA, PR-Status und Integrationsgates](projektstand-2026-10-23.md)
   - [Priorisierte Integrationsstrategie: PR-Abhängigkeiten, Merge-Gates und neue Research-Zweige](integration-priorities-2026-10-23.md) – historischer Plan, gegen heutigen `main` neu prüfen
3. [Architektur, Datenwege und API](architecture.md)
4. [Sicherheitsmodell, Authentifizierung und LAN/TLS](security.md)
5. [Betrieb, Checks und kontrolliertes Backend-Update](ops.md)
6. [Konfigurationsreferenz: Compose, Env und Feature-Flags](config-reference.md)
7. [API-Referenz: HTTP, Socket.IO, MQTT, Autorisierung](api-reference.md)

## Datenbank-Migrationsregister (statisch, keine Freigabe)

- [SQL-Inventar, eindeutige Familien-IDs, gesperrter WPML-Draft und Migration-Gates](sql-migration-inventory.md) – kein SQL-Runner, keine produktive Migration; [Issue #177](https://github.com/mason82-dotcom/SkyHub-Next/issues/177).

## Smart Farming – neue Fach-Roadmap (24.10.2026)

- [Smart-Farming-Roadmap 2.1: quantitative M3M-Messdaten, wissenschaftliche QA, GIS, Agronomie und Release-Gates](smart-farming-roadmap-2026-10-24.md) – **Planung, keine Produktivfreigabe**.
- [Experimentelle M3M-Konsolidierung PR #104](https://github.com/mason82-dotcom/SkyHub-Next/pull/104) – **geschlossen, ersetzt durch den gemergten PR #100; reale Kalibrierungsabnahme offen**.

## Technische Referenz des Hauptbranches

- [Telemetrie-Cockpit (Operations)](telemetry-cockpit.md) – acht OSD-Einzelwerte je Gerät, Frische pro Feld; rein lesend, keine Flugfreigabe.

**Workspace-Isolation und Löschrichtlinie (neuer Offline-Entwurf):** [PostgreSQL-RLS, transaktionsgebundener Mandantenkontext und Legal-Hold-Gates](dji-flighttask-workspace-rls-retention-policy.md). Keine Migration, keine produktive Autorisierungsquelle.

**DJI-Missionsbeobachtung: #74/#78/#83 und Multi-Missions-Router #108 in `main`:** [Statusautomat](dji-rpc-lifecycle-observation.md), [read-only Reply-Adapter](dji-flighttask-rpc-integration.md), [isoliertes CAS-Journal](dji-flighttask-durable-journal.md), [Offline-Retention](dji-flighttask-journal-retention.md) und [optionale Workspace-Autorisierung](dji-flighttask-journal-access.md) und [experimentelles Multi-Missions-Routing](dji-flighttask-multimission-router.md). Die Module sind **nicht in die aktive DJI-Laufzeit eingebunden**; kein produktives SQL-Deployment oder freigegebener Identity Provider.

| Bereich | Dokumente |
| --- | --- |
| DJI MQTT, OSD, Pilot-2-Handshake | [MQTT/OSD](mqtt-osd-integration.md), [DJI Cloud API](dji-cloud-api-compatibility.md) |
| DJI Cloud API 1.18 – rein synthetischer Offline-Abgleich | [Paritätsaudit #47](dji-protocol-parity-audit.md), [isolierter Diagnosefix #61](https://github.com/mason82-dotcom/SkyHub-Next/pull/61) |
| S3-Vertrag (nur isolierte synthetische Leseversuche; kein realer Client) | [M3M-S3-ListObjectsV2-Scopes und Pagination](m3m-s3-read-contract.md) |
| M3M-Dateinamen-Inventur (nur offline; kein Bild- oder S3-Zugriff) | [Phase 1: Datei-/Band-Namen und Grenzen](m3m-offline-media-inventory.md) |
| Geräte-/Feldabdeckung | [DJI 1.18-Feldkatalog](dji-118-field-audit.md), [Hardware-Abnahmestatus 24.10.2026](hardware-acceptance-status-2026-10-24.md), [RC Pro + M3M Hardwarebefund](hardware-rc-pro-m3m.md), [M3M-Kamera-/State-Feldlücken](m3m-camera-gap-analysis.md), [RC Plus 2/M4T-Diagnose](hardware-rc-plus2-m4t.md), [gemeinsame Offline-Konsolidierung](hardware-diagnostics-consolidation.md) |
| DJI-Kartenelemente (GET, interner Schreibentwurf) | [Feld-/Schnittstellenvertrag](dji-map-element-contract.md), [Berechtigungen](dji-map-access.md), [Mutationsvertrag – nicht live](dji-map-mutation-contract.md), [Aktivierungsstand 24.10.2026](dji-map-elements-aktivierung-2026-10-24.md) |
| Geodaten- und Datenbanktests | [Isolierte PostGIS-Validierung](postgis-isolated-validation.md), [DJI-Referenz-Roadmap](dji-reference-roadmap.md) |
| Betriebssicherheit und Migration | [Skriptwirkung](scripts.md), [Host-InfluxDB absichern](pi-influxdb-hardening.md), [Legacy-Migration](legacy-migration.md), [Legacy-Dependency-Audit](legacy-dependency-audit.md), [Takeover/Rollback](skyhub-legacy-takeover.md) |
| Frontend-Kontrakte | [UX-CONTRACT](../UX-CONTRACT.md), [DESIGN](../DESIGN.md) |
| Offene Pull Requests – datierte Triage (Messung, kein Merge-Beschluss) | [Register und Triage (25.10., abends)](pr-dependency-register-2026-10-25.md), [früherer GitHub-Stand](repository-status-2026-10-25.md) |
| FlightHub 2 Frontend – optionale Herstellerkomponenten, nur Referenz | [FH2-On-Premises-Komponenten und Sicherheitsgates](dji-flighthub2-frontend-components.md) |
| FlightHub 2 On-Premises – Bewertung (Recherche, kein Test) | [Bezug, Anforderungen, Geräte, Frontend-Komponenten](dji-flighthub2-on-premises-bewertung.md) |
| DJI-Cloud-API-Demo als lokaler Testweg (extern zum Repo, nur LAN) | [Stack, Absicherung, Offline-Karte, Grenzen](cloud-api-demo-lokal.md) |

## Passiver DJI Flight-Area-Laborstand

[Event-Inspector](dji-flight-area-integration.md) · [Offline-Zielrevisionsmonitor](dji-flight-area-sync-monitor.md). Ausschließlich gelesene, begrenzte Daten; keine aktiven Fluggebietsänderungen, kein Pi-Hardwarebeleg.

## Experimentelle M3M-Smart-Farming-Komponenten

[Konsolidierung und Freigabegrenzen](smart-farming-m3m-consolidation-review-2026-10-23.md) · [geschützter Kandidatenkatalog](smart-farming-m3m-auth-readonly-catalog.md) · [UI-Status](smart-farming-m3m-ui.md). Keine operative Vegetationskarte oder Flugfreigabe.

## Weitere Fachdokumente nach Thema

Diese Dokumente waren bisher nur über Suche oder PR-Beschreibungen erreichbar. Titel stammen aus den Dokumenten; der Status (Entwurf, offline geprüft, hardwarebeobachtet) steht jeweils im Dokument.

**Pilot 2, Medien und Galerie**

- [DJI-Medienverwaltung (Pilot 2 → Cloud): Vertragsbaustein](dji-media-upload-contract.md)
- [DJI Pilot 2: Lagebild (Situation Awareness, TSA)](dji-pilot-situation-awareness.md)
- [DJI Pilot 2 ↔ SkyHub WPML: kontrollierte Offline-Abnahme](dji-pilot2-kmz-acceptance.md)
- [DJI Pilot 2 – Mediensynchronisation RC Plus 2 / RC Pro (manueller Upload)](dji-pilot2-media-sync.md)
- [SkyHub Next – Thermalmodul (31.10.2026)](thermal.md)
- [DJI Pilot 2 – isolierte HTTPS-Medienendpunkte](dji-pilot2-media-https-api.md)
- [DJI Pilot 2 Media STS – isolierte HTTPS-Autorisierungsgrenze](dji-pilot2-media-sts-boundary.md)
- [SkyHub Next – Verifizierte DJI-Pilot-2-Medienbibliothek (Read-only)](dji-pilot2-verified-media-library.md)
- [DJI Pilot 2 – Persistente Medienregistrierung mit S3-Objektnachweis](dji-pilot2-verified-media-registration.md)
- [SkyHub Next – Mediengalerie (31.10.2026)](media-gallery.md)

**WPML, Waylines und Missionsplanung**

- [Motecshine DJI Waylines SDK als SkyHub-Next-Referenz](dji-waylines-sdk-reference.md)
- [FlightHub-inspirierte Missionsprüfung – reiner Offline-Entwurf](dji-wpml-draft-review.md)
- [DJI WPML / KMZ – SkyHub Next (21.10.2026)](dji-wpml-integration.md)
- [DJI Mavic 3M – Offline-Kamera-/Kadenzreferenzen (nicht flugfähig)](wpml-m3m-camera-reference.md)
- [Mavic 3M: unabhängiger RGB-/Multispektral-Footprint (Offline-Vergleich)](wpml-m3m-dual-optics.md)
- [WPML-Integration auf aktueller SkyHub-Next-Main-Basis](wpml-main-integration.md)
- [SkyHub Next – WPML-Karten: OSM-403-Diagnose (25.10.2026)](wpml-map-tiles-403.md)
- [WPML Survey: begrenzte Geometrie mit Aussparungen (Offline)](wpml-survey-topology.md)

**Smart Farming M3M (experimentell, offline)**

- [M3M-Captures: eindeutige Bänder, Metadatenbewertung und Manifest v2](smart-farming-m3m-capture-assessment.md)
- [SkyHub-Next Smart Farming – verifizierte experimentelle Kartenkandidaten](smart-farming-m3m-candidate-import.md)
- [SkyHub Next – DEDAL-Archivinspektion und private Manifest-Nachprüfung](smart-farming-m3m-dedal-archive-inspection.md)
- [SkyHub Next – M3M DEDAL/ODM → Indexraster: Offline-End-to-End-PoC](smart-farming-m3m-dedal-offline-pipeline.md)
- [SkyHub Next – DEDAL/ODM-Orthomosaik-Übergabe (offline)](smart-farming-m3m-dedal-ortho-handoff.md)
- [SkyHub Next – DEDAL-Kalibrierungsauftrag: Offline-Preflight](smart-farming-m3m-dedal-preflight.md)
- [M3M Smart Farming – durchgehende Offline-Integrationsabnahme](smart-farming-m3m-e2e-acceptance.md)
- [SkyHub Next: M3M experimenteller Index-Raster-Worker (PoC)](smart-farming-m3m-index-raster-poc.md)
- [SkyHub Smart Farming – M3M Medieninventar (Phase 1)](smart-farming-m3m-media-stage1.md)
- [SkyHub M3M + MinIO: Neuaufnahme und Integrationsuebergabe (21.10.2026)](smart-farming-m3m-minio-handoff-20261021.md)
- [SkyHub Next – unabhängige Rasterpaket-Abnahme (offline)](smart-farming-m3m-raster-bundle-qa.md)
- [SkyHub Next – Integritätsbeleg für M3M-Analyseraster (offline)](smart-farming-m3m-raster-integrity-seal.md)
- [SkyHub Next – M3M Raw-TIFF-Payload-Audit (offline)](smart-farming-m3m-raw-tiff-payload-audit.md)
- [M3M P1/P3: lokale TIFF-Eingangsprüfung und numerische versiegelte ROI-Analyse (offline)](smart-farming-p1-p3-offline-lab.md)
- [M3M P1/P3: private TIFF-Originalkopie und versiegelte PNG-Indexvorschau (offline)](smart-farming-private-ingest-preview.md)
- [M3M P3: begrenzte private GeoJSON-Punkt- und Polygonanalyse aus versiegelten GeoTIFFs (offline)](smart-farming-private-geospatial-query.md)
- [M3M P3: separat autorisierter, ungemounteter GIS-HTTP-Vertrag (isoliertes Labor)](smart-farming-scoped-geo-http-contract.md)
- [SkyHub-Next: M3M-Konsolidierung und Offline-Abnahme](smart-farming-m3m-release-status-2026-10-24.md)
- [Mavic 3M über bestehenden MinIO: sichere Pi-End-to-End-Leseprüfung](smart-farming-m3m-s3-hardware-smoke.md)

**Oberfläche**

- [SkyHub Next – zwei Haupttabs (isolierter UI-Branch)](tak-ui-two-tabs.md)
- [SkyHub Next · Light UI (2026-10-24)](webui-light-redesign.md)

**Weitere**

- [Flighttask-Korrelation – isolierter, nicht angebundener Auswahlhelfer](dji-flighttask-correlation-guard.md)

## Historische Momentaufnahmen – nicht als Live-Betriebszustand verwenden

- [Repository-Status 25.10.](repository-status-2026-10-25.md) und [Hygieneaudit 25.10.](repository-hygiene-2026-10-25.md) wurden auf **älteren Main-SHAs** erhoben; für den späteren `662cb94d`-Stand gilt der [aktuellere Audit](stand-2026-10-25-main-audit.md).
- [PR-Triage 24./25.10.](pr-triage-2026-10-24.md): nur noch ein Verweis auf das zusammengeführte Register.

- [Betriebsstand und Vorfälle 26./27.10.2026](stand-2026-10-27-betriebsstand.md) gelten als jüngste Messung; ältere Betriebsangaben in diesem Abschnitt bleiben unverändert stehen.
- [Entwicklungsplan 20.–21.10.2026](entwicklungsplan-2026-10-20.md)
- [Storage-Audit 20.10.2026](storage-audit-2026-10-20.md)
- Die Pi-Port-/Broker- und Hardwarediagnosen in den betroffenen Runbooks nennen ausdrücklich ihr Aufnahmedatum.
- [Archivierter Legacy-Snapshot](../stacks/README.md) dient dem Vergleich und darf **nicht** parallel zur laufenden Installation gestartet werden.

## Aktueller PR-Abhängigkeitsgraph

- [Register und Triage 25.10.2026 (nach den Schließungen) – 22 Drafts, Gruppen nach Konflikt und Inhalt, Ketten, Freigabegates und Bearbeitungsreihenfolge](pr-dependency-register-2026-10-25.md). Die Zahlen sind eine Momentaufnahme; die Live-Liste steht auf GitHub.

## Feature-PRs lesen und bewerten

Der [Projektstand](projektstand-2026-10-23.md) verlinkt die Entwicklungsketten für WPML, Command Center, MinIO und Pilot-2-Medien, Multispektral-Auswertung, YOLO11, Thermal-Geolokalisierung und HiveMind. Viele PRs nutzen **andere PR-Branches als Base**. Deshalb befinden sich die zugehörigen Dateien noch nicht im Main-Dateibaum; deren Fach-/Lizenzdokumentation kann in der GitHub-Oberfläche im jeweiligen PR-Branch eingesehen werden.

**Statuskonvention:** „Unit/CI bestanden“ ≠ „mit DJI-Gerät verifiziert“ ≠ „auf dem Raspberry Pi installiert“ ≠ „flug-/einsatzfreigegeben“. Ein PR, der bereits in den Integrationsbranch gemergt wurde, gilt weiterhin **nicht** als in Main integriert.

## Dokumentation bei Änderungen pflegen

- Nach Code-Merges: Main-SHA, Branch- und PR-Status, betroffene APIs, Sicherheitsdefaults, Tests und Pi-Risiken gegen den wirklichen Code erneut ermitteln.
- Bei neuen Features: **Ist-Implementierung**, **Feature-Flag**, **Test-Evidenz**, **Berechtigungen**, **Hardwarebefund** und **offene Gates** getrennt festhalten.
- Datierten historischen Befunden nie rückwirkend neue Betriebswerte unterschieben. Stattdessen eine neue Momentaufnahme erstellen und hier verlinken.
- Keine Kennwörter, tokens, Seriennummern, private Koordinaten, Rohbilder, HMAC-Schlüssel oder Live-Telemetrie in Repository-Dokumente aufnehmen.
