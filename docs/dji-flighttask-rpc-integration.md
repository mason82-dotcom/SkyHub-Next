# DJI Cloud API 1.18 – Offline-RPC-Vertragsintegration

Stand: 23.10.2026. **Read-only, kein Brokerzugriff, kein Deployment, keine Flugfreigabe.**

## Branch-Abhängigkeiten

- Protokoll-Audit: [PR #47](https://github.com/mason82-dotcom/SkyHub-Next/pull/47) (inzwischen in `main` übernommen).
- Flighttask-Beobachtung: [PR #74](https://github.com/mason82-dotcom/SkyHub-Next/pull/74), am 23.10.2026 nach `main` gemergt.
- Isolierter RPC-Prototyp: `feature/dji-demo-rpc-contract-20261022`. Nur die
  beiden Dateien `backend/dji-service-reply-contract.js` und
  `backend/test/dji-service-reply-contract.test.js` wurden **inhaltlich**
  daraus übernommen, **nicht** der dortige Server/MQTT-Ingest.
- Dieser Branch ergänzt die **strenge methodenspezifische Integration** mit
  `backend/dji-flighttask-reply-adapter.js` und Regressionstests.

**Integrationsnachtrag 23.10.2026:** PR #74 und [PR #78](https://github.com/mason82-dotcom/SkyHub-Next/pull/78) wurden in dieser Reihenfolge nach `main` gemergt. Die ursprüngliche gestapelte Review-Basis ist historisch. Der Adapter bleibt **nicht an `backend/server.js` angeschlossen**.

## Bestätigte Protokollunterscheidung

Die gepinnte Drittanbieter-Referenz
[`cdmiltd/dji-cloud-api-sdk@73c977e`](https://github.com/cdmiltd/dji-cloud-api-sdk/tree/73c977e526d39f410ccf112bfcfd79e090285640)
enthält:

- [`FlighttaskExecuteReply.java`](https://github.com/cdmiltd/dji-cloud-api-sdk/blob/73c977e526d39f410ccf112bfcfd79e090285640/sdk/src/main/java/ltd/cdmi/dji/cloudapi/sdk/command/service/wayline/FlighttaskExecuteReply.java):
  `services_reply` bestätigt `flighttask_execute` mit
  `data.result`, ohne anwendungsspezifisches `output`.
- [`ReplyEnvelope.java`](https://github.com/cdmiltd/dji-cloud-api-sdk/blob/73c977e526d39f410ccf112bfcfd79e090285640/sdk/src/main/java/ltd/cdmi/dji/cloudapi/sdk/protocol/envelope/ReplyEnvelope.java):
  `output:null` ist als allgemeine Reply-Hülle ebenfalls darstellbar.
- [`EventMethod.java`](https://github.com/cdmiltd/dji-cloud-api-sdk/blob/73c977e526d39f410ccf112bfcfd79e090285640/sdk/src/main/java/ltd/cdmi/dji/cloudapi/sdk/protocol/method/EventMethod.java)
  und [`FlighttaskProgressData.java`](https://github.com/cdmiltd/dji-cloud-api-sdk/blob/73c977e526d39f410ccf112bfcfd79e090285640/sdk/src/main/java/ltd/cdmi/dji/cloudapi/sdk/command/event/wayline/FlighttaskProgressData.java):
  `flighttask_progress` ist ein **separates** `events`-Ereignis mit
  `data.result`, `data.output.status` und
  `data.output.ext.flight_id`.

Das SDK ist eine **nicht offizielle Drittanbieter-Referenz**. Simulatorchecks
und API-Feldmodelle sind **keine echte Pilot-2-/RC-Plus-2-/Matrice-4T-Abnahme**.

## Vertragsgrenzen

`observeFlighttaskServiceReply(state,topic,payload,{now,retained})`:

1. Verwendet den übernommenen, größen- und zeitbegrenzten, read-only
   `parseServiceReply`; verwirft Rohpayload-Details.
2. Verlangt die **explizite** Methode `flighttask_execute`. Ein fehlendes
   Methodenfeld mag im generischen Parser optional sein, ist hier aber
   **nicht korrelierbar**.
3. Akzeptiert `data:{result:int}` oder
   `data:{result:int,output:null}`. `data:{result:{code:int}}`,
   `data.status`, zusätzliche Felder und nichtleeres `output` werden
   **nicht als bestätigter flighttask_execute-Contract** übernommen.
4. Prüft RFC-4122-artige UUIDs für `tid` und `bid`,
   `gatewaySn`, Zeitfenster und die bekannte Request-Methode via
   `correlateServiceReply`.
5. Wendet erst danach `advanceFlighttaskObservation` an. **Das
   generische `reply.terminal` oder `correlation.success` wird
   niemals als Missionsabschluss interpretiert.**

`observeFlighttaskProgressEvent` prüft eingehende Offline-Events über den
vorhandenen, redigierenden `parseFlighttaskProgressEvent` und den reinen
Beobachtungsreducer. Die Event-`tid`/`bid` sind von den
Service-Transaktionskennungen unabhängig. Pflichtkriterien sind
`gatewaySn`, `flight_id`, Zeitfenster und ein zuvor korreliertes,
akzeptiertes `services_reply`.

Ergebnisgrenzen: `reported_ok` bedeutet **nur: vom Gerät gemeldet**.
`operationVerified`, `hardwareVerified` und `flightReady`
bleiben ausdrücklich `false`. Kein angenommener Timeout-Fehlschlag.

## Ausführen

```sh
node --check backend/dji-service-reply-contract.js
node --check backend/dji-flighttask-reply-adapter.js
node --test backend/test/dji-service-reply-contract.test.js \
  backend/test/dji-flighttask-observation.test.js \
  backend/test/dji-flighttask-reply-adapter.test.js
node --test backend/test/*.test.js
```

Alle Fixtures sind erfunden und dürfen nicht gegen reale Piloten oder
DJI-Drohnen abgespielt werden. Insbesondere werden mit den Dateien
keine `services`-, `events_reply`-, `drc`- oder sonstigen DJI-
Nachrichten versendet.

## Nicht Bestandteil / noch offen

- **Update 24.10.2026:** Der isolierte, nicht in den Server eingebundene CAS-/Reconnect-Prototyp ist mit [PR #83](https://github.com/mason82-dotcom/SkyHub-Next/pull/83) in `main`. Er hat noch **keine produktive Migration oder Live-Integration**. Die inzwischen ergänzte [isolierte Workspace-Hülle](dji-flighttask-journal-access.md) und das [experimentelle Multi-Missions-Routing](dji-flighttask-multimission-router.md) sind **keine produktiv angebundene API und kein geprüfter Identity Provider**.
- Keine geklärte produktive Autorisierungs-, Berechtigungs-, ACL- oder
  Gerätebindung für aktive DJI-Kommandos.
- Für `need_reply=1`-Events fehlt eine getrennte, sichere
  `events_reply`-Implementierung; dieser Branch sendet **keine** ACKs.
- Die strenge `gateway`-Zuordnung muss anhand echter dokumentierter
  Geräte-/Firmware-Topologie geprüft werden. Unbekannte RC-Plus-2-Events
  werden nicht durch geratenen Aircraft-/Gateway-Wert freigegeben.
- Eine echte Flugmissionsabnahme erfordert Gerät, Firmware, kontrollierte
  Laborbedingungen, Berechtigungen und gesonderte Freigabe.

**Keine Änderungen an `backend/server.js`, EMQX, MQTT-ACLs, Pi,
Docker Compose, PostGIS, Redis, Caddy oder SkyHub-Laufzeitdiensten.**
