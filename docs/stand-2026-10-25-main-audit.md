# SkyHub Next – aktueller Main-Audit (25.10.2026)

> **GitHub-Momentaufnahme, keine Pi- oder DJI-Hardwareabnahme.** Geprüft wurde `main` bei [`662cb94d9fd88d08a8bab11c6d1b34c41fd88b1a`](https://github.com/mason82-dotcom/SkyHub-Next/commit/662cb94d9fd88d08a8bab11c6d1b34c41fd88b1a), Commit vom 25.10.2026 14:42 UTC. Für Änderungen und Freigaben müssen Branch, CI, Compose-Konfiguration und reale Hardware **neu** überprüft werden.

## Repository und Reviewumfang

- GitHub: [`mason82-dotcom/SkyHub-Next`](https://github.com/mason82-dotcom/SkyHub-Next), Standardbranch `main`, Version im `backend/package.json`: `0.1.0` (Entwicklung).
- Vollständiger Git-Baum dieser SHA: **549 Einträge**, darunter **507 Dateien**; `backend/` 250 Dateien, `docs/` 87 Dateien. Geprüft wurden die Git-Baumstruktur, alle 89 Markdown-Dateien außerhalb des archivierten Legacy-Verzeichnisses auf relative Dateiverweise, die Einstiegstexte sowie zentrale Backend-/Compose-Dateien. Das ist **keine byteweise Code-Review aller 507 Dateien**.
- Zum Abfragezeitpunkt **36 offene Pull Requests**, davon **36 Drafts**: **5** direkt gegen `main`, **31** gegen andere Feature-/Integrationsbranches. [Live-PR-Liste](https://github.com/mason82-dotcom/SkyHub-Next/pulls) hat Vorrang vor diesen Stichtagszahlen.
- Ältere Listen in [Repository-Status](repository-status-2026-10-25.md), [Hygiene](repository-hygiene-2026-10-25.md), [PR-Triage](pr-triage-2026-10-24.md) und [Projektstand](projektstand-2026-10-23.md) sind **historische Messungen anderer SHAs**, keine widerspruchsfrei zusammenführbare aktuelle Inventur.

## Architektur- und Funktionsmatrix (auf Main vorhanden)

| Bereich | Im Quellcode / Hauptbranch | Aktivierung und Grenzen |
| --- | --- | --- |
| DJI-Telemetrie | MQTT-Subscriber, 1.18-Feldkatalog, Geräte-Registry, OSD-/Position-/Zeitintegrität, HMS, Topologie, Socket.IO und statisches Dashboard | Broker-ACL, Pilot-2-Konfiguration und reale OSD-Frische müssen separat nachgewiesen werden. Keine allgemeine Flugbetriebsfreigabe. |
| Datenhaltung | Redis-Topologie/Cache, PostGIS-/Track-Komponenten, begrenzte HTTP-Reads | `SKYHUB_TRACK_RECORDING_ENABLED=false` im Standard-Compose. Kein Nachweis aktuell laufender Migrationen. |
| Pilot 2 / Kopplung | HTTPS-gebundene Pilot-/Pairing-Routen sowie Administrator-Freigabe und Widerruf | `SKYHUB_PILOT_ENABLED=false` standardmäßig. Pairing- und Admin-Routen können Zustände ändern, auch wenn der DJI-Flugsteuerungspfad passiv bleibt. |
| Topologie-Antwort | Separate MQTT-`status_reply`-Bestätigung für geprüfte `update_topo`-Nachrichten | `SKYHUB_TOPOLOGY_ACK_ENABLED=false`; benötigt eigenständige Publisher-ACL. Kein Missionskommando. |
| Medien / S3 | `backend/media-api.js`, `backend/s3-storage.js`: `GET /api/media/{status,buckets,objects,m3m/inventory}` | Im Server nur bei `SKYHUB_MEDIA_ENABLED=true` gemountet; Standard-Compose **false**, S3-Credentials standardmäßig leer. Keine Freigabe für Upload, Objektmutation oder radiometrische Auswertung. |
| MinIO-Disaster-Recovery | Geschützter GET-Router unter `/api/dr/minio` mit Status-/Reportansicht | Root-Compose: `SKYHUB_MINIO_DR_ENABLED=true`, Composite-Status `false`; ohne Reports „unavailable“. Reine Statusabfrage, kein Restore. |
| M3M Smart Farming | Begrenzte Offline-/Rasterskripte, eigenständige statische Ansicht und optionaler metadata-only Kandidatenkatalog | `SKYHUB_M3M_CATALOG_ENABLED` wird vom Server geprüft, aber vom **Standard-Root-Compose nicht als Backend-Variable weitergereicht**. Keine bestätigte radiometrische Kalibrierung, operativen NDVI-/NDRE-Karten oder freigegebenen Agrar-Aktionen. |
| WPML | Offline-KMZ-/WPML-Parsing, browserlokaler Editor, Routenbibliothek, Survey-Vorschau und Tests | Keine freigegebene Flugauftragsübermittlung; zentrale SQL-/Transaktionsentwürfe nicht ohne separates Migrations-/Autorisierungsreview verwenden. |
| Weitere DJI-Module | Isolierte Beobachtungs-/CAS-Journal-, Multimissions- und Flight-Area-Labormodule | Nur weil Dateien in `main` liegen, sind sie **nicht** in die aktive Serverlaufzeit eingebunden. |
| Erweiterungen | Thermal, YOLO, HiveMind, private P3-GIS-Kette, Pilot-2-Medien-STS und experimentelle UI teils als Draft-PRs | Keine automatische Main-, Pi- oder Gerätefreigabe. Stack-Abhängigkeiten vor jedem einzelnen Merge prüfen. |

Die zuletzt gemergte Main-Änderung bei diesem Prüfstand betrifft isolierte Pilot-Medien-HTTP-Callbacks ([#174](https://github.com/mason82-dotcom/SkyHub-Next/pull/174)). Ein neuer Quellcodepfad ist nicht automatisch ein gemounteter, produktiver Endpunkt. Die tatsächlich montierten HTTP-Routen stehen in [`backend/server.js`](../backend/server.js) und [`backend/pilot-routes.js`](../backend/pilot-routes.js).

## Betriebskonfiguration: Quelle vor historischen Runbooks

- Root-Compose `docker-compose.yml`: Projekt `skyhub-next`, Backend `127.0.0.1:4001` → Container `4000`; PostGIS, Redis; MinIO nur im Profil `media`. Der Root-Stack startet selbst **keinen MQTT-Broker**.
- `backend/mqtt-config.js` erlaubt nur abgestimmte Kombinationen: `emqx/1884` (Compose-Default), `mosquitto/1883` und `mosquitto-dedicated/1884`. `MQTT_BROKER_URL`, `SKYHUB_MQTT_BROKER_KIND` und `SKYHUB_MQTT_REQUIRED_PORT` müssen zueinander passen.
- Der separate gemeinsame MinIO-Pfad (`docker-compose.minio-shared.yml` mit Projekt `skyhub-storage`) und die Storage-Overrides sind **nicht** austauschbar mit dem Root-`media`-Profil. Vor Anwendung Bind-Mount, Dateisystem, ACL/IAM, laufende Container und Sicherung prüfen.
- `SKYHUB_DJI_MAP_ELEMENTS_ENABLED` wird im Root-Compose an den Backend-Prozess übergeben und bleibt standardmäßig `false`; seine Aktivierung erfordert weitere Pilot- und HTTPS-Prüfungen.
- GitHub-Zustand und Pi-Container sind **getrennte Tatsachen**. Hier wurden weder Pi-Ports noch Live-Konfigurationen, MQTT-Nachrichten, MinIO-Objekte oder DJI-Hardware neu gemessen.

## Offene Draft-PRs: Integration sicher planen

Die fünf direkten Main-Drafts waren bei der Abfrage [#25](https://github.com/mason82-dotcom/SkyHub-Next/pull/25), [#46](https://github.com/mason82-dotcom/SkyHub-Next/pull/46), [#81](https://github.com/mason82-dotcom/SkyHub-Next/pull/81), [#99](https://github.com/mason82-dotcom/SkyHub-Next/pull/99) und [#127](https://github.com/mason82-dotcom/SkyHub-Next/pull/127). Die übrigen **31** sind gestapelt, darunter mehrere mehrstufige Smart-Farming-, Thermal- und Medienketten. Ein Merge in einen Feature- oder Integrationsbranch ist **kein Merge nach `main`**.

Vor einer Integration: den individuellen PR-Diff gegen seinen tatsächlichen Base-Branch prüfen; anschließend beim Retarget auf aktuellen `main` die gesamte mitgezogene Historie, Konflikte, Security-Gates, Workflow-Ergebnisse auf **dem finalen Head-SHA** und die migrations-/betrieblichen Folgen erneut bewerten. Diese Dokumentationsrevision ist **keine Mergeempfehlung** für Draft-PRs.

## Bestätigungsstufen

1. **Quelltext auf `main`**: Pfad/Flag/Route sind im genannten Commit nachvollziehbar.
2. **Automatisierte Tests**: Nur mit erfolgreichem, zu genau diesem Head-SHA gehörigem CI-Lauf belegt; hier kein neuer CI-Status attestiert.
3. **Pi-Deployment**: Erfordert lokal überprüfte Container-Image-IDs, Compose-Dateien, Ports und Berechtigungen.
4. **Geräte-/Mediendaten-Abnahme**: Erfordert neue, datierte, read-only Hardware- und Originaldaten-Nachweise.
5. **Betriebliche Freigabe**: Explizit separat; weder aus CI noch aus Pairing/OSD oder einem Raster-Labortest ableitbar.

## Nächste Dokumentations- und Code-Audits

Die auf `main` vorhandenen Alttexte wurden nicht gelöscht: historische Hardwaremessungen und PR-Entscheidungen müssen auditierbar bleiben. Bei Arbeit an Medien/STS, WPML-Migrationen, DJI-Kartengruppen und Broker-Umstellung zuerst [Konfiguration](config-reference.md), [API](api-reference.md), [Betrieb](ops.md), [Sicherheit](security.md) sowie die fachlichen Spezialberichte gegen **den dann aktuellen Commit** abgleichen. Pflegevorgaben: [Dokumentationsregeln](dokumentationspflege.md).
