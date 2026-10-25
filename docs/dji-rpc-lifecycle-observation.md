# DJI Cloud API 1.18 – Flighttask Reply- und Progress-Beobachtung

Stand: 23.10.2026 · **Offline-only, keine Hardwareabnahme, kein Deployment.**

## Ausgangspunkt

SkyHub enthält den isoliert entwickelten, rein lesenden `services_reply`-Contract seit [PR #78](https://github.com/mason82-dotcom/SkyHub-Next/pull/78) auf `main`. Der ursprüngliche Quellbranch war `feature/dji-demo-rpc-contract-20261022`. Der synthetische Protokoll-Audit
in [PR #47](https://github.com/mason82-dotcom/SkyHub-Next/pull/47).
Diese Entwicklung **portiert keinen RPC-Publisher** und ändert weder den
aktiven Backend-Server noch den vorhandenen Parser. Stattdessen prüft sie
eine reine, methodenspezifische Zustandsprojektion für
`flighttask_execute`.

Referenzen im gepinnten SDK
[`cdmiltd/dji-cloud-api-sdk@73c977e`](https://github.com/cdmiltd/dji-cloud-api-sdk/tree/73c977e526d39f410ccf112bfcfd79e090285640):

- [ServiceMethod.java](https://github.com/cdmiltd/dji-cloud-api-sdk/blob/73c977e526d39f410ccf112bfcfd79e090285640/sdk/src/main/java/ltd/cdmi/dji/cloudapi/sdk/protocol/method/ServiceMethod.java):
  `flighttask_execute` ist ein *services*-Methodenname.
- [ReplyEnvelope.java](https://github.com/cdmiltd/dji-cloud-api-sdk/blob/73c977e526d39f410ccf112bfcfd79e090285640/sdk/src/main/java/ltd/cdmi/dji/cloudapi/sdk/protocol/envelope/ReplyEnvelope.java):
  `services_reply.data.result` beschreibt die Service-Antwort.
- [EventMethod.java](https://github.com/cdmiltd/dji-cloud-api-sdk/blob/73c977e526d39f410ccf112bfcfd79e090285640/sdk/src/main/java/ltd/cdmi/dji/cloudapi/sdk/protocol/method/EventMethod.java):
  `flighttask_progress` ist ein gesondertes *events*-Methodenereignis
  (im SDK `need_reply=1`); die Rückmeldung wird hier **nicht** gesendet.
- [FlighttaskProgressData.java](https://github.com/cdmiltd/dji-cloud-api-sdk/blob/73c977e526d39f410ccf112bfcfd79e090285640/sdk/src/main/java/ltd/cdmi/dji/cloudapi/sdk/command/event/wayline/FlighttaskProgressData.java):
  `data.result`, `data.output.status` und `data.output.ext.flight_id`.
  Dieses Java-Modell ist durch Simulator-/Dokumentenbefunde gestützt, **nicht**
  als Matrice-4T-Hardwareabnahme für SkyHub anzusehen.

## Verträge und Zustände

`backend/dji-flighttask-observation.js` exportiert:

- `beginFlighttaskObservation({gatewaySn,tid,bid,flightId,method,sentAt})`
  – nur für `flighttask_execute`, mit begrenzter Beobachtungs-TTL.
- `parseFlighttaskProgressEvent(topic,payload,{now,retained})` –
  beschränkte, synthetisch testbare Projektion des Events mit sechs
  Feldern; GPS, Wegpunkte und sonstige Felder werden verworfen.
- `advanceFlighttaskObservation(state,{kind,reply|event},{now})` –
  reiner Reducer, ohne Timer, Publish oder Mutation des übergebenen Zustands.
- `summarizeFlighttaskObservation(state)` –
  Ergebnis **ohne** Seriennummer, Task-ID, Transaktions-ID, Positionsdaten oder
  Nutzlasten; immer `operationVerified:false`, `flightReady:false`.

| Quelle | Resultat | Audit-Interpretation |
| --- | --- | --- |
| Gesendete Anfrage im synthetischen Kontext | Noch keine Antwort | `awaiting_reply` |
| `services_reply` mit passender `gatewaySn/tid/bid/method` und `result=0` | Service-Antwort erfolgreich | `reply_accepted`; **kein Missionsabschluss** |
| `services_reply.data.result != 0` | Dienstanfrage zurückgewiesen/fehlgeschlagen | `reply_rejected` |
| `flighttask_progress` mit passender `gatewaySn/flight_id` | Status `sent`, `in_progress`, `paused` | `reported_*` |
| Dasselbe Event mit `status=ok`, `result=0` | Erfolg **gemeldet** | `reported_ok`; **keine unabhängige Flugbestätigung** |
| Fehlender Abschluss bis TTL | Beobachtungsfenster abgelaufen | `expired_unverified`, nicht „Flug gescheitert“ |
| Widersprüchliche Antwort/Ereignisfolge | Datenkonflikt | `conflicting_reports`, keine Erfolgsaussage |

Eine DJI-`events`-Nachricht hat eigene `tid`/`bid` und wird **nicht**
fälschlich an die Service-Transaktionskennungen gekoppelt. Stattdessen ist
die konservative Korrelation mit `gatewaySn`, `flight_id` und Zeitfenster
zwingend. Um unbekannte Pilot-/Dock-Toppologien nicht als geprüft auszugeben,
akzeptiert der aktuelle Offline-Eventparser nur
`thing/product/{gatewaySn}/events` und – falls vorhanden – einen
identischen `gateway`-Envelope-Wert. Unbekannte Topologievarianten
müssen vor Live-Nutzung separat abgenommen werden.

Der isolierte RPC-Entwurf kann `terminal:true` für eine
`services_reply` mit `result=0` liefern. **Diese Eigenschaft wird bewusst
nicht als flugbezogenes Endereignis verwendet.** Die Beobachtung bewertet
dafür ausschließlich ein passend korreliertes `flighttask_progress`-Event.

## Testausführung

```sh
node --check backend/dji-flighttask-observation.js
node --test backend/test/dji-flighttask-observation.test.js
(cd backend && npm test)
```

Alle Fixtures im Test sind synthetisch. Die Tests prüfen unter anderem
Antwort-/Event-Diskriminierung, Replay, widersprüchliche Endzustände,
ungültige Methoden, Gateways, Task-IDs, Zeitstempel sowie Datenredaktion.

## Für eine spätere produktive Integration fehlt ausdrücklich

1. Authorisierte, dokumentierte **Sender- und Authentifizierungslogik**;
   sie wird in diesem Branch nicht geschaffen.
2. Konsolidierung mit dem bestehenden separaten
   `dji-service-reply-contract.js` unter Beibehaltung strenger
   Validierung und TTL-/Replay-Semantik.
3. Echte hardwarebezogene Event-Typen, Quellen und Firmware-Schemata;
   insbesondere RC Plus 2 / Matrice 4T nicht als bestätigt markieren.
4. Eine gesonderte `events_reply`-Policy für `need_reply=1`, ohne
   daraus eine allgemeine Command-Freigabe abzuleiten.
5. Persistenter, autorisierter und idempotenter Lebenszyklus-Speicher;
   ohne den gibt es keine zuverlässige Reconnect-/Restart-Korrelation.

**Betriebsschutz:** Keine Änderung an `backend/server.js`, MQTT ACLs,
Broker, EMQX, Docker Compose, Redis, PostGIS, Pi-Systemdiensten, DJI Pilot 2
oder realen Drohnen. Dieser Branch wird nicht eigenständig deployed.
