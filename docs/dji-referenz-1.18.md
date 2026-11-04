# DJI-Referenz für die Weiterentwicklung (DJI Cloud API 1.18)

**Festgelegt am 04.11.2026 durch den Projektinhaber.** Diese Seiten von developer.dji.com sind die verbindliche Referenz für
Protokoll, Felder, Wertebereiche und Abläufe in SkyHub Next. Bei Abweichungen gilt die Live-Seite; das Demo-SDK in
`third_party/dji-cloud-api-demo` ist für Pilot-Funktionen **älter** als 1.18 (es schließt z. B. die Pilot-Live-Steuerung noch aus)
und nur ergänzend zu benutzen.

Basis: `https://developer.dji.com/doc/cloud-api-tutorial/en/` (im Folgenden `…/`). Die Seiten sind eine Single-Page-App; ihr Text
steckt in `…/../assets/js/v-<id>.<hash>.js`, die Zuordnung Seite → Datei steht in `app.*.js` und `runtime~app.*.js`.

| Bereich | Seite | Wofür in SkyHub | Abgleich 04.11.2026 |
|---|---|---|---|
| Architektur | [overview/product-architecture](https://developer.dji.com/doc/cloud-api-tutorial/en/overview/product-architecture.html) | Rollen: SkyHub = Third-party Cloud (MQTT-Gateway, HTTPS, WebSocket, Objektspeicher), Pilot 2 = Gateway | Grundmodell bestätigt |
| WPML | [dji-wpml/overview](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/overview.html) | KMZ-Aufbau, `waylines.wpml` = Ausführung | bestätigt; Namensregel im Speicher umgesetzt |
| WPML | [dji-wpml/template-kml](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/template-kml.html) | `takeOffRefPoint`, Höhenmodi, Vorlagenarten | `realTimeFollowSurface` nur Kartierung, M3E/M3T/M3M → `mission-envelope.js` |
| WPML | [dji-wpml/waylines-wpml](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/waylines-wpml.html) | Flughülle der Freigabe | Pflichtfelder, Bereiche ([1,2; 1500] m, [0; 15] m/s), Aufzählungen übernommen |
| WPML | [dji-wpml/common-element](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/common-element.html) | `droneEnumValue`/`payloadEnumValue` | M3M = 77-2 / Kamera 68 (frühere Fassung; aktuelle Produkttabelle führt M3M nicht) |
| Wayline | [feature-set/pilot-feature-set/pilot-wayline-management](https://developer.dji.com/doc/cloud-api-tutorial/en/feature-set/pilot-feature-set/pilot-wayline-management.html) | Pilot-2-Bibliothek | alle 6 Schnittstellen vorhanden; jetzt nur freigegebene Routen |
| Wayline | [feature-set/dock-feature-set/dock-wayline-management](https://developer.dji.com/doc/cloud-api-tutorial/en/feature-set/dock-feature-set/dock-wayline-management.html) | Flugaufträge `flighttask_*` | nur Dock; keine Dock-Hardware vor Ort |
| Live-Steuerung | [feature-set/pilot-feature-set/drc](https://developer.dji.com/doc/cloud-api-tutorial/en/feature-set/pilot-feature-set/drc.html) | Cloud-Steuerung über Pilot 2 | Matrice 4: Flug + Nutzlast; M3E-Serie: nur Nutzlast → `drc-*.js` |
| Lageübersicht | [feature-set/pilot-feature-set/pilot-situation-awareness](https://developer.dji.com/doc/cloud-api-tutorial/en/feature-set/pilot-feature-set/pilot-situation-awareness.html) | TSA (`tsa-hub.js`) | Ablauf bestätigt |
| Lageübersicht | [https/situation-awareness/obtain-device-topology-list](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/https/situation-awareness/obtain-device-topology-list.html) | `GET …/devices/topologies` | Felder stimmen (`tsa-contract.js`) |
| Kartenelemente | [feature-set/pilot-feature-set/pilot-map-elements](https://developer.dji.com/doc/cloud-api-tutorial/en/feature-set/pilot-feature-set/pilot-map-elements.html) | Kartenebenen mit Pilot 2 teilen | **nur Liste angebunden**; Anlegen/Ändern/Löschen und WebSocket fehlen |
| MQTT | [pilot-to-cloud/mqtt/topic-definition](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/topic-definition.html) | Topics, Hüllen, `need_reply` | `events_reply` für DRC-Ereignisse ergänzt; `osd`/`state` an `{device_sn}` |
| Fluggerät | [mqtt/m3-series/properties](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/m3-series/properties.html) | Mavic 3E/3T/3M | `height` (Ellipsoid), `elevation`, `home_*`, `mode_code` wie M4 |
| Fluggerät | [mqtt/others/aircraft/properties](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/others/aircraft/properties.html) | übrige Fluggeräte | gleiche Höhen- und Zustandsfelder |
| RC Pro | [mqtt/rc-pro/properties](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/rc-pro/properties.html) | RC Pro (Mavic 3E-Serie) | `cloud_control_auth`, `drc_state` vorhanden |
| RC Pro | [mqtt/rc-pro/device](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/rc-pro/device.html) | Topologie | nur `update_topo` |
| RC Pro | [mqtt/rc-pro/drc](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/rc-pro/drc.html) | Live-Steuerung RC Pro | nur Autorisierung, DRC-Modus, Kamera/Gimbal – **keine Flugbefehle** |
| RC Pro | [mqtt/rc-pro/remote-control](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/rc-pro/remote-control.html) | Fernsteuerung RC Pro | nur Zustandsmeldungen, kein Knüppel/Not-Stopp |
| RC Pro | [mqtt/rc-pro/live](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/rc-pro/live.html) | Livevideo | `live_start_push` usw.; SkyHub nutzt bisher nur manuell gestartetes Video |
| andere RC | [mqtt/others/rc/properties](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/others/rc/properties.html) | übrige RCs | `cloud_control_auth`, **kein** `drc_state` |
| andere RC | [mqtt/others/rc/device](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/others/rc/device.html) | `update_topo` | Felder = Simulator (`drc-rc-simulator.js`) |
| Pilot 2 H5 | [pilot-to-cloud/jsbridge](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/jsbridge.html) | Pilot-2-Webview (`pilot-login.html`) | als Referenz aufgenommen, Abgleich offen |
| Debug | [debug/mqttx](https://developer.dji.com/doc/cloud-api-tutorial/en/debug/mqttx.html) und [mqttx.app/docs](https://mqttx.app/docs) | Mitlesen am Broker | `docs/drc-matrice4.md` (MQTTX, nur lesend) |

Zusätzlich für die Matrice-4-Steuerung herangezogen (Gegenstück der RC Plus 2):
[mqtt/dji-rc-plus-2/drc](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/dji-rc-plus-2/drc.html),
[mqtt/dji-rc-plus-2/remote-control](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/dji-rc-plus-2/remote-control.html),
[mqtt/dji-rc-plus-2/live](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/dji-rc-plus-2/live.html),
[mqtt/m4-series/properties](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/m4-series/properties.html),
[overview/product-support](https://developer.dji.com/doc/cloud-api-tutorial/en/overview/product-support.html).

## Regeln für die Weiterentwicklung
1. Neue Protokollteile zuerst gegen die passende Seite oben abgleichen; Quelle (Seite, Feld) im Code-Kommentar nennen.
2. Wertebereiche und Pflichtfelder der Seite übernehmen, nicht schätzen. Fehlt eine Angabe, ausdrücklich als Annahme kennzeichnen.
3. Für RC Plus 2/Matrice 4 und RC Pro/Mavic 3E-Serie jeweils die gerätespezifische Seite nehmen; „others“ gilt nur für übrige Geräte.
4. Diese Liste bei jeder neu herangezogenen Seite ergänzen.
