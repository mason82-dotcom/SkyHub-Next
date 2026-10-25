# Architektur und Datenmodell – SkyHub Next

**Geltungsbereich:** Aktiver Entwicklungsstand im Repository-Root (Version 0.1.0), nicht der archivierte Stack.

## Komponenten

- `backend/server.js`: Node.js-/Express-Server, API, Socket.IO und MQTT-Verarbeitung.
- `backend/dji.js`, `backend/registry.js`, `backend/message-guard.js`, `backend/mqtt-shape.js`: DJI-Topic-Parsing, Zustandsverwaltung und Eingangsvalidierung.
- `backend/pilot-config.js`, `backend/pilot-pairing.js`, `backend/topology-ack.js`: Pilot-2-Anbindung und optionaler begrenzter Topologie-Antwortkanal.
- `backend/track-store.js`, `backend/db/schema.sql`: Speicherung von Flugspuren in PostGIS.
- `frontend/public/`: statisches Dashboard und Pilot-2-Seiten ohne Frontend-Build. Der alte unverbundene React-Platzhalter `frontend/src/App.jsx` wurde im Cleanup entfernt.
- `scripts/`: Pi-Diagnose-, Staging-, Sicherungs- und Betriebswerkzeuge.
- `stacks/legacy-skyhub/`: historischer Quelltext-/Konfigurations-Snapshot, **kein** alternativer Startpfad.

SkyHub Next nutzt den vorhandenen MQTT-Broker (Pi-Hostport 1884), einen separaten Redis-/PostGIS-Stack und optional MinIO im Compose-Profil `media`. MQTT-Verbindung, empfangene Topics, verwertbare OSD-Messwerte und validierte Positionen sind **verschiedene** Zustände; sie dürfen in der UI nicht gleichgesetzt werden.

**Vertiefung:** [MQTT/OSD-Integration](mqtt-osd-integration.md), [DJI-API-Kompatibilität](dji-cloud-api-compatibility.md), [Sicherheit](security.md).

## Aktueller Funktionsumfang und Grenzen

OSD-Nachrichten lesen und geographische Punkte anzeigen; Status-/Event-Kanäle als beobachtete Quellen behandeln, ohne aktive Flüge zu steuern. Persistenz der GPS-Telemetrie in PostGIS sowie Redis-Cache. MQTT-Broker muss passend für DJI Pilot 2 konfiguriert sein. Grundlegende Gateway-/Subgerätezuordnung ist vorhanden; dauerhafter Geräte-Online-Status und zuverlässige Modellzuordnung aus allen Firmwarevarianten sind noch nicht abschließend validiert. Der Online-Status bezeichnet ausschließlich MQTT-Brokerkonnektivität, **nicht** den Gerätezustand.

Das Frontend benötigt Leaflet/OpenStreetMap über CDN und Internetzugang. MinIO ist eine isolierte Speichergrundlage für zukünftige Medien; eine Medien-API gibt es noch nicht. Die vorhandenen M3E-/M3T-/M3M-Python-Worker sind Demonstrationscode und dürfen nicht als reale Messergebnisse verwendet werden. WPML-Missionseditor, Radiometrie und Photogrammetrie stehen noch aus.

DJI Cloud API Dokumentation:
- https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/rc-plus/properties.html
- https://github.com/dji-sdk/Cloud-API-Doc

## Live-API

- GET /api/health – Brokerstatus ohne Token
- GET /api/devices – authentifiziert; aktuelle Geräte und Telemetrie
- GET /api/events – authentifiziert; die letzten Ereignisse (höchstens 100). Periodische Wiederholungen von `hms` und `airsense_warning` sind keine Ereignisse, sondern Zustand: ein Ereignis entsteht nur, wenn sich die Menge der HMS-Meldungen ändert oder die AirSense-Warnstufe wechselt
- GET /api/drone/:sn/telemetry – authentifiziert; eine Gerätekennung
- Socket.IO: snapshot, device_update, device_event – authentifiziert mit auth.token

## Positionsintegrität

