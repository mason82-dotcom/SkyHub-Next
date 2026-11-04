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
| RC Pro | [mqtt/rc-pro/drc](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/rc-pro/drc.html) (Nutzlast) | Kamera/Gimbal Mavic 3E-Serie | 26 Methoden auf `services` (`camera_*`, `gimbal_reset`, …), **ohne** `drc_`-Präfix; noch nicht umgesetzt |
| RC Plus 2 | [mqtt/dji-rc-plus-2/properties](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/dji-rc-plus-2/properties.html) | Zustand der RC | **`drc_state` pushMode 0 → OSD der RC**, nicht `state` → `drc-runtime.js` abonniert `…/{rc}/osd` (behoben); `cloud_control_auth` pushMode 1 |
| RC Plus 2 | [mqtt/dji-rc-plus-2/device](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/dji-rc-plus-2/device.html) | Topologie | Seite nennt `thing/product/{gateway_sn}/status` und **keine** `domain`/`index`; abweichend von allen anderen Seiten und der echten RC → SkyHub bleibt bei `sys/…`, `domain` nur für type 174/99 ergänzt |
| RC Plus 2 | [mqtt/dji-rc-plus-2/remote-control](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/dji-rc-plus-2/remote-control.html) | Kamera/Gimbal Matrice 4 | `drc_camera_*`, `drc_gimbal_reset`, `drc_ir_metering_*` und Pushes über `drc/down`/`drc/up` → `drc-payload.js` |
| Lageübersicht | [websocket/situation-awareness/message-push](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/websocket/situation-awareness/message-push.html) | WebSocket an Pilot 2 | `device_osd`/`device_online`/`device_offline`/`device_update_topo`, `version` „1.0“ = `tsa-contract.js` |
| Einstieg | [quick-start/source-code-deployment-steps](https://developer.dji.com/doc/cloud-api-tutorial/en/quick-start/source-code-deployment-steps.html) | Lizenz, Pilot-2-Anmeldung | App ID/Key/License → `SKYHUB_DJI_APP_*` + `platformVerifyLicense`; Demo-Zugänge (`pilot`/`pilot123`, `adminPC`) gibt es in SkyHub nicht |
| Einstieg | [tutorial-map](https://developer.dji.com/doc/cloud-api-tutorial/en/tutorial-map.html) | Funktionsübersicht | Tabelle älter (Pilot bei *Live Flight Controls* „–“); für Pilot offen: Kartenelemente schreiben + WebSocket, Livestream per MQTT |
| Medien | [feature-set/pilot-feature-set/pilot-media-management](https://developer.dji.com/doc/cloud-api-tutorial/en/feature-set/pilot-feature-set/pilot-media-management.html) | Medien-Upload aus Pilot 2 | Ablauf (JSBridge `media`-Modul → Fingerabdruck → STS → Upload → Rückmeldung) = `pilot-login.js`, `pilot-media-*.js` |
| Medien | [https/media-management/fast-upload](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/https/media-management/fast-upload.html), [obtain-exited-tiny-fingerprint](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/https/media-management/obtain-exited-tiny-fingerprint.html) | Doppelte Uploads vermeiden | Felder (`fingerprint`, `ext.tinny_fingerprint` in DJI-Schreibweise, `tiny_fingerprints`) = `media-upload-contract.js`; „nicht vorhanden“ beschreibt DJI nicht → SkyHub antwortet mit Fehlercode (Annahme) |
| Medien | [https/media-management/obtain-temporary-credential](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/https/media-management/obtain-temporary-credential.html) | STS für MinIO | `provider` ali/aws/**minio**, `credentials.expire` s, `object_key_prefix` = `stsResponse` (≤ 3600 s, Präfix enthält Workspace) |
| Medien | [https/media-management/mediafile-upload-result-report](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/https/media-management/mediafile-upload-result-report.html), [group-upload-callback](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/https/media-management/group-upload-callback.html) | Upload-Rückmeldung | `result` laut 1.18 Pflicht, Pilot 2 lässt es weg → fehlend = 0; `shoot_position` als „integer“ dokumentiert, real Dezimalgrad → SkyHub nimmt Zahlen; Gruppe: `file_uploaded_count ≤ file_count` |
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

Nur ergänzend, **nicht** Referenz: GitHub [dji-sdk/Cloud-API-Doc](https://github.com/dji-sdk/Cloud-API-Doc/tree/master/docs/en) ist auf
Stand **v1.11.3 (07.11.2024)**, ohne RC-Plus-2- und Matrice-4-Seiten und mit der älteren Nutzlast-API (RC Pro, `services`).
Ebenfalls nur ergänzend (abgeglichen 04.11.2026):
- [dji-sdk/FlightHub-2-Plugin](https://github.com/dji-sdk/FlightHub-2-Plugin) 1.0.0 (27.10.2026, Apache-2.0): Plugins **innerhalb** von
  FlightHub 2, kein Cloud-API-Protokoll. Für SkyHub nur als Vergleich: das FH2-Cockpit bietet Plugins beim Gimbal nur `reset` und `lookAt`,
  **kein** freies Drehen; `lookAt` auf Kartenpunkt sendet `camera_look_at` mit `locked` = true als Vorgabe (SkyHub: false).
- [dji-sdk/FlightRecordParsingLib](https://github.com/dji-sdk/FlightRecordParsingLib) 1.0.6 (12.04.2024, MIT): Flugbuch-Dateien bis
  Version 13; Entschlüsselung nur online (`dev.dji.com/openapi/v1/flight-records/keychains` mit App Key) und meldet jeden Lauf an
  `statistical-report.djiservice.org`. Matrice 4 nicht in der Produktliste. In SkyHub nicht verwendet.

## Regeln für die Weiterentwicklung
1. Neue Protokollteile zuerst gegen die passende Seite oben abgleichen; Quelle (Seite, Feld) im Code-Kommentar nennen.
2. Wertebereiche und Pflichtfelder der Seite übernehmen, nicht schätzen. Fehlt eine Angabe, ausdrücklich als Annahme kennzeichnen.
3. Für RC Plus 2/Matrice 4 und RC Pro/Mavic 3E-Serie jeweils die gerätespezifische Seite nehmen; „others“ gilt nur für übrige Geräte.
4. Diese Liste bei jeder neu herangezogenen Seite ergänzen.
