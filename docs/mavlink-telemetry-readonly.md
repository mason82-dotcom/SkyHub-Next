# P2.0 – Passiver DJI-OSD-zu-MAVLink-2-Encoder (RosettaDrone-Referenz)

**Status:** isolierter Quellcode + synthetische Tests, **nicht** in den
SkyHub-Betrieb eingebunden. Kein Pi-Deployment, keine MAVLink-UDP-Sockets,
keine DJI-Kommandos. RosettaDrone ist eine Android/SDK4-zu-MAVLink-Brücke;
dieser Node.js-Entwurf verwendet ausschließlich bestehende SkyHub-Registry-DTOs.
Kein RosettaDrone-Quellcode oder DJI-SDK-Code wurde kopiert.

## Dateien

- `backend/mavlink-telemetry-readonly.js` – synchroner, rein lesender Encoder.
- `backend/test/mavlink-telemetry-readonly.test.js` – offline Node-Testfälle.
- Keine Änderung an `backend/server.js`, `backend/mqtt-ingest.js`,
  `docker-compose*.yml`, Mosquitto, Caddy oder Geräten.

## Eingangsvertrag

Die Funktion `projectMavlinkTelemetry(device,options)` erwartet ein **bereits
vertrauenswürdig ausgewähltes** `safeDevice()`-ähnliches Registry-Snapshot.
Die Funktion ist selbst kein Authentifizierungsdienst. Der Aufrufer muss
`trustedDeviceSn` und `expectedGatewaySn` aus autorisierter Topologie liefern.
Aus MQTT-Nutzdaten dürfen diese IDs niemals als Vertrauensbeleg abgeleitet
werden. Ein echter Runtime-Adapter bedarf einer separaten Autorisierung.

Der Encoder akzeptiert nur `role=subdevice`, exakt getypte Mavic 3M (`0:77:2`)
oder Matrice 4T (`0:99:1`), bestätigte und nicht restaurierte Topologie,
`aircraftConnected=true`, bestätigte Online-/Telemetry-Zeitprovenienz und
höchstens 5 Sekunden alte Eingangsdaten. Einzelwerte benötigen eigene
Quellzeit mit `telemetryFieldTimeVerified=true`; zusammengehörige
Pitch/Roll/Heading-Proben dürfen höchstens 500 ms auseinander liegen.
Fehlende, unechte, verspätete oder unverifizierte Felder werden ausgelassen.

Die callerseitige `uptimeMs` muss die tatsächliche monotone Zeit seit Start
des (zukünftigen) MAVLink-Exports repräsentieren, nicht Unix-Epochenzeit.
`sequence` ist ein 8-Bit-Zähler; `systemId` ist explizit im Bereich 200–239.
System-IDs für mehrere Drohnen müssen vom späteren Aufrufer kollisionsfrei
vergeben werden.

## Ausgegebene MAVLink-2-Nachrichten

| MAVLink ID | Typ | Inhalt / absichtliche Grenze |
| --- | --- | --- |
| `0` | `HEARTBEAT` | Companion (`MAV_TYPE_ONBOARD_CONTROLLER=18`, `MAV_AUTOPILOT_INVALID=8`, `component_id=191`), keine Armed-/Guided-/Flight-ready-Behauptung |
| `30` | `ATTITUDE` | Roll/Pitch/Yaw aus frischen, verifizierten DJI-OSD-Winkeln; nicht gelieferte Winkelgeschwindigkeiten als NaN, niemals als erfundene Null |
| `251` | `NAMED_VALUE_FLOAT` | `DJI_TKOFF`: Höhe relativ zum DJI-Startpunkt in m; `DJI_BATT`: Akkustand in %; nur bei Feld-Provenienz |

Alle Frames nutzen MAVLink 2 und CRC-16/MCRF4XX mit den passenden
`CRC_EXTRA`-Bytes. Der Encoder kann **keine** beliebigen MAVLink-Kommandos
und enthält weder UDP-Ein-/Ausgang noch MQTT-Client.

**Wichtig:** SkyHubs `height` ist Ellipsoidhöhe, `elevation` ist Höhe
relativ zum Startpunkt. MAVLink `GLOBAL_POSITION_INT.alt` erwartet dagegen
Höhe über Mean Sea Level (MSL), `relative_alt` relativ zum Home-Punkt.
Ohne nachgewiesene Transformation/Referenz kann der Adapter keine
korrekten Positionsdaten als `GLOBAL_POSITION_INT` ausgeben. Deshalb ist
die Nachricht in P2.0 absichtlich **nicht implementiert**. Positionen in
QGroundControl sind dadurch noch **nicht** als funktionsfähig abgenommen.

Das HEARTBEAT einer Begleitkomponente ist **kein** Ersatz für einen
echten MAVLink-Autopiloten und garantiert keine Fahrzeugdarstellung in QGC.
Dies verhindert bewusst eine irreführende Steueroberfläche.

## Tests und Freigabegrenzen

```bash
node --test backend/test/mavlink-telemetry-readonly.test.js
```