Feldgenaue DJI-OSD-Zeitstempel (`telemetryFieldAt` und
`telemetryFieldTimeVerified`) bleiben im Live-Registry-Snapshot und in
authentifizierten API-/WebSocket-Antworten. `deviceCachePayload` schließt die
beiden Karten vor dem bestehenden Redis-Gerätecache explizit aus.
Ein unvollständiges GPS-only-Paket oder ausschließlich unbekannte/ungültige
Felder erzeugen keine vorgetäuschte OSD-Datenfrische. Kein weiterer
PostGIS-Schreibpfad wird aktiviert.

Ein GPS-Punkt wird ausschließlich gebildet, wenn `latitude` und `longitude` im **selben** empfangenen DJI-OSD-Paket gültig vorliegen. Fehlende Koordinaten werden nicht aus späteren Paketen ergänzt; ein früheres gültiges Koordinatenpaar bleibt als zuletzt bekannte Position erhalten. `lastPositionAt` und `positionFresh` beziehen sich nur auf vollständige GPS-Paare und sind unabhängig von `lastTelemetryAt` und `fresh` für sonstige OSD-Telemetrie. Alte Positionsmarker werden in der Karte grau dargestellt, inklusive Altersanzeige; aus einem noch aktuellen Akkustand oder Flugmodus folgt keine aktuelle GPS-Position.

`positionFresh` besagt nur, dass beide numerisch plausiblen Koordinaten kürzlich zusammen empfangen wurden. Es ist **kein** Nachweis eines GNSS-/RTK-Fix, einer bestimmten Positionsgenauigkeit oder einer plausiblen Einsatzposition. Auch ein Paar `(0, 0)` bleibt daher als gemeldeter Gerätewert erhalten und wird nicht als bestätigter Standort interpretiert.

Die Änderung ist auf dem separaten Branch `develop/skyhub-next-position-integrity-v2` isoliert, ohne Port- oder Brokeränderung. Zusätzliche Tests: `node --test backend/test/position-integrity.test.js`.

## MQTT-Nachrichtenintegrität

Der rein lesende Empfangspfad prüft das DJI-Nachrichtenformat und den optionalen
Quellzeitstempel (Unix-Millisekunden). MQTT-Pakete mit `retain=true` werden
grundsätzlich verworfen. Bei **vorhandenem** Quellzeitstempel gelten folgende
Eingangsfenster: OSD höchstens 120 Sekunden alt, andere Kanäle höchstens
300 Sekunden alt; maximal 30 Sekunden Zukunftstoleranz. Ein verworfenes Paket
aktualisiert weder Telemetrie noch Geräte-Topologie.

Die bestehende Registry verwirft doppelte oder rückwärts laufende Quellzeitstempel
pro Gerät und Kanal. Nach einem zeitgestempelten Kanalpaket wird ein späteres
Paket desselben Kanals **ohne** Zeitstempel nicht mehr übernommen. Nachrichten,
die von Beginn an ohne Zeitstempel eintreffen, bleiben aus
Kompatibilitätsgründen zulässig, werden jedoch als zeitlich ungeprüft gekennzeichnet
(`telemetryTimeVerified=false`, `positionTimeVerified=false`).
Das ist **kein vollständiger Replay-Schutz** für zeitstempellose Pakete.

`lastTelemetryAt` und `lastPositionAt` beruhen bei verifizierbarem Quellzeitstempel
auf der DJI-Quellzeit (nicht auf der verspäteten Empfangszeit).
Die Kartenmarkierung wird nur bei frischer, zeitlich verifizierter GPS-Position
blau dargestellt; sonst grau. Die sichtbare Frische bedeutet weiterhin **nicht**
GNSS-/RTK-Genauigkeit oder eine bestätigte Flugposition.

