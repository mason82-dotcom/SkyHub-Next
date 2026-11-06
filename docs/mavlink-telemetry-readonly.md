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
