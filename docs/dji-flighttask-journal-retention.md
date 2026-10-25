# DJI Flighttask-Journal – isolierte Aufbewahrungsgrenzen

Stand: 23.10.2026. **Nur synthetische Offline-/CI-Entwicklung im Repository `mason82-dotcom/SkyHub-Next`.**

## Ziel und Ausgangslage

Die in [PR #83](https://github.com/mason82-dotcom/SkyHub-Next/pull/83) nach `main`
übernommene Version speichert einen begrenzten Flighttask-Beobachtungszustand,
aber besitzt bisher keinen Löschvertrag. Dieser Branch ergänzt nur einen
**separaten, nicht vom Server importierten Löschadapter**.
Die Tabelle wird unverändert ausschließlich aus
`backend/db/offline/dji-flighttask-observation.sql` in der
Testdatenbank `skyhub_test` erstellt. **Keine produktive Migration,
keine Pi-Installation, kein Timer, kein MQTT-Zugriff.**

## Sicherheit

`createFlighttaskRetention(db,{authorize})` verlangt **beide**
Injektionen. `authorize(principal,workspaceId)` muss von einer
vertrauenswürdigen, separat geprüften Authentifizierungs-/RBAC-Schicht
stammen; ein Client darf keine Autorisierungs-Callbacks erstellen.
Der Adapter akzeptiert nur eine explizite Rückgabe `true` – weder
`{allowed:true}` noch Rollen-Strings genügen. **Dies ist keine eigene
Benutzerauthentifizierung.**

`prune({workspaceId,principal,now,retentionDays,maxRows})`
validiert eine UUID für den Workspace, Zeit in Millisekunden,
`retentionDays` von **1–3650** und `maxRows` von **1–500**
(Standard: 30 Tage und 100 Einträge).

Die SQL-Abfrage ist auf `workspace_id` gebunden und benutzt
`ORDER BY updated_at,observation_id LIMIT ... FOR UPDATE SKIP LOCKED`
innerhalb eines CTE und anschließend ein atomisches
`DELETE ... USING`. Es werden **nur** alte Snapshots in diesen
Phasen gelöscht:

| Löschbar nach Aufbewahrungsfrist | Niemals direkt löschbar |
| --- | --- |
| `reported_ok`, `reported_failed`, `reported_canceled` | `awaiting_reply`, `reply_accepted` |
| `reply_rejected`, `conflicting_reports` | `reported_sent`, `reported_in_progress`, `reported_paused` |
| `expired_unverified` | Alle unbekannten oder beschädigten Phasen |

Ein aktiver Datensatz wird auch nach Zeitablauf **nicht** allein wegen
seines Alters gelöscht. Zuerst müsste ein separater, autorisierter
`recover(...)`-Lauf ihn anhand der TTL sicher in
`expired_unverified` überführen. Der Retention-Adapter führt
**keine** Zustandsübergänge aus und sendet **keine** DJI-Befehle.

Der Rückgabewert enthält ausschließlich
`deletedCount`, `limited` und eine statische Klassifikation –
keine Seriennummer, Flight-ID oder Beobachtungs-ID. Fehler des
Datenbankadapters und der Autorisierungsfunktion werden redigiert.

## Tests

- `backend/test/dji-flighttask-journal-retention.test.js`:
  Autorisierung fail-closed, Workspace-Abgrenzung, SQL-Scoping,
  Terminal-Whitelist, Mengen-/Altersgrenzen, Datenminimierung.
- `backend/test/dji-flighttask-journal-retention.integration.test.js`:
  eigentlicher PostgreSQL-DELETE im zufälligen Test-Schema, mit
  verschiedenen Workspaces, aktiven und abgeschlossenen Einträgen,
  neuen und alten Meldungen sowie Batch-Grenzen.
- CI führt den Echttest im vorhandenen Job
  `isolated-postgis-integration` gegen `skyhub_test` aus.
  Die Testfunktion ist ohne `SKYHUB_TEST_DATABASE_URL` übersprungen.

**Forschungsnachtrag 24.10.2026:** Für spätere Produktionsintegration bietet der [isolierte Policy-gesteuerte Retention-Entwurf](dji-flighttask-workspace-rls-retention-policy.md) eine Admin-/Workspace-Autorisierung, serverseitig aufgelöste Fristen und einen fail-closed Legal-Hold je Workspace. Ohne `execute:true` wird nicht gelöscht. Der ältere `createFlighttaskRetention`-Adapter bleibt ein **internes** Primitive mit direkt übergebenen `retentionDays`/`now` und darf nicht unmittelbar an HTTP oder Kundenparameter angebunden werden.

## Offene Produktionsgates

Vor einer echten Aktivierung fehlen: verifizierte RBAC-/Workspace-Bindung,
Mindestberechtigungen der Datenbankrolle, rechtlich definierte
Aufbewahrungsfrist, Backup-Löschkonzept, DSGVO-Review, separate
Migrations- und Rollback-Strategie und Hardwareabnahme nach Gerät/Firmware.
`flightReady`, `hardwareVerified` und `operationVerified` werden
von dieser Änderung niemals gesetzt.

**Die PR darf als isolierter Forschungsbaustein gemergt werden; das ist
ausdrücklich keine Erlaubnis, die Tabelle oder Löschung live zu schalten.**