Die Health-API enthält zusätzlich `mqttTimestampUnverifiedMessages` und
`mqttDroppedByReason` (z. B. `retained`, `stale`, `future`, `duplicate`).
Abweisungen werden ohne MQTT-Rohdaten und ohne Gerätekennungen protokolliert.
`mqttLastTelemetryAt` in den aggregierten MQTT-Metriken bezeichnet den
**Eingangszeitpunkt** eines verwertbaren OSD-Messwerts; die einzelne
`lastTelemetryAt`-Zeit der Registry den Quellzeitpunkt, sofern bekannt.

`lastTopologyAt` und `topologyTimeVerified` werden getrennt für
Fernsteuerung und Subgeräte geführt. `topologyOnline` bedeutet ausschließlich
**zuletzt in einer update_topo-Meldung als verbunden gemeldet**, nicht
"jetzt nachweislich online". Die Topologie wird durch die MQTT-Verbindung
oder fehlende Statusänderungen nicht automatisch aufgefrischt.

Voraussetzung für die Zeitfenster ist eine korrekt synchronisierte Pi-Systemuhr
(NTP). Replay-Schutz anhand von Zeitstempeln ersetzt weder authentifiziertes
MQTT, Broker-ACLs noch eine vollständige DJI-Protokollvalidierung. Keine
Produktivdienste werden durch Git-Branchwechsel oder Unit-Tests gestartet.

Neue Tests: `node --test backend/test/message-guard.test.js backend/test/topology-time.test.js`.
Für alle Regressionstests: `node --test backend/test/*.test.js`.

## DJI Cloud API 1.18: optionale Topologie-Bestätigung

Dieser Branch ergänzt ausschließlich den DJI-Pilot-to-Cloud-Antwortkanal
`sys/product/{gateway_sn}/status_reply` für gültige `update_topo`-Nachrichten.
Er ist **standardmäßig deaktiviert** (`SKYHUB_TOPOLOGY_ACK_ENABLED=false`).
Der bisherige, schreibgeschützte DJI-MQTT-Subscriber und seine ACL bleiben unverändert.

Die Bestätigung wird ausschließlich nach erfolgreicher MQTT-Nachrichtenprüfung
und Übernahme in die Geräte-Registry erzeugt. `tid` und `bid` stammen aus
der geprüften Eingangsnachricht; `data.result` ist `0`.
Unbekannte Methoden, ungültige UUIDs, fehlende Zeitstempel, alte/retained
Pakete und verworfene Registry-Nachrichten lösen keine Bestätigung aus.
Die Antwort enthält keine Gerätegeheimnisse aus den Topologiedaten.

Für einen produktiven Hardwaretest separat in EMQX anlegen:
- einen **dedizierten MQTT-Publisher**, der ausschließlich auf
  `sys/product/+/status_reply` veröffentlichen darf,
- keine Subscriber-/Pilot-Benutzerdaten für dieses Konto wiederverwenden,
- keine Rechte für `services`, `drc/down` oder `property/set` vergeben.

Erst nach ACL-Prüfung `SKYHUB_TOPOLOGY_ACK_MQTT_USER`,
`SKYHUB_TOPOLOGY_ACK_MQTT_PASSWORD` und
`SKYHUB_TOPOLOGY_ACK_ENABLED=true` in der lokalen, nicht versionierten
`.env` setzen und ausschließlich den Backend-Container neu erstellen.
Die Health-API enthält `topologyReplyEnabled`, `topologyReplyConnected`,
`topologyReplySent` und `topologyReplyErrors`.

**Nicht behauptet:** Eine erfolgreiche Topologiebestätigung beweist keine
DJI-MQTT-Session und garantiert keinen OSD-Datenfluss. OSD-Veröffentlichung,
Pilot-2-JSBridge und die Broker-ACL sind getrennt zu validieren.

Tests: `node --test backend/test/*.test.js`.

## Topologie über Neustarts

Rollen, Gateway-Zuordnung, Modelle und Kinder aus `update_topo` werden in Redis
(`skyhub:topology`, 7 Tage) vorgehalten und beim Start wiederhergestellt.
Telemetrie wird **nicht** gespeichert; nach einem Neustart ist nichts „frisch“,
bis echtes OSD eintrifft. Wiederhergestellte Einträge tragen
`topologyRestored: true` (Karte: „Topologie aus Speicher“) und werden von jedem
neueren `update_topo` ersetzt. Gespeicherte Daten werden vollständig validiert
und überschreiben nie eine neuere Live-Topologie. Der Replay-Schutz für
`update_topo` bleibt über Neustarts erhalten. Health: `topologyRestoredDevices`.

