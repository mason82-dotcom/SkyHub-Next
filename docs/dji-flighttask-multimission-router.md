# DJI 1.18 – Offline-Multi-Missions-Routing

**Stand 24.10.2026 · Repository [SkyHub-Next](https://github.com/mason82-dotcom/SkyHub-Next).**

## Ziel

Das auf `main` vorhandene, aber **nicht produktiv angebundene**
[Flighttask-CAS-Journal](dji-flighttask-durable-journal.md) kann mit mehreren
Beobachtungen arbeiten. Bisher musste ein vertrauenswürdiger Aufrufer jedoch
bereits die `observationId` jeder DJI-Meldung kennen.

`backend/dji-flighttask-multimission-router.js` ergänzt eine **rein
lesende, workspace-begrenzte Suche** nach einem genau passenden Journal-
Eintrag. Eine Zustandsänderung erfolgt anschließend ausschließlich über
[die autorisierte Journalhülle](dji-flighttask-journal-access.md),
den vorhandenen strengen DJI-Parser und den revisionsgesicherten CAS-Store.
Der neue Router ist **nicht** in `backend/server.js` importiert.
Es gibt keine HTTP-Route, MQTT-Subscription, `events_reply`, DJI-
Steuerfunktion, Schema-Migration, automatische Suche oder Pi-Installation.

## Korrelation

| Eingang | Erlaubte Suche im gespeicherten Snapshot |
| --- | --- |
| `thing/product/{gatewaySn}/services_reply` mit `method=flighttask_execute` | Gleicher autorisierter Workspace und exakt `gatewaySn` + `tid` + `bid`, strenger `data.result:int`-Contract |
| `thing/product/{gatewaySn}/events` mit `method=flighttask_progress` | Gleicher autorisierter Workspace und exakt `gatewaySn` + `flight_id` |

Die Service-Antwort und das Progress-Ereignis haben **unabhängige**
`tid`/`bid`. Ein Event darf deshalb nicht über die ursprünglichen
Service-Transaktionsnummern geraten werden.

Die SQL-Abfragen sind vollständig parametrisiert, setzen **immer**
`workspace_id=$1` und liefern maximal **zwei** Beobachtungs-IDs:
null Treffer = `no-matching-observation`; zwei Treffer =
`ambiguous-observation` und **kein Schreibzugriff**. Dies vermeidet
die gefährliche Auswahl einer beliebigen Mission, wenn Flight-IDs
wiederverwendet werden oder doppelte Beobachtungen vorhanden sind.
Ein einzelner Treffer wird **nicht automatisch akzeptiert**: Die
ursprünglichen Parser-, Zeitfenster-, Replay- und Reducerprüfungen werden
anschließend im Journal erneut durchgeführt.

## Autorisierung und Datenschutz

`createFlighttaskMessageRouter(db,scopedJournal,{authorize})` benötigt
drei **vertrauenswürdig injizierte** Abhängigkeiten. Ein Aufruf
`router.route({workspaceId,principal,kind,topic,payload,now,retained})`
verlangt einen gebundenen Operator/Admin-Principal **und** eine frische,
exakt boolesche Freigabe `authorize(principal,workspaceId,'route_observation')`.

Danach wiederholt die bestehende `createScopedFlighttaskJournal`-Hülle
die eigene Workspace-/Berechtigungsprüfung für `observe`.
Unbekannte Rollen, falsche Workspace-IDs, nicht verifizierte Autorisierer,
Retained-/Stale-/Future-Frames, unbekannte Methoden oder nicht unterstützte
Reply-Formate werden verweigert. Der resultierende öffentliche DTO enthält
nur `matched`, `applied`, eine kurze Fehlerklassifikation und
gegebenenfalls `revision`; **keine** Geräte-ID, Flight-ID, Koordinaten,
JWTs, Secrets, Raw-MQTT-Frames oder internen Snapshot.

**Wichtig:** Die `principal`-Werte allein sind keine Identität!
Die injizierte Berechtigungsfunktion muss einen **serverseitig
authentifizierten** Benutzer-/Workspace-Bezug unabhängig vom Paket
nachweisen. Weder das Routingmodul noch der Offline-Test stellt eine
produktive Authentifizierung bereit. Es darf nicht direkt von
unkontrollierten HTTP- oder MQTT-Clients verwendet werden.

## Tests

```sh
node --check backend/dji-flighttask-multimission-router.js
node --test backend/test/dji-flighttask-multimission-router.test.js
node --test backend/test/dji-flighttask-multimission-router.integration.test.js
```

Der Integrations-Test wird ausschließlich beim Setzen von
`SKYHUB_TEST_DATABASE_URL` aktiv. Seine Sicherheitsgrenzen sind der
Loopback-Host und exakt die PostgreSQL-Datenbank `skyhub_test`.
Ein zufälliges isoliertes Schema wird angelegt, auf zwei parallele
Workspaces begrenzt geprüft, nach einem Verbindungsneustart gelesen und
danach gelöscht. Der Job `isolated-postgis-integration` führt diesen
Test mit dem **dynamisch zugewiesenen Test-Port** aus.
Sämtliche DJI-Kennungen, Events und Missionen sind synthetisch.

## Produktionsgates

- Kein aktiver Start/Stop/Pause-Befehl; `result=0` bedeutet nur Request-ACK,
  `reported_ok` nur eine **Gerätemeldung**.
- Keine automatische Zuordnung bei Mehrdeutigkeit; eine echte
  Geräte-/Firmware-Abnahme ist für `gatewaySn` und `flight_id` nötig.
- Produktive Identity-Provider-Integration, Audit, PostgreSQL-RLS,
  passende JSONB-Indizes, Archivierung/Retention, Restore-/Rollback-Plan
  und eine explizite Berechtigung für spätere Live-Daten fehlen.
- Bei sehr großen Journalbeständen ist die experimentelle JSONB-Filterung
  ohne zusätzliche, separat geprüfte Indizes nicht produktionsfähig.
- `flightReady`, `hardwareVerified`, `operationVerified` bleiben
  unverändert `false`.

**Eine erfolgreiche CI bedeutet keine DJI-Hardware- oder Pi-Abnahme.**
