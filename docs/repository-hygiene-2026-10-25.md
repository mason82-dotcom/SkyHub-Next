# Repository-Hygiene und PR-Bestand – 25.10.2026

> **Leseaudit, kein Deployment und keine Merge-Freigabe.** Momentaufnahme der GitHub-REST-Daten am 25.10.2026. Historische Statusdokumente bleiben als Nachweise erhalten; deren damalige PR-Zahlen und Main-SHAs dürfen nicht als heutiger Zustand gelesen werden.

## Verifizierte Basis

- Repository: https://github.com/mason82-dotcom/SkyHub-Next, Standardbranch `main`.
- Main-Commit zur Messung: [`55815f348c2b7941c7f53dffea8d7bc568f89b81`](https://github.com/mason82-dotcom/SkyHub-Next/commit/55815f348c2b7941c7f53dffea8d7bc568f89b81).
- Letzter Main-Merge: [#23](https://github.com/mason82-dotcom/SkyHub-Next/pull/23), rein lesendes Offline-Inventar der fünf Mavic-3M-Medienbänder.
- Zu dieser SHA waren [SkyHub Next checks](https://github.com/mason82-dotcom/SkyHub-Next/actions/runs/40148408806) und [TAK UI browser acceptance](https://github.com/mason82-dotcom/SkyHub-Next/actions/runs/40148408757) erfolgreich.
- Der Git-Baum enthielt 473 Einträge einschließlich Verzeichnissen, vier Workflows und einen explizit archivierten Legacy-Stack unter `stacks/legacy-skyhub/`.
- **52 offene Pull Requests:** 16 direkt auf `main`, 36 gestapelt auf anderen Branches. Die [PR-Triage vom 24.10.](pr-triage-2026-10-24.md) zeigt einen anderen, historisch gemessenen Stand mit 57 PRs und ist nicht mehr aktuell.

## Aufräumgrenzen

1. **Nicht löschen:** Archivierte Legacy-Konfigurationen sind Rückroll-/Referenzmaterial, und `scripts/pi-emqx-harden.js` referenziert explizit die historische ACL. Die Tests in `tests/test_repository_boundaries.py` schützen diese Grenze.
2. **Nicht blind mergen:** 36 offene PRs haben Feature-Branches als Basis. Der Vergleich einzelner PRs mit `main` enthält dadurch Vorgänger und kann beim Merge alte Konfigurationen zurückbringen.
3. **Nicht vermischen:** Die konkurrierenden UI-Richtungen [#120](https://github.com/mason82-dotcom/SkyHub-Next/pull/120) (hell) und [#127](https://github.com/mason82-dotcom/SkyHub-Next/pull/127) (HyperFrames) brauchen eine Auswahl. Die M3M-Konsolidierungen [#88](https://github.com/mason82-dotcom/SkyHub-Next/pull/88) und [#94](https://github.com/mason82-dotcom/SkyHub-Next/pull/94) sind keine unabhängigen Features.
4. **Nicht automatisch deployen:** Keine Änderung dieses Hygiene-PR betrifft Compose-Laufzeit, MQTT/EMQX/Mosquitto, MinIO, Redis, PostgreSQL, Caddy, Gerätekopplungen oder DJI-Flugaktionen.

## PR-Gruppen für die nächste kontrollierte Triage

| Linie | Offene PRs (Auswahl) | Maßnahme vor Integration |
| --- | --- | --- |
| Smart Farming Raster/GIS P1–P3.5 | #113, #114, #115, #116, #117, #122, #125, #128, #131, #144, #145 | Gestapelte Abhängigkeiten ermitteln; gegen vorhandene Main-Katalog-/Sicherheitsänderungen neu aufbauen; Hardware-/Kalibrierfreigaben separat |
| Pilot 2 Medien/MinIO | #33, #34, #36–#42 | Gegen die bereits gemergte Medien-API abgleichen; Credentials und IAM nur in isolierten Tests |
| Vision/Thermal | #43, #45, #49, #50, #52, #54, #56, #62 | Kette nicht in einem Commit nach `main` übernehmen; Datenschutz-, Lizenz- und Kalibriergrenzen prüfen |
| Flight-Area | #70, #75, #110 | Ausschließlich offline/passiv lassen; keine Befehlsfreigabe ableiten |
| WPML / Missionen | #99, #109, #129 | Aktuellen Wayline-Editor und nicht montierte Routen-API gegenprüfen |
| Simulator | #46 | AGPL- und isolierte Netzwerk-/Broker-Grenzen beachten |
| Historische Integrationsbasen | #1, #18, #19, #22, #27, #29, #30 | Auf bereits gemergte Teilmengen prüfen; erst nach belastbarem Diff als ersetzt markieren oder schließen |

Die PR-Nummern sind Navigationshilfen, **keine** Aussage, dass ein PR mergefähig oder überflüssig ist. Vor jedem Merge den aktuellen Head, Diff, Checks und die Abhängigkeiten neu lesen. Keine offene PR und kein Branch wird von diesem Hygiene-PR geschlossen oder gelöscht.

## Dauerhafter Präventionsschritt

- `scripts/repository-hygiene.py` prüft den Git-Index **nur lesend** auf versehentlich eingecheckte lokale Umgebungsdateien, Schlüsseldateien, Caches, Backup-Artefakte und Groß-/Kleinschreibungskollisionen.
- `tests/test_repository_hygiene.py` testet die Positiv-/Negativfälle; der Check wird in der Standard-CI ausgeführt.
- `.gitignore` schließt zusätzliche lokale Entwicklungs-Caches, Editor-Dateien und temporäre Artefakte aus.
- Diese Heuristik prüft **keine Inhalte** und ersetzt keine Secret-/SAST-Prüfung. Bereits vorhandene sensible Daten können eine gesonderte, kontrollierte Historienbereinigung erfordern.

## Referenzen

Der technische Projektumfang steht in [README](../README.md), die [Stichtags-Triage 24.10.](pr-triage-2026-10-24.md) dient nur als Vergleich und die [Betriebsgrenzen](ops.md) bleiben maßgeblich. GitHub-Merges ersetzen keinen Pi-Preflight oder DJI-Hardwaretest.
