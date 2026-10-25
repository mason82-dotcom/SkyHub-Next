# SkyHub Next – Dokumentationswegweiser

**Repository:** https://github.com/mason82-dotcom/SkyHub-Next. Historische GitHub-Links wurden auf den neuen Slug normalisiert; die lokalen Pi-Verzeichnisse `SkyHub` (Legacy) und `SkyHub-Next` (Entwicklung) bleiben unterschiedlich.

**Aktualisiert am 24.10.2026.** Diese Navigation gilt für den Root-Stack `skyhub-next`. Die wichtigste Unterscheidung ist die zwischen dem **Code auf `main`** und **noch nicht integrierten Entwicklungszweigen**.

## Zuerst lesen

1. [README / Produktumfang und sichere lokale Checks](../README.md)
2. [Projektstand 23.10.2026 / verifizierter Main-SHA, PR-Status und Integrationsgates](projektstand-2026-10-23.md)
   - [Priorisierte Integrationsstrategie: PR-Abhängigkeiten, Merge-Gates und neue Research-Zweige](integration-priorities-2026-10-23.md) – **maßgeblich für aktuelle Fortschrittsaussagen**
3. [Architektur, Datenwege und API](architecture.md)
4. [Sicherheitsmodell, Authentifizierung und LAN/TLS](security.md)
5. [Betrieb, Checks und kontrolliertes Backend-Update](ops.md)
6. [Konfigurationsreferenz: Compose, Env und Feature-Flags](config-reference.md)
7. [API-Referenz: HTTP, Socket.IO, MQTT, Autorisierung](api-reference.md)

## Technische Referenz des Hauptbranches

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
| Betriebssicherheit und Migration | [Skriptwirkung](scripts.md), [Legacy-Migration](legacy-migration.md), [Legacy-Dependency-Audit](legacy-dependency-audit.md), [Takeover/Rollback](skyhub-legacy-takeover.md) |
| Frontend-Kontrakte | [UX-CONTRACT](../UX-CONTRACT.md), [DESIGN](../DESIGN.md) |
| FlightHub 2 Frontend – optionale Herstellerkomponenten, nur Referenz | [FH2-On-Premises-Komponenten und Sicherheitsgates](dji-flighthub2-frontend-components.md) |

## Passiver DJI Flight-Area-Laborstand

[Event-Inspector](dji-flight-area-integration.md) · [Offline-Zielrevisionsmonitor](dji-flight-area-sync-monitor.md). Ausschließlich gelesene, begrenzte Daten; keine aktiven Fluggebietsänderungen, kein Pi-Hardwarebeleg.

## Experimentelle M3M-Smart-Farming-Komponenten

[Konsolidierung und Freigabegrenzen](smart-farming-m3m-consolidation-review-2026-10-23.md) · [geschützter Kandidatenkatalog](smart-farming-m3m-auth-readonly-catalog.md) · [UI-Status](smart-farming-m3m-ui.md). Keine operative Vegetationskarte oder Flugfreigabe.

## Historische Momentaufnahmen – nicht als Live-Betriebszustand verwenden

- [Entwicklungsplan 20.–21.10.2026](entwicklungsplan-2026-10-20.md)
- [Storage-Audit 20.10.2026](storage-audit-2026-10-20.md)
- Die Pi-Port-/Broker- und Hardwarediagnosen in den betroffenen Runbooks nennen ausdrücklich ihr Aufnahmedatum.
- [Archivierter Legacy-Snapshot](../stacks/README.md) dient dem Vergleich und darf **nicht** parallel zur laufenden Installation gestartet werden.

## Feature-PRs lesen und bewerten

Der [Projektstand](projektstand-2026-10-23.md) verlinkt die Entwicklungsketten für WPML, Command Center, MinIO und Pilot-2-Medien, Multispektral-Auswertung, YOLO11, Thermal-Geolokalisierung und HiveMind. Viele PRs nutzen **andere PR-Branches als Base**. Deshalb befinden sich die zugehörigen Dateien noch nicht im Main-Dateibaum; deren Fach-/Lizenzdokumentation kann in der GitHub-Oberfläche im jeweiligen PR-Branch eingesehen werden.

**Statuskonvention:** „Unit/CI bestanden“ ≠ „mit DJI-Gerät verifiziert“ ≠ „auf dem Raspberry Pi installiert“ ≠ „flug-/einsatzfreigegeben“. Ein PR, der bereits in den Integrationsbranch gemergt wurde, gilt weiterhin **nicht** als in Main integriert.

## Dokumentation bei Änderungen pflegen

- Nach Code-Merges: Main-SHA, Branch- und PR-Status, betroffene APIs, Sicherheitsdefaults, Tests und Pi-Risiken gegen den wirklichen Code erneut ermitteln.
- Bei neuen Features: **Ist-Implementierung**, **Feature-Flag**, **Test-Evidenz**, **Berechtigungen**, **Hardwarebefund** und **offene Gates** getrennt festhalten.
- Datierten historischen Befunden nie rückwirkend neue Betriebswerte unterschieben. Stattdessen eine neue Momentaufnahme erstellen und hier verlinken.
- Keine Kennwörter, tokens, Seriennummern, private Koordinaten, Rohbilder, HMAC-Schlüssel oder Live-Telemetrie in Repository-Dokumente aufnehmen.
