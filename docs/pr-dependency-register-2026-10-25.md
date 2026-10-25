# Offene PRs – Register und Triage (Stand 25.10.2026, abends)

> **Momentaufnahme, kein Merge-Beschluss.** Gemessen am 25.10.2026 gegen `main` @ [`c5f9305`](https://github.com/mason82-dotcom/SkyHub-Next/commit/c5f9305d53d37647972bf0123a9ad8d4753c9a92) mit der GitHub-API und `git merge-tree` (reines Lesen). **Inhalt, Sicherheit und Hardware-Eignung der PRs sind hier nicht beurteilt**, die Einordnung beruht auf Dateivergleichen und Stichproben. Dieses Dokument ersetzt die beiden früheren Stichtagsberichte (Abhängigkeitsregister vom Vormittag und `pr-triage-2026-10-24.md`); die Zahlen älterer Fassungen sind überholt. Die Live-Liste steht ausschließlich auf [GitHub](https://github.com/mason82-dotcom/SkyHub-Next/pulls), `main` ändert sich laufend: vor jedem Merge neu messen.

## Bestandszahlen

| Kriterium | Anzahl |
| --- | ---: |
| Offene Pull Requests | 34 |
| Davon Draft | 34 |
| Basis direkt `main` | 4 ([#46](https://github.com/mason82-dotcom/SkyHub-Next/pull/46), [#81](https://github.com/mason82-dotcom/SkyHub-Next/pull/81), [#99](https://github.com/mason82-dotcom/SkyHub-Next/pull/99), [#127](https://github.com/mason82-dotcom/SkyHub-Next/pull/127)) |
| Basis ein anderer Branch | 30 |
| – Basis ist der Head eines weiteren **offenen** PR | 21 |
| – Basis ist **kein** offener PR-Head (Branch kann existieren; teils Head eines geschlossenen oder gemergten PR) | 9 |

Konflikte gegenüber `main`: **2 konfliktfrei auf `main`-Basis** ([#46](https://github.com/mason82-dotcom/SkyHub-Next/pull/46), [#81](https://github.com/mason82-dotcom/SkyHub-Next/pull/81)), **4 gestapelt und konfliktfrei** ([#41](https://github.com/mason82-dotcom/SkyHub-Next/pull/41), [#42](https://github.com/mason82-dotcom/SkyHub-Next/pull/42), [#80](https://github.com/mason82-dotcom/SkyHub-Next/pull/80), [#129](https://github.com/mason82-dotcom/SkyHub-Next/pull/129)), **1 mit nur `ci.yml`-Konflikt** ([#99](https://github.com/mason82-dotcom/SkyHub-Next/pull/99)), **27 mit Mehrdatei-Konflikten**. Die 9 nicht zugeordneten Basen sind nicht als gelöscht verifiziert; jeder Vergleich muss die Base-SHA neu prüfen.

## Was sich am 25.10. geändert hat

- **Gemergt:** [#19](https://github.com/mason82-dotcom/SkyHub-Next/pull/19) (gemeinsamer MinIO), [#161](https://github.com/mason82-dotcom/SkyHub-Next/pull/161), [#21](https://github.com/mason82-dotcom/SkyHub-Next/pull/21), [#23](https://github.com/mason82-dotcom/SkyHub-Next/pull/23), [#25](https://github.com/mason82-dotcom/SkyHub-Next/pull/25), [#109](https://github.com/mason82-dotcom/SkyHub-Next/pull/109), [#112](https://github.com/mason82-dotcom/SkyHub-Next/pull/112), [#120](https://github.com/mason82-dotcom/SkyHub-Next/pull/120), [#135](https://github.com/mason82-dotcom/SkyHub-Next/pull/135), [#136](https://github.com/mason82-dotcom/SkyHub-Next/pull/136), [#140](https://github.com/mason82-dotcom/SkyHub-Next/pull/140), [#148](https://github.com/mason82-dotcom/SkyHub-Next/pull/148), [#157](https://github.com/mason82-dotcom/SkyHub-Next/pull/157), [#160](https://github.com/mason82-dotcom/SkyHub-Next/pull/160), [#162](https://github.com/mason82-dotcom/SkyHub-Next/pull/162), [#163](https://github.com/mason82-dotcom/SkyHub-Next/pull/163), [#164](https://github.com/mason82-dotcom/SkyHub-Next/pull/164), [#165](https://github.com/mason82-dotcom/SkyHub-Next/pull/165), [#166](https://github.com/mason82-dotcom/SkyHub-Next/pull/166), [#167](https://github.com/mason82-dotcom/SkyHub-Next/pull/167), [#168](https://github.com/mason82-dotcom/SkyHub-Next/pull/168), [#176](https://github.com/mason82-dotcom/SkyHub-Next/pull/176), [#184](https://github.com/mason82-dotcom/SkyHub-Next/pull/184) und die Fixes #123, #124, #138, #147, #149 bis #156. Die Medien-Kette der Gegenseite ist mit #171 bis #182 in `main` (isolierte HTTPS-Grenze für temporäre Medien-Credentials, HEAD-verifizierte Registrierung, HTTP-Callbacks, Medienbibliothek und deren Laufzeit-Gate, Doku zur Pi-Aktivierung), dazu #178 (SQL-Migrationsinventar).
- **Geschlossen, weil von `main` überholt:** [#18](https://github.com/mason82-dotcom/SkyHub-Next/pull/18), [#22](https://github.com/mason82-dotcom/SkyHub-Next/pull/22), [#27](https://github.com/mason82-dotcom/SkyHub-Next/pull/27), [#70](https://github.com/mason82-dotcom/SkyHub-Next/pull/70), [#75](https://github.com/mason82-dotcom/SkyHub-Next/pull/75) (alle Dateien auf `main` in neuerer Fassung). **Geschlossen ohne Merge, durch gemergte Arbeit ersetzt:** [#33](https://github.com/mason82-dotcom/SkyHub-Next/pull/33), [#34](https://github.com/mason82-dotcom/SkyHub-Next/pull/34), [#37](https://github.com/mason82-dotcom/SkyHub-Next/pull/37), [#38](https://github.com/mason82-dotcom/SkyHub-Next/pull/38), [#39](https://github.com/mason82-dotcom/SkyHub-Next/pull/39) (alte Medienkette, ersetzt durch die Neuaufsetzung auf `main`) sowie [#88](https://github.com/mason82-dotcom/SkyHub-Next/pull/88), [#94](https://github.com/mason82-dotcom/SkyHub-Next/pull/94), [#104](https://github.com/mason82-dotcom/SkyHub-Next/pull/104) (Smart-Farming-Konsolidierung, ersetzt durch #100).
- **Neu zu beachten:** Die Basen von [#36](https://github.com/mason82-dotcom/SkyHub-Next/pull/36) (Head des geschlossenen [#34](https://github.com/mason82-dotcom/SkyHub-Next/pull/34)) und [#40](https://github.com/mason82-dotcom/SkyHub-Next/pull/40) (Head des geschlossenen [#39](https://github.com/mason82-dotcom/SkyHub-Next/pull/39)) gehören zu Branches **geschlossener** PRs. Die Thermal-Kette [#40](https://github.com/mason82-dotcom/SkyHub-Next/pull/40) → [#62](https://github.com/mason82-dotcom/SkyHub-Next/pull/62) steht damit auf Medien-Code, den `main` inzwischen in neuer Fassung hat; der Konflikt bei [#40](https://github.com/mason82-dotcom/SkyHub-Next/pull/40) betrifft `backend/mqtt-ingest.js`, `backend/mqtt-metrics.js` und `backend/pilot-media-http.js`.
- Die früher gelöste `ci.yml`-Kollision der Medien-/Thermal-Kette ist **nicht mehr der Engpass**; [#99](https://github.com/mason82-dotcom/SkyHub-Next/pull/99) kollidiert nach den neuen Merges erneut nur in `ci.yml`.

## Direkt gegen `main` (4 Drafts)

| PR | Thema | Basis | Commits voraus | Dateien | Konflikt | CI |
| --- | --- | --- | ---: | ---: | --- | --- |
| [#46](https://github.com/mason82-dotcom/SkyHub-Next/pull/46) | HiveMind-Labor | `main` | 93 | 27 | keiner | grün (10) |
| [#81](https://github.com/mason82-dotcom/SkyHub-Next/pull/81) | Job-Store gegen PostgreSQL 16 | `main` | 12 | 5 | keiner | unvollständig (4 grün, cancelled 3) |
| [#99](https://github.com/mason82-dotcom/SkyHub-Next/pull/99) | WPML: zentrale Routen-Transaktionen | `main` | 46 | 12 | nur `ci.yml` | grün (9) |
| [#127](https://github.com/mason82-dotcom/SkyHub-Next/pull/127) | Web-UI: SKY//PULSE (experimentell) | `main` | 35 | 25 | 7 Dateien | grün (14) |

| PR | Einordnung und Freigabesperre |
| --- | --- |
| [#46](https://github.com/mason82-dotcom/SkyHub-Next/pull/46) | HiveMind-Simulatorlabor (18 neue Dateien unter `simulators/hivemind/`), greift aber auch in `backend/dji.js`, `backend/registry.js`, Haupt-CI und Dashboard ein. Simulatorbausteine von Änderungen am livefähigen Parser trennen; alte Haupt-CI nicht übernehmen. |
| [#81](https://github.com/mason82-dotcom/SkyHub-Next/pull/81) | Isolierte PV-PostgreSQL-Concurrency-Tests und Job-Store. Fachmodul nur nach isolierter PostgreSQL- und Rollenprüfung auf die heutige Basis portieren; nicht den ganzen Alt-Branch übernehmen. Die Checks waren zuletzt abgebrochen, ein neuer Lauf fehlt. |
| [#99](https://github.com/mason82-dotcom/SkyHub-Next/pull/99) | WPML-Transaktions- und Operatorentwürfe, RLS-Tests und `004_wpml_route_audit_draft.sql`. Kein produktiver Server-Mount. Das SQL-Präfix `004` kollidiert als globaler Zähler mit `004_dji_pilot_media_http.sql`; Registrierung und Fachfamilie nach dem [SQL-Migrationsinventar](sql-migration-inventory.md). |
| [#127](https://github.com/mason82-dotcom/SkyHub-Next/pull/127) | Experimentelle SKY//PULSE-UI. Die brauchbaren Teile sind übernommen ([#120](https://github.com/mason82-dotcom/SkyHub-Next/pull/120) helles Interface, [#162](https://github.com/mason82-dotcom/SkyHub-Next/pull/162) Telemetrie-Cockpit); das Dunkeldesign überschneidet sich mit beidem und kollidiert in 7 Dateien. Schließen, wenn niemand es braucht. |

## Gestapelt, konfliktfrei (4)

| PR | Thema | Basis | Commits voraus | Dateien | Konflikt | CI |
| --- | --- | --- | ---: | ---: | --- | --- |
| [#41](https://github.com/mason82-dotcom/SkyHub-Next/pull/41) | Medien-UI: MinIO-Browser | gestapelt | 9 | 23 | keiner | grün (6) |
| [#42](https://github.com/mason82-dotcom/SkyHub-Next/pull/42) | Medien-UI: Pilot-2-Bibliothek | gestapelt | 16 | 27 | keiner | unvollständig (4 grün, cancelled 2) |
| [#80](https://github.com/mason82-dotcom/SkyHub-Next/pull/80) | Flighttask-Snapshot (verschlüsselt) | gestapelt | 4 | 3 | keiner | unvollständig (3 grün, cancelled 3) |
| [#129](https://github.com/mason82-dotcom/SkyHub-Next/pull/129) | WPML: Dual-Optik | gestapelt | 11 | 4 | keiner | grün (10) |

[#41](https://github.com/mason82-dotcom/SkyHub-Next/pull/41) basiert auf `feature/dashboard-next-ui` ohne offenen PR-Head und ist nicht mit der in `main` gemergten Medien-Lese-API gleichzusetzen. [#42](https://github.com/mason82-dotcom/SkyHub-Next/pull/42) baut darauf auf.

## Mit Konflikten (27) nach Inhalt

Die Pfeile bedeuten: der rechte PR nutzt den Head-Branch des linken als Basis. Sie bedeuten **keine** Mergefreigabe.

### Medien- und Thermal-Kette: [#36](https://github.com/mason82-dotcom/SkyHub-Next/pull/36), [#40](https://github.com/mason82-dotcom/SkyHub-Next/pull/40) → [#43](https://github.com/mason82-dotcom/SkyHub-Next/pull/43) → [#45](https://github.com/mason82-dotcom/SkyHub-Next/pull/45) → [#49](https://github.com/mason82-dotcom/SkyHub-Next/pull/49) → [#50](https://github.com/mason82-dotcom/SkyHub-Next/pull/50) → [#52](https://github.com/mason82-dotcom/SkyHub-Next/pull/52) → [#54](https://github.com/mason82-dotcom/SkyHub-Next/pull/54) → [#56](https://github.com/mason82-dotcom/SkyHub-Next/pull/56) → [#62](https://github.com/mason82-dotcom/SkyHub-Next/pull/62)

| PR | Thema | Basis | Commits voraus | Dateien | Konflikt | CI |
| --- | --- | --- | ---: | ---: | --- | --- |
| [#36](https://github.com/mason82-dotcom/SkyHub-Next/pull/36) | Pilot-2-Medien: STS-Issuer | gestapelt | 27 | 19 | 2 Dateien | unvollständig (6 grün, cancelled 2) |
| [#40](https://github.com/mason82-dotcom/SkyHub-Next/pull/40) | Pilot-2-Medien: TIFF/XMP-Probe | gestapelt | 69 | 46 | 9 Dateien | grün (10) |
| [#43](https://github.com/mason82-dotcom/SkyHub-Next/pull/43) | Vision: YOLO11 offline | gestapelt | 84 | 54 | 9 Dateien | grün (10) |
| [#45](https://github.com/mason82-dotcom/SkyHub-Next/pull/45) | Thermal: Pixel→GPS | gestapelt | 109 | 64 | 9 Dateien | grün (10) |
| [#49](https://github.com/mason82-dotcom/SkyHub-Next/pull/49) | Thermal: Provenienz | gestapelt | 114 | 66 | 9 Dateien | grün (10) |
| [#50](https://github.com/mason82-dotcom/SkyHub-Next/pull/50) | Thermal: Kalibrierprofil | gestapelt | 122 | 69 | 9 Dateien | grün (10) |
| [#52](https://github.com/mason82-dotcom/SkyHub-Next/pull/52) | Thermal: JPEG/XMP-Probe | gestapelt | 128 | 72 | 9 Dateien | grün (10) |
| [#54](https://github.com/mason82-dotcom/SkyHub-Next/pull/54) | Thermal: MP4/SRT-Zeitbasis | gestapelt | 134 | 75 | 9 Dateien | grün (10) |
| [#56](https://github.com/mason82-dotcom/SkyHub-Next/pull/56) | Thermal: MP4-PTS | gestapelt | 140 | 78 | 9 Dateien | grün (10) |
| [#62](https://github.com/mason82-dotcom/SkyHub-Next/pull/62) | Thermal: MP4-Byte-Mapping | gestapelt | 146 | 81 | 9 Dateien | grün (10) |

Die Basen gehören zu Branches **geschlossener** PRs ([#34](https://github.com/mason82-dotcom/SkyHub-Next/pull/34) und [#39](https://github.com/mason82-dotcom/SkyHub-Next/pull/39)). Die Medien-Teile sind durch die Neuaufsetzung auf `main` (#172 bis #182) überholt; was bleibt, sind YOLO11-Vorschau, Thermal-Pixel→GPS und MP4/SRT-Zeitbasis als Labor. Diese Kette sollte nicht weitergepflegt werden, bis jemand sie braucht. Dann einmal an der Wurzel [#40](https://github.com/mason82-dotcom/SkyHub-Next/pull/40) `main` hineinmergen (9 Konflikte), den Medienanteil gegen `main` aussortieren und von unten nach oben weitergeben.

### Smart-Farming-Kette: [#113](https://github.com/mason82-dotcom/SkyHub-Next/pull/113) → [#114](https://github.com/mason82-dotcom/SkyHub-Next/pull/114) → [#115](https://github.com/mason82-dotcom/SkyHub-Next/pull/115) → [#116](https://github.com/mason82-dotcom/SkyHub-Next/pull/116) → [#117](https://github.com/mason82-dotcom/SkyHub-Next/pull/117) → [#122](https://github.com/mason82-dotcom/SkyHub-Next/pull/122) → [#125](https://github.com/mason82-dotcom/SkyHub-Next/pull/125) → [#128](https://github.com/mason82-dotcom/SkyHub-Next/pull/128) → [#131](https://github.com/mason82-dotcom/SkyHub-Next/pull/131) → [#144](https://github.com/mason82-dotcom/SkyHub-Next/pull/144) / [#145](https://github.com/mason82-dotcom/SkyHub-Next/pull/145)

| PR | Thema | Basis | Commits voraus | Dateien | Konflikt | CI |
| --- | --- | --- | ---: | ---: | --- | --- |
| [#113](https://github.com/mason82-dotcom/SkyHub-Next/pull/113) | Smart Farming P1/P3 (Kette) | gestapelt | 24 | 49 | 13 Dateien | grün (2) |
| [#114](https://github.com/mason82-dotcom/SkyHub-Next/pull/114) | Smart Farming P1/P3 (Kette) | gestapelt | 29 | 54 | 13 Dateien | grün (2) |
| [#115](https://github.com/mason82-dotcom/SkyHub-Next/pull/115) | Smart Farming P3 (Kette) | gestapelt | 32 | 57 | 13 Dateien | grün (2) |
| [#116](https://github.com/mason82-dotcom/SkyHub-Next/pull/116) | Smart Farming P3 (Kette) | gestapelt | 37 | 61 | 14 Dateien | grün (2) |
| [#117](https://github.com/mason82-dotcom/SkyHub-Next/pull/117) | Smart Farming P3.1 (Kette) | gestapelt | 46 | 65 | 14 Dateien | grün (2) |
| [#122](https://github.com/mason82-dotcom/SkyHub-Next/pull/122) | Smart Farming P3.2 (Kette) | gestapelt | 56 | 71 | 14 Dateien | grün (3) |
| [#125](https://github.com/mason82-dotcom/SkyHub-Next/pull/125) | Smart Farming P3.3 (Kette) | gestapelt | 59 | 74 | 14 Dateien | grün (2) |
| [#128](https://github.com/mason82-dotcom/SkyHub-Next/pull/128) | Smart Farming P3.4 (Kette) | gestapelt | 64 | 77 | 14 Dateien | grün (2) |
| [#131](https://github.com/mason82-dotcom/SkyHub-Next/pull/131) | Smart Farming P3.5a (Kette) | gestapelt | 67 | 80 | 14 Dateien | grün (2) |
| [#144](https://github.com/mason82-dotcom/SkyHub-Next/pull/144) | Smart Farming P3.5b (Kette) | gestapelt | 71 | 83 | 14 Dateien | grün (2) |
| [#145](https://github.com/mason82-dotcom/SkyHub-Next/pull/145) | Smart Farming P3.5b (Kette) | gestapelt | 70 | 83 | 14 Dateien | grün (2) |

39 von 46 Basisdateien liegen schon auf `main` (28 identisch); je Stufe kommen 7 (#113) bis 40 (#144/#145) neue Dateien dazu (P3-GIS-Abfragen, Rasterio, COG, Vier-Index-Vergleich). 13 bis 14 Konflikte aus der Konsolidierung (#100). Laborcode; die Freigabe-Gates (Datenherkunft, Kalibrierung, Lizenz, Privacy) sind offen.

### Integrationsbranches: [#28](https://github.com/mason82-dotcom/SkyHub-Next/pull/28) → [#29](https://github.com/mason82-dotcom/SkyHub-Next/pull/29) → [#30](https://github.com/mason82-dotcom/SkyHub-Next/pull/30), [#44](https://github.com/mason82-dotcom/SkyHub-Next/pull/44), [#110](https://github.com/mason82-dotcom/SkyHub-Next/pull/110)

| PR | Thema | Basis | Commits voraus | Dateien | Konflikt | CI |
| --- | --- | --- | ---: | ---: | --- | --- |
| [#28](https://github.com/mason82-dotcom/SkyHub-Next/pull/28) | TSA/Proxy-Vertrauen | gestapelt | 10 | 8 | 2 Dateien | unvollständig (3 grün, cancelled 3) |
| [#29](https://github.com/mason82-dotcom/SkyHub-Next/pull/29) | WPML/MinIO/Diagnose-Integration | gestapelt | 18 | 72 | 23 Dateien | unvollständig (4 grün, cancelled 3) |
| [#30](https://github.com/mason82-dotcom/SkyHub-Next/pull/30) | WPML-KMZ-Inspektion | gestapelt | 24 | 65 | 24 Dateien | unvollständig (3 grün, cancelled 3) |
| [#44](https://github.com/mason82-dotcom/SkyHub-Next/pull/44) | DJI-Referenzsystem (offline) | gestapelt | 181 | 54 | 21 Dateien | grün (3) |
| [#110](https://github.com/mason82-dotcom/SkyHub-Next/pull/110) | Flight-Area: Review-Nachweis | gestapelt | 20 | 13 | 2 Dateien | unvollständig (3 grün, cancelled 3) |

- [#28](https://github.com/mason82-dotcom/SkyHub-Next/pull/28) (TSA-Proxy-Vertrauen, Basis ist der Branch des gemergten #24): Mit `main` ist die Option `SKYHUB_DJI_TSA_TRUSTED_PROXY_IPS` bereits vorhanden, der verbleibende Unterschied ist nicht im Detail geprüft; kollidiert in `pilot-config.test.js` und `docker-compose.yml`.
- [#29](https://github.com/mason82-dotcom/SkyHub-Next/pull/29) und [#30](https://github.com/mason82-dotcom/SkyHub-Next/pull/30): ihre RC-Plus-2-/M4T-Diagnostik ist von `main` überholt (20 Dateien weichen ab), enthalten aber Eigenes: [#29](https://github.com/mason82-dotcom/SkyHub-Next/pull/29) einen „Command Center“-Stand (11 Dateien), [#30](https://github.com/mason82-dotcom/SkyHub-Next/pull/30) eine WPML-API (`backend/wpml-api.js`).
- [#44](https://github.com/mason82-dotcom/SkyHub-Next/pull/44): nur 4 Referenz-Docs und 1 Test sind neu; 21 Konflikte durch den Stand der Basis.
- [#110](https://github.com/mason82-dotcom/SkyHub-Next/pull/110): 7 eigene Dateien (Flight-Area-Lab-Review); die Basis `feature/dji-flight-area-sync-monitor-20261023` gehörte zum geschlossenen [#75](https://github.com/mason82-dotcom/SkyHub-Next/pull/75). Neu auf `main` aufsetzen oder schließen.

## Kontrollierte Bearbeitungsreihenfolge (Vorschlag, zur Entscheidung)

1. **Sicherheit und Betrieb sind erledigt:** #176 (exakter Proxy-Peer) ist gemergt und auf dem Pi geprüft, siehe [Proxy-Vertrauen](proxy-trust-rollout.md).
2. **Neu aufsetzen statt Alt-Branch mergen:** Bei [#46](https://github.com/mason82-dotcom/SkyHub-Next/pull/46), [#81](https://github.com/mason82-dotcom/SkyHub-Next/pull/81) und [#99](https://github.com/mason82-dotcom/SkyHub-Next/pull/99) jeweils nur den eigentlichen Feature-Diff aus einem frischen `main`-Branch übernehmen und einzeln testen.
3. **Kleine Aufräumschritte:** [#110](https://github.com/mason82-dotcom/SkyHub-Next/pull/110) neu aufsetzen oder schließen; [#127](https://github.com/mason82-dotcom/SkyHub-Next/pull/127) schließen oder gezielt weiterverwenden. [#1](https://github.com/mason82-dotcom/SkyHub-Next/pull/1) (historisches Dashboard v3.1) ist inzwischen geschlossen; falls gewünscht, die drei darin einzigen Dateien (`docs/pi-dji-mqtt-diagnostics.md`, `docs/pilot2-h5-login.md`, `scripts/pi-mqtt-observe.sh`) aus der Historie in einen eigenen kleinen PR holen.
4. **Fachketten** (Smart Farming, Thermal) erst nach Freigabe-Gates und Deduplizierung gegen `main`; kein Massensquash gestapelter Historien.
5. **Nie ohne Rücksprache schließen.** Geschlossen wurde auf ausdrückliche Freigabe nur, was oben als überholt benannt ist.

## Reproduzierbare Live-Prüfung (nur lesen)

```bash
git fetch origin
git rev-parse origin/main
gh pr list --state open --limit 100
# Für einen PR: Head holen und gegen main prüfen
# git fetch origin pull/NN/head:refs/remotes/origin/pr-NN
# git merge-tree --write-tree --name-only origin/main origin/pr-NN
# git diff --stat origin/main...origin/pr-NN
```

Vor einer Integration zusätzlich PR-Base- und Head-SHA, den exakten Diff, Import- und Mount-Grenzen, Node-/Python-/PostgreSQL-/Browser-CI auf dem **finalen SHA**, Pi-Ports, Secrets und Rollback prüfen. „Konfliktfrei“ heißt nur, dass Git den Merge bilden kann, nicht dass Verhalten, Tests oder Reihenfolge-Abhängigkeiten stimmen. „Commits voraus“ zählt bei gestapelten PRs die Commits der Vorgänger mit. Das Repository kann keine aktuelle Pi-Installation und keine DJI-Hardwarefreigabe beweisen.