## HMS-Warnungen

SkyHub wertet DJI-HMS-Meldungen aus beiden Formaten aus: Pilot 2 sendet
`data:{event:"hms", method:"hms", output:{codes:[{id,level,component_index,sensor_index}]}}`
mit dezimaler ID (am 20.10.2026 an der Mavic 3M beobachtet), Docks
`method:"hms", data:{list:[{code:"0x…"}]}`. Jede Meldung ersetzt die Liste der
aktiven Warnungen des Geräts. Ohne neue Meldung gilt die Liste nach 30 s als
veraltet. Die Karte zeigt die Warnungen pro Gerät mit deutschem Text
(Fallback Englisch), die Kachel „Aktive HMS-Warnungen“ und einen roten bzw.
gelben Marker-Rand.

Texte: `backend/data/hms-texts.json`, erzeugt mit
`node scripts/build-hms-texts.js <hms.json>` aus der `hms.json` der DJI
Cloud-API-Demo (MIT, siehe `backend/data/HMS-LICENSE.txt`). Im Flug
(`mode_code` 3–12, 15–17) wird die `_in_the_sky`-Variante verwendet.

## Flugspur und Speicherung (PostGIS)

Validierte GPS-Punkte werden nur gespeichert, wenn sich das Gerät um ≥ 2 m
horizontal oder vertikal bewegt hat, sonst höchstens einmal pro Minute.
Punkte bei 0/0 (DJI ohne Positions-Fix) werden nie gespeichert; die
Live-Anzeige zeigt sie weiter wie gemeldet. Vorher wurde jedes OSD-Paket
geschrieben (am 20.10.2026 rund 170.000 Zeilen/Tag, die Hälfte bei 0/0).
Neue Spalten (`source_ts`, `time_verified`, Satelliten, RTK-Status) werden beim
Start ergänzt, ohne Daten zu löschen. Aufbewahrung: `SKYHUB_TRACK_RETENTION_DAYS`
(Standard 30), stündlich bereinigt. `GET /api/drone/:sn/track?minutes=60`
(1–1440, max. 5000 Punkte) liefert die Spur; die Karte zeigt sie (abschaltbar)
und zoomt ohne gültige Live-Position einmal darauf. Health:
`trackPointsStored`, `trackPointsSkipped`, `trackRetentionDays`.

## Ausgeschaltetes Fluggerät (mode_code 14)

Nach dem Ausschalten der Mavic 3M sendete Pilot 2 weiter sekündlich OSD für das
Fluggerät mit den zuletzt bekannten Werten und `mode_code = 14`
(„Not connected“). Solche Pakete aktualisieren weder Messwerte, Frische,
Position noch Flugspur; das Gerät erhält `aircraftConnected: false` und die
Karte zeigt „Fluggerät nicht verbunden“. Das nächste OSD mit anderem
`mode_code` hebt den Zustand auf.


## Integrationsnotiz PR #24 (23.10.2026)

Mit der Integration der Feature-Historie ändert sich der optionale Funktionsumfang: Nur bei aktivem `SKYHUB_MEDIA_ENABLED=true` ist eine authentifizierte, rein lesende MinIO-API vorhanden. Die S3-Objektinventur klassifiziert Dateinamen, die optionalen TIFF-Range- und XMP-Prüfer liefern anonymisierte Hinweise. Dies ist **kein** produktiver Medienupload und keine Freigabe von NDVI/NDRE, Reflexionskalibrierung oder Georeferenzierung. Der separate `backend/m3m-s3-read-contract.js` bleibt als expliziter, restriktiver List-only-Vertrag aus `main` erhalten. Kein Merge in GitHub startet Container oder DJI-Aktionen.