Akzeptanz: CRC und Frame-Felder, beide Geräte-Typen, Sequenzüberlauf,
Quellzeit und Einzelwert-Frische, Disconnect (DJI mode_code=14),
Gateway-Spoofing, falsche Modellgruppen, Datenlücken und MSL-Fehlabbildung.
Ergebnisse enthalten stets `flightReady=false`, `hardwareVerified=false`,
`publisherEnabled=false`, `mqttUsed=false`, `udpSent=false` und
`commandCapable=false`. Kein Test ist eine echte Flugabnahme.

## Nächste kontrollierte Schritte

1. P2.1: unabhängiger MAVLink-Decoder als Vergleichsprüfer (goldene
   Vektoren/CRC). Offline-Tests für Zeitstempel, Rate Limits und Mix.
2. P2.2: optionale *nur ausgehende* UDP-Übertragung, die nicht einmal
   einen UDP-Receive-Handler registriert; lokale Loopback-ACL zuerst.
3. P2.3: unabhängige, datumskorrekte MSL/Geoid-Umrechnung und
   Home-Referenznachweis, bevor `GLOBAL_POSITION_INT` erwogen wird.
4. P2.4: echte QGroundControl-Anzeige getrennt von Flug-/Hardwareabnahme.

## Referenzen

- https://github.com/RosettaDrone/rosettadrone
- https://mavlink.io/en/messages/common.html
- https://mavlink.io/en/guide/serialization.html
- https://github.com/mason82-dotcom/SkyHub-Next/blob/main/backend/catalog.js


## P2.1 – Independent MAVLink 2 verification and opt-in loopback lab (06.11.2026)

**Stacked development:** requires the P2.0 offline encoder. None of the
modules below are imported by SkyHub's production `server.js` or `mqtt-ingest.js`.
No Pi, DJI controller, MQTT broker, Docker configuration or flight function
has been modified. A green unit test proves framing and loopback transfer
only; it is **not** a QGroundControl or aircraft acceptance test.

### Independent passive frame verifier

`backend/mavlink-passive-frame-audit.js` independently inspects fixed MAVLink 2
frames without importing the P2.0 encoder. It uses a bit-at-a-time
CRC-16/MCRF4XX algorithm with pinned `CRC_EXTRA` values for IDs 0, 30 and
251. It checks version, payload length, incompatible flags, system ID,
companion component ID and exact message allowlist. The heartbeat must
continue to advertise MAV_TYPE_ONBOARD_CONTROLLER=18,
MAV_AUTOPILOT_INVALID=8, no armed/guided mode, and MAV_STATE_UNINIT.
The attitude carries radians with unknown angular rates encoded as NaN.
Named values are strictly restricted to DJI_TKOFF and DJI_BATT.

Batch checks also require contiguous sequence values (modulo 256),
one companion heartbeat, consistent system ID, monotonically ordered
optional messages, identical boot-time timestamps on measured fields, and
a verified `generatedAt` time no older than **1 second**.
CRC-validated but forged command or autopilot message types are rejected.
No IDs, device secrets, GNSS coordinates or raw MAVLink payload are
returned by the structural report.

### Outbound-only loopback lab (P2.2 preparation)

`backend/mavlink-loopback-lab.js` creates NO socket in its constructor;
`sendBatch` is an explicit action and is **disabled by default**.
The only allowed destination is literal `127.0.0.1`, with an explicitly
configured, non-privileged UDP port. Hostnames, non-loopback and IPv6
destinations are rejected. Prior to sending, the lab clones all frames and
runs the independent passive batch validator (including 1-second age gate).
One session enforces at least **1000 ms** between batches and monotonically
advancing sequence numbers. The sender has NO UDP message receiver,
command parser, MAVLink dispatcher, HTTP endpoint, DJI SDK or MQTT client.
Only an error listener is registered. A successful UDP send only proves
the local kernel accepted the datagram, not that QGroundControl received it.

The 1000-ms throttle is scoped to a **single lab instance**, not a
global or distributed rate limit. This lab must not be enabled as a
persistent service, routed to the LAN or integrated with real devices
without a separate security and capability review.

**QGroundControl boundary:** QGC typically recognizes only vehicle
heartbeats as vehicles, not onboard-computer heartbeats. Consequently
the existing P2.0 companion identity will likely NOT create a vehicle
entry in QGC; this is intentional. Do not falsely present SkyHub as an
ArduPilot flight controller to achieve a UI icon.

Run all checks offline or in isolated CI (loopback UDP is used by the
lab-only Node test, never by the SkyHub runtime):

```bash
node --test \
  backend/test/mavlink-telemetry-readonly.test.js \
  backend/test/mavlink-passive-frame-audit.test.js \
  backend/test/mavlink-loopback-lab.test.js
```

Next independent gate: P2.3 geoid/MSL and home-reference evidence before
considering GLOBAL_POSITION_INT; maintain the no-command rule and
explicit UI limitations for any later QGroundControl visualization.

References: [MAVLink wire protocol](https://mavlink.io/en/guide/serialization.html),
[MAVLink heartbeat and QGC component detection](https://mavlink.io/en/services/heartbeat.html).
