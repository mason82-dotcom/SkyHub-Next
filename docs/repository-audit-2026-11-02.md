# Repository-Audit und sichere Bereinigung – 02.11.2026

> **Nur GitHub-/Quellcode-Audit, kein Pi-Deployment und keine Flugfreigabe.** Die Angaben beschreiben einen festen Snapshot; neuere GitHub-Aktionen können die Zahlen ändern.

## Geprüfte Grundlage

- Repository: `mason82-dotcom/SkyHub-Next` (`main`), Commit [`a4025955fc965d3712e4a49e617562ff4268ef51`](https://github.com/mason82-dotcom/SkyHub-Next/commit/a4025955fc965d3712e4a49e617562ff4268ef51).
- Git-Baum: 636 Einträge inklusive Verzeichnisse; **590 versionierte Dateien**, zusammen rund 4,76 MB an Blob-Inhalten (keine Aussage über Git-Historie oder Docker-Images).
- Schwerpunktverteilung nach versionierten Dateien: `backend/` 275, `docs/` 101, `scripts/` 62, `frontend/` 40, `stacks/` 32, `tests/` 29, `pi-minio-acceptance/` 12. Weitere Dateien liegen im Repository-Root und anderen Verzeichnissen.
- Per Dateinamen-/Verzeichnisheuristik rund 182 Testdateien; dies ist **keine** Zahl erfolgreich gelaufener Tests.
- **232 GitHub-Branches**, aus drei vollständig gelesenen Branch-API-Seiten (100 + 100 + 32); **24 offene Pull Requests**, davon **6 direkt auf `main` und 18 gestapelt**; **ein offenes Issue (#177)**. Branch-Existenz bedeutet weder ungemergte Arbeit noch gefahrloses Löschen.
- GitHub Actions auf dem geprüften `main`-Commit: [SkyHub Next checks erfolgreich](https://github.com/mason82-dotcom/SkyHub-Next/actions/runs/41359067831); [TAK UI browser acceptance erfolgreich](https://github.com/mason82-dotcom/SkyHub-Next/actions/runs/41359067852). Das bestätigt **nicht** den aktuellen Hardware- oder Pi-Betrieb.

## Relevante Architektur und Betriebsgrenzen

| Bereich | Status auf `main` und Hygiene-Grenze |
| --- | --- |
| Node.js/Express, MQTT, Redis, PostgreSQL/PostGIS | Aktives Root-Backend; Änderungen an Protokoll, Datenbank und Compose benötigen separate Integrationstests |
| DJI RC Pro/M3M, RC Plus 2/M4T | Read-only Telemetrie-/Hardwareprüfungen sind kein Nachweis einer vollständigen Geräte- oder Missionsabnahme |
| Pilot-2-Medien und MinIO | Opt-in und laufzeitabhängig; Backups, IAM und tatsächliche Containeridentität müssen vor Änderungen auf dem Pi geprüft werden |
| M3M Smart Farming / Raster / GIS | Zahlreiche experimentelle Labor-Drafts; keine automatische wissenschaftliche Kalibrierungsfreigabe oder produktiver GIS-Dienst |
| WPML / Waylines | Offline-Entwürfe und getrennte Rollen-/Autorisierungsgrenzen; keine automatische Missionsausführung |
| `stacks/legacy-skyhub/` | Historischer Referenz-/Rückrollbestand; `scripts/pi-emqx-harden.js` nutzt `running-emqx/acl.conf` – **nicht pauschal löschen** |

## Priorisierte PR-Triage (GitHub-Stand 02.11.2026)

| Priorität | PRs | Befund und zulässige Folgemaßnahme |
| --- | --- | --- |
| P0 – blockieren | [#222](https://github.com/mason82-dotcom/SkyHub-Next/pull/222) | CI erfolgreich und gegen `main` mergebar, **aber** der Diff stellt in `pi-minio-acceptance` frühere Containeridentitäten (`skyhub-next-minio-1`) und einen alten Backup-/Restore-Runbookstand vom 22.10. wieder her, während `main` den geprüften `skyhub-shared-minio`-Stand vom 25./26.10. dokumentiert. Zusätzlich entfallen Teile der neueren Negativtests. **Nicht unverändert mergen**; nur gezielt gewünschte Funktionen auf aktuellem `main` neu übernehmen. |
| P0 – nicht mergen | [#223](https://github.com/mason82-dotcom/SkyHub-Next/pull/223), [#224](https://github.com/mason82-dotcom/SkyHub-Next/pull/224) | Beide nicht mergebar; jeweils 83 geänderte Dateien und rund 70 Commits. Ihre Head-SHAs entsprechen den bereits gestapelten Experimentaldrafts [#145](https://github.com/mason82-dotcom/SkyHub-Next/pull/145) und [#144](https://github.com/mason82-dotcom/SkyHub-Next/pull/144). Kein sauber isolierter Rebase auf `main`; bisherige CI-Läufe der entsprechenden Heads schlugen fehl. |
| P1 – Abhängigkeiten prüfen | [#113](https://github.com/mason82-dotcom/SkyHub-Next/pull/113) bis [#145](https://github.com/mason82-dotcom/SkyHub-Next/pull/145) (M3M-P1/P3-Kette) | Viele voneinander abhängige Drafts mit Fachbasis statt `main`. Nicht pauschal squashen oder umbasieren; unabhängige Offline-Tests, Datenprovenienz, vier Bandzuordnungen und Kalibrierungsgrenzen erhalten. |
| P1 – isoliert prüfen | [#29](https://github.com/mason82-dotcom/SkyHub-Next/pull/29), [#30](https://github.com/mason82-dotcom/SkyHub-Next/pull/30), [#99](https://github.com/mason82-dotcom/SkyHub-Next/pull/99), [#129](https://github.com/mason82-dotcom/SkyHub-Next/pull/129) | WPML-Integrationsstände überlappen teils mit inzwischen auf `main` vorhandenen Offline-Funktionen; Migration, Autorisierung und Mission-Dispatch strikt getrennt halten. |
| P2 – einzeln prüfen | [#41](https://github.com/mason82-dotcom/SkyHub-Next/pull/41), [#42](https://github.com/mason82-dotcom/SkyHub-Next/pull/42), [#46](https://github.com/mason82-dotcom/SkyHub-Next/pull/46), [#80](https://github.com/mason82-dotcom/SkyHub-Next/pull/80), [#81](https://github.com/mason82-dotcom/SkyHub-Next/pull/81), [#44](https://github.com/mason82-dotcom/SkyHub-Next/pull/44) | Medien-, Simulator-/Lizenz-, DJI-Recovery-, PV-Test- und Referenz-Drafts. Vor Freigabe finalen Diff/CI, Relevanz gegenüber `main` und ggf. neue isolierte Basis prüfen. |

## SQL-Migrationen: absichtlich beibehalten

Die Dateien `003_dji_pilot_media_verified.sql` und `003_wpml_route_library_draft.sql` tragen dieselbe Nummer, aber **verschiedene Fachfamilien**. Das bestehende [`migration-inventory.json`](../backend/db/migration-inventory.json) führt eindeutige IDs, verbietet Auto-Apply und markiert WPML als `blocked_draft`. Der CI-gebundene [`audit_sql_migrations.py`](../scripts/audit_sql_migrations.py) prüft diese Schranken. **Keine Umbenennung, kein numerischer generischer SQL-Runner und kein produktiver Datenbankeingriff** im Rahmen dieses Cleanups. [Issue #177](https://github.com/mason82-dotcom/SkyHub-Next/issues/177) bleibt als Rollout-Gate offen.

## Umsetzung dieses Hygiene-Branches

- Neue, datierte Bestandsaufnahme statt Überschreiben historischer Betriebsbelege.
- Verlinkung aus `README.md` und `docs/index.md`, ohne historische PR-Zahlen rückwirkend umzudeuten.
- Vorhandene, bereits CI-gebundene Markdown-Link-/Navigationsprüfungen weiterverwenden; die Aufnahme dieses Auditberichts in beide Einstiegspunkte wird als Regression abgesichert.
- **Keine** Löschung von Dateien/Branches/PRs, keine Änderung von `backend`, Docker/Compose, `.env`, Secrets, Datenbank, MQTT, MinIO, Caddy oder DJI-Schnittstellen.

## Sichere Reihenfolge weiterer Aufräumarbeiten

1. Bei jedem offenen PR Kopf-SHA, tatsächliche Basis, Diff zu `main`, CI auf genau diesem Kopfstand und separat wirksame Abhängigkeiten prüfen.
2. P0 zuerst: PR #222 gegen den aktuell validierten MinIO-Runbookstand neu extrahieren; #223/#224 nicht auf Basis ihrer 83-Dateien-Diffs übernehmen.
3. Gestapelte M3M-Labors ausschließlich auf einer separat getesteten Integrationsbasis konsolidieren; anschließend nur einzeln belegte, unabhängige Bestandteile nach `main`.
4. Branches erst löschen, **wenn** die Zuordnung zu PRs, offenen Experimenten und laufenden Deployments nachvollziehbar abgeschlossen ist.
5. Raspberry-Pi-Update erst nach lokalem Snapshot, Overlay-/Image-/Volume-Prüfung und Backup-/Restore-Abnahme; CI allein ist keine Betriebsfreigabe.

### Reproduzierbare, nur lesende Prüfungen

```bash
python3 scripts/repository-hygiene.py
python3 scripts/audit_sql_migrations.py
python3 -m unittest discover -s tests -p 'test_documentation_links.py' -v
python3 -m unittest discover -s tests -p 'test_*.py'
```

Diese Befehle ändern weder Remote-Branches noch die laufenden Geräte/Dienste. Bei den Python-Tests werden ggf. temporäre lokale Testdateien angelegt.
