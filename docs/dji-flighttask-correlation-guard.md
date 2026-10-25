# Flighttask-Korrelation – isolierter, nicht angebundener Auswahlhelfer

**Stand: 25.10.2026 · [SkyHub-Next](https://github.com/mason82-dotcom/SkyHub-Next).**

`resolveFlighttaskObservation(candidates, report)` wählt aus einer begrenzten,
vertrauenswürdig bereitgestellten Beobachtungsliste eine **eindeutige**
Workspace-/Observation-UUID. Der Helfer arbeitet rein synchron, ohne
PostgreSQL, MQTT, HTTP, GPIO oder DJI-Steuerbefehle, und wird nicht von
`backend/server.js` importiert.

## Tatsächliche Cloud-API-1.18-Korrelationsschlüssel

| Meldung | Erforderlicher Schlüssel | Nicht für Auswahl verwenden |
| --- | --- | --- |
| `flighttask_execute`-Antwort über `services_reply` | Workspace + Gateway-SN + **TID + BID** (gültige UUIDs) | Flight-ID: im bestätigten Reply-DTO **nicht vorhanden** |
| `flighttask_progress` über `events` | Workspace + Gateway-SN + **`flight_id`** | TID/BID des Events: unabhängig vom ursprünglichen Request |

Bei Service-Antworten wird eine künstlich mitgegebene `flightId`
ausdrücklich abgewiesen. Mehrere passende Beobachtungen – auch bei gleicher
TID/BID und verschiedenen Flight-IDs – sind **mehrdeutig** und werden
nicht beliebig aufgelöst. Bei Progress-Ereignissen führen wiederverwendete
Flight-IDs entsprechend zur Ablehnung. Fehlende, ungültige oder doppelte
Kandidaten und Kandidatenlisten mit mehr als 1000 Einträgen werden verweigert.

## Integration und Sicherheitsgrenzen

Das ist **kein Ersatz** für den bereits integrierten
[workspace-begrenzten PostgreSQL-Multi-Missions-Router](dji-flighttask-multimission-router.md).
Dieser verwendet parametrisiertes SQL (maximal zwei Treffer), unabhängige
serverseitige Autorisierung und das CAS-Journal. Der reine Helfer dient nur
dem dokumentierten Korrelationsvertrag und synthetischen Regressionstests.

Vor jeder tatsächlichen Zustandsänderung müssen die vorhandenen DJI-Parser
`method`, Topic/Gateway, Ergebnisform, Retained-Flag, Zeitfenster, Replay
und Zustandsphase validieren. Der Helfer selbst prüft **weder** die Echtheit
des Ereignisses **noch** Rollen, Berechtigungen, Datenbankzugriff,
Nachrichtenzeitpunkte oder atomare Journalupdates. Der Aufrufer muss die
Kandidatenliste authentisiert und workspace-begrenzt beziehen.

Tests: `node --test backend/test/dji-flighttask-correlation-guard.test.js`

**Kein Server-/Pi-Deployment, keine produktive DB-Migration, keine
DJI-Hardwarefreigabe und kein Missionsversand.** Die drei Flags
`flightReady`, `operationVerified` und `hardwareVerified`
bleiben durch diese Änderung unverändert `false`.
