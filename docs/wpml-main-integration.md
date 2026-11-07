# WPML-Integration auf aktueller SkyHub-Next-Main-Basis

**Integrationsstand:** 24.10.2026 · [PR #89](https://github.com/mason82-dotcom/SkyHub-Next/pull/89) **nach `main` gemergt** (Commit [`1a2a01cf`](https://github.com/mason82-dotcom/SkyHub-Next/commit/1a2a01cf6331256697e27c1e8846f0746bf90f01)). **Laufzeit weiterhin offline und nicht produktiv freigegeben.**

## Herkunft, Mergegrenze und Architektur

- Geprüfter Quellstand: `feature/dji-wpml-offline-20261021` nach dem Merge von [PR #57](https://github.com/mason82-dotcom/SkyHub-Next/pull/57), Head `a3a92b7e19874f06ccabd37627d8888746afc79e`.
- Historischer Integrationsbranch: `feature/wpml-main-integration-20261023`, erstellt von `main` `aa459bf6b558c84d106c64a5bf819cb9059c071b`; dessen geprüfte Änderungen wurden über PR #89 übernommen.
- `main` und der alte WPML-Branch hatten zum Zeitpunkt der Vorprüfung divergierende Historien (304 Commits voraus, 158 Commits zurück). Der frühere WPML-Branch erbt darüber hinaus den separaten DJI-Cloud-API-Feldkatalog. **Diesen alten Branch deshalb nicht direkt nach `main` mergen.**
- Nur die 61 eigenständigen WPML-Dateien (Module, UI, Testprogramme, reine WPML-Dokumentation, Offline-KMZ-CLI, gesonderter Browser-CI-Workflow und unangewendete SQL-Migration) wurden **blobidentisch** auf eine neue Main-Basis übertragen. Der aktuelle Server `backend/server.js` und seine separate Authentifizierung, MQTT-Topologie und DJI-Pilot-2-/S3-/MinIO-Komponenten bleiben unverändert.
- Kleine nachfolgende Main-kompatible Integrationsänderungen: README, Datenschutz-Ausschlüsse in `.gitignore` sowie separater PostgreSQL-Integrationstest. Bestehende `main`-Regressionschecks werden nicht durch ältere WPML-CI-Varianten ersetzt.

## Umfang

| Oberfläche oder Modul | Funktion | Verbindliche Grenze |
|---|---|---|
| `/wpml-editor.html` | Wegpunkte, lokale Karten-/FPV-Vorschau, Offline-KMZ, begrenzter Waylines-JSON-Import | Kein Auftrag an DJI/Pilot 2 |
| `/wpml-route-library.html` | Browserlokale Routen, Action Groups, Revisionsvergleich/-restaurierung, lokale JSON-Sicherung | GPS und Missionsdaten in `localStorage` und exportierter JSON-Datei **unverschlüsselt** |
| `/wpml-survey-preview.html` | Synthetische 2D-Vermessungsgeometrie/Schätzungen | Kein flugtauglicher Mapping-Generator |
| `backend/wpml*.js` | KMZ-Parsing, begrenzte Validierung, Referenzanalyse | Semantische Offline-Teilprüfung, keine Gerätezertifizierung |
| `scripts/wpml-*.js` | Lokale CLI-Audits, synthetische Matrix, Vergleich | Keine DJI-/Netzwerk-Schreibzugriffe |
| `backend/db/migrations/003_wpml_route_library_draft.sql` | Vorschlag für Mandanten-/Revisionstabellen | **Nicht installiert; RLS aktiviert mit `FORCE`, aber ohne erlaubende Policies oder Datenzugriffsfreigaben (Default Deny)** |

**Abnahme des Codes:** Der Main-basierte Merge von PR #89 wurde als Offline-Codeintegration abgeschlossen; das ist ausdrücklich **keine Hardware-, Pilot-2- oder Produktionsabnahme**. Die anschließend auf `main` ausgeführten GitHub-Checks sind von der Freigabe für einen Pi-Rollout zu unterscheiden.

Die Offline-Validatoren vergeben keine Hardware-/Flugfreigabe. `flightReady:false`, `pilot2HardwareVerified:false` und `dispatchAllowed:false` werden nicht durch erfolgreiche synthetische Tests aufgehoben.

## Verbindliche Integrationsgates

1. CI **auf dem Main-basierten Commit** vollständig grün: Node-/DJI-Unit-Tests, isolierte PostGIS-Integration einschließlich des WPML-Routenschemas, Docker-/Compose-Sicherheitschecks und Backup/Restore.
2. Chromium-Browsertest für den Offline-Editor einschließlich gesperrter Netzwerkanfragen und des explizit bestätigten lokalen Backup-Roundtrips.
3. Prüfung, dass keine bestehenden Server-Controller, DJI-Schreibendpunkte, Routen-Dispatch-Handler, Credential-Konfigurationen oder Compose-Ports geändert worden sind.
4. Bei abweichender Main-Architektur nur additive Anpassungen übernehmen; keine älteren `server.js`, `ci.yml` oder `.env` aus dem Quellbranch überschreiben.
5. Vor produktivem Einsatz: separate Sicherheitsabnahme für persistente Routen, Benutzerrollen/ACL/RLS, verschlüsselte Backups, reale Pilot-2-KMZ-Importtests und gerätespezifische Aktions-/Höhen-/RTH-Prüfungen. **Kein Merge allein aufgrund strukturell gültiger KMZ als Flugfreigabe interpretieren.**

## Testbefehle (ausschließlich lokaler Code, keine Drohne)

```bash
node --test backend/test/wpml*.test.js
node scripts/wpml-reference-matrix.js
node scripts/wpml-plan.js docs/examples/wpml-waypoint-plan.json /tmp/wpml-offline-review.kmz
node scripts/wpml-inspect.js /tmp/wpml-offline-review.kmz
```

Für den SQL-Integrationstest darf ausschließlich die dedizierte, temporäre `skyhub_test`-PostGIS-Datenbank verwendet werden; dies prüft die eigene CI. Den Migrationsentwurf weder auf dem Pi noch in einer produktiven DB ausführen.

## Repository- und Legacy-Namen

Kanonisch: https://github.com/mason82-dotcom/SkyHub-Next.
`~/Projekte/SkyHub` bleibt der **separate Legacy-Pfad**; seine Daten und Dienste wurden durch diesen Merge nicht verändert. Auch die neue Pi-Brokeroption Mosquitto/1883 wird nicht allein durch einen Git-Merge aktiviert.
