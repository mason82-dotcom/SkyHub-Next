# DJI-Kartenelemente: Aktivierungsstand und Gates (24.10.2026)

**Status: nicht aktiviert, Entscheidungsvorlage.** Gemessen am laufenden Pi, nichts an Produktion verändert. Ergänzt [Rollenvertrag](dji-map-access.md), [Elementvertrag](dji-map-element-contract.md) und [Mutationsvertrag](dji-map-mutation-contract.md).

## Ist-Stand

- `SKYHUB_DJI_MAP_ELEMENTS_ENABLED=false`. Die frühere Compose-Falle ist behoben: `docker-compose.yml` reicht das Flag durch (Standard `false`).
- Die Pi-Datenbank enthält **keine** `dji_map_*`-Tabellen (Migration 001 nicht angewendet), aber echte Daten: `drone_telemetry` 2.608 Zeilen, übrige Bestandstabellen leer.
- `frontend/public/pilot-login.js` lädt nur die Komponenten `thing`, `api`, `ws`, `tsa`, **kein Karten-Modul**. Pilot 2 würde auch bei aktiver Route keine Elementgruppen anfragen.

## Probelauf an einer Kopie der Produktionsdatenbank

Mit `scripts/pi-migration-rehearsal.sh` (liest Produktion nur per `pg_dump`, Wegwerf-Container mit gleichem Image, nur Loopback, Datenbankname `skyhub_test` wie von den Tests verlangt, Container und Dump werden gelöscht):

| Prüfung | Ergebnis |
| --- | --- |
| Wiederherstellung | 7 Tabellen, identische Zeilenzahlen (inkl. 2.608 Telemetriezeilen) |
| Integrationstests (CAS/Lock/Audit; PostGIS-Migration, Workspace-Isolation, Recovery) | 2 von 2 bestanden gegen die Kopie |
| Migrationen 001, 002, 003 in dieser Reihenfolge (`ON_ERROR_STOP`) | fehlerfrei, je zweiter Lauf ebenfalls (wiederholbar) |
| Bestandstabellen nach Tests und Migration | unverändert |
| Lese-Adapter auf migrierter Kopie | leerer Workspace `{"code":0,"data":[],"message":"success"}`; verteilte und private Gruppen korrekt getrennt |

Die Tests laufen **vor** den Migrationen: Sie setzen den unmigrierten Zustand voraus (Probe-Tabellen müssen nach `ROLLBACK TO SAVEPOINT` verschwinden). Grenzen: Kopie nicht anonymisiert (lokal, Wegwerf), es gibt keine realen Karten-Bestandsdaten, **nichts davon wurde produktiv angewendet**.

## Gates

| Gate | Stand |
| --- | --- |
| Migration an Kopie getestet | **erledigt** (siehe oben); produktive Anwendung offen: Sicherung und ausdrückliche Freigabe |
| Compose reicht Flag durch | erledigt |
| Pilot-2-Seite lädt Karten-Modul | **offen** (Code fehlt, braucht Hardware) |
| Operator-/Admin-Authentifizierung und Rollen | **offen**: es gibt nur die Pilot-Leserolle |
| Schreibpfad mit Audit und Locks | Baustein und Migration 002 vorhanden, nicht angebunden |
| WebSocket-Refresh | offen |
| Pilot-2-Hardwareabnahme | offen |
| Restore-Test mit realitätsnahen Bestandsdaten | teilweise (Schema und Telemetrie ja, Karten-Bestandsdaten gibt es nicht) |

## Bewertung und Entscheidungen

Eine Aktivierung bringt **jetzt keinen Nutzen**: Pilot 2 fragt nicht ab, es gibt keine Daten und keinen Schreibpfad. Vorschlag: zuerst Karten-Modul in der Pilot-Seite und Rollenmodell klären, dann Migration 001 produktiv (nach `pg_dump` und erneutem Probelauf), zuletzt das Flag. **Offen für den Betreiber:** wer Gruppen anlegen darf (Operator-Rolle), ob Pilot-2-Kartenelemente überhaupt gebraucht werden (die SkyHub-Karte ist unabhängig davon), und der Zeitpunkt der produktiven Migration.
