# DJI Flight Areas – passiver Ereignisadapter (Offline-Labor)

**Stand:** 24.10.2026 · **Geltungsbereich:** isolierter Testcode, **nicht in die
SkyHub-Laufzeit eingebunden** · Referenz: DJI Cloud API / Java SDK Flight Areas
(ältere DJI-Demo; **keine** gerätespezifische 1.18-Hardwareabnahme).

## Umsetzung und bewusste Nicht-Funktionen

`backend/dji-flight-area-events.js` exportiert
`inspectFlightAreaEvent({topic,payload,packet,expectedGatewaySn,now})`.
Der Baustein verarbeitet ausschließlich empfangene, nicht-retained Nachrichten
aus `thing/product/{gatewaySn}/events`. Er kennt **keinen** MQTT-Client,
keine Abonnements, keinen Publisher, keine REST-Route, keine Datenbank,
keinen Gerätebefehl und keinen Browser-Event-Stream. **`backend/server.js`,
`docker-compose.yml`, Pi-Broker, Gerätezugänge und Frontend bleiben unverändert.**

Die folgenden DJI-Ereignisse sind passiv modelliert:

| DJI-Methode | Whitelist | Ergebnis |
| --- | --- | --- |
| `flight_areas_sync_progress` | `status`: `wait_sync`, `switch_fail`, `synchronizing`, `synchronized`, `fail`; `reason`: Integer 0–13; optionaler SHA-256-Dateiverweis nur strukturell geprüft | `kind=sync_progress`, Status, Fehlercode, boolesche Kennzeichen |
| `flight_areas_drone_location` | Maximal 64 `drone_locations` mit `area_id`, `area_distance` und `is_in_area` | `kind=drone_location`, begrenzte normalisierte Liste |

**Wichtig:** `synchronized` plus Fehlercode 0 wird allein als
`deviceReportedSynchronized=true` ausgegeben. Die übrigen Ausgaben bleiben
`syncVerified=false`, `flightReady=false` und
`hardwareVerified=false`. Der DJI-Status attestiert weder die von SkyHub
gewünschte Dateirevision noch einen geprüften Missionsfreigabepfad.

## Vertrauensgrenzen

1. `expectedGatewaySn` **muss von einer eigenständigen authentifizierten
   Workspace- und Gerätebindung kommen** – niemals aus dem MQTT-JSON,
   Browserparametern oder einem selbstgewählten `gateway`-Feld.
   Der Inspector vergleicht exakten Topic-SN, erwartete SN und
   MQTT-Envelope-`gateway`. **Er authentifiziert nicht selbst.**
2. Retained-Nachrichten, fehlende/ungültige Zeitstempel, Nachrichten älter als
   300 Sekunden oder mehr als 30 Sekunden aus der Zukunft werden abgewiesen.
   Die Zeitgrenzen verwenden den bestehenden `message-guard.js`.
3. MQTT-Bytes sind auf 32 KiB, Einträge auf 64 und Gebiet-IDs auf 128
   Zeichen begrenzt. Falsche Datentypen, unbekannte DJI-Methoden,
   doppelte Gebiet-IDs, nicht endliche und negative Distanzen führen zu
   einer vollständigen Ablehnung; es gibt keinen partiell akzeptierten Batch.
4. Rohpakete, Signed URLs, Dateinamen, SHA-256-Werte, Zugangsdaten und
   unbekannte DJI-Felder werden nicht zurückgegeben. Ablehnungsgründe
   bestehen ausschließlich aus festen Statuscodes, nicht aus Exception-Texten.
5. Ein Ereignis kann `need_reply` enthalten; der Inspector stellt **keine**
   MQTT-Antwort bereit. Das Modul darf nicht zur fälschlichen Bestätigung
   eines `flight_areas_get`-Requests verwendet werden.

Die strukturierte Fluggebietsdatei `flight_areas_get` verwendet die separate
`thing/product/{gatewaySn}/requests`-Protokollfamilie. Diese wird durch die
vorliegende Änderung **nicht** abonniert, geparst oder beantwortet.
Ebenso gibt es **keine** `flight_areas_update`-Auslösung.

## Status zu Pilot 2 und Hardware

| Konfiguration | Dieses Modul | Weiterhin nicht freigegeben |
| --- | --- | --- |
| RC Pro Enterprise + Mavic 3M | Offline-Test der Datenform möglich | Übertragung von Fluggebieten, automatischer Flug, DRC |
| RC Plus 2 + Matrice 4T | Offline-Test der Datenform möglich | Übertragung von Fluggebieten, gerätespezifische 1.18-Abnahme |
| DJI Dock / Dock 2 | Ereignisformen aus dem Java-Demo-SDK | Realer Ereignisempfang, Bindung, Dateiabgleich, Rollout |
| DJI Dock 3 | Nur theoretischer Vergleich | Dock-3-spezifische Cloud-API-Vertrags-/Hardwareprüfung |

Der bestehende Map-Elements-Adapter ist ein **anderer** Vertrag:
`/map/api/v1/workspaces/{workspace_id}/element-groups` sind
Kartenobjekte; Flight Areas sind benutzerdefinierte Einsatz- oder
Ausschlussgebiete. Ein Map-Polygon ist **weder** automatisch eine aktivierte
DJI-Gebietsdatei **noch** eine luftrechtliche Erlaubnis.

## Verifikation und weitere Integrations-Gates

Lokal/CI (Node.js 22):

```sh
node --check backend/dji-flight-area-events.js
node --test backend/test/dji-flight-area-events.test.js
```

Die vorhandene GitHub-CI führt `backend/test/*.test.js` automatisch aus.
Bevor ein späterer Adapter zur Laufzeit integriert werden darf, fehlen:
authentifizierte Workspace-/Gateway-Zuordnung; nachgewiesene DJI-Modell-
und Firmware-Kompatibilität; getrennte Replay-/Deduplizierungszustände;
persistierte Zielrevisions- und SHA-256-Zuordnung; Ereignis-/Audit-
Retention; autorisierte gerätebezogene Statusausgabe; betriebssichere
Antwortlogik für `need_reply`; Feldtests an realer Hardware.
**Auch nach positiven Offline-Tests erfolgt kein automatisches Deployment.**

## Quellreferenzen

- [Offizielles DJI-Java-SDK: AbstractFlightAreaService](https://github.com/dji-sdk/DJI-Cloud-API-Demo/blob/main/cloud-sdk/src/main/java/com/dji/sdk/cloudapi/flightarea/api/AbstractFlightAreaService.java)
- [FlightAreasSyncProgress](https://github.com/dji-sdk/DJI-Cloud-API-Demo/blob/main/cloud-sdk/src/main/java/com/dji/sdk/cloudapi/flightarea/FlightAreasSyncProgress.java)
- [FlightAreasDroneLocation](https://github.com/dji-sdk/DJI-Cloud-API-Demo/blob/main/cloud-sdk/src/main/java/com/dji/sdk/cloudapi/flightarea/FlightAreasDroneLocation.java)
- [FlightAreaSyncReasonEnum](https://github.com/dji-sdk/DJI-Cloud-API-Demo/blob/main/cloud-sdk/src/main/java/com/dji/sdk/cloudapi/flightarea/FlightAreaSyncReasonEnum.java)
- [Vergleichs-UI (kein direkter Laufzeitimport)](https://github.com/cowherds/DJI-Cloud-API-Web/tree/main/src/components/flight-area)
- [SkyHub Integrationsstrategie](integration-priorities-2026-10-23.md)
