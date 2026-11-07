# DJI Cloud API: Kompatibilitätsabgleich für SkyHub Next

> **Aktueller Feldabgleich:** [DJI Cloud API 1.18 – sechs Gerätemodelle](dji-118-field-audit.md). Der Katalog enthält 144 Mavic-3-, 202 vorläufige Matrice-4T-, 55 RC-Pro- und 54 RC-Plus-2-Feldpfade sowie neun dynamische Gimbal-Feldtypen im vorläufigen Aircraft-Profil. Alle werden lesend und mit typisierten Whitelists verarbeitet. Für M3M und Matrice 4T ist die gerätespezifische 1.18-Kompatibilität weiterhin nicht belegt; auch die RC Plus 2 benötigt noch eine Hardwareabnahme.
>
> **Dock-Definitionen (22.10.2026):** Zusätzlich liegen Webreferenz-Profile für DJI Dock, Dock 2 und Dock 3 sowie die Dock-Flugzeuge Matrice 3D/3TD und 4D/4TD vor, ohne Hardwarebeobachtung (siehe [Abgleich mit dem Dock Feature Set](dji-118-field-audit.md)).

Zielstand: DJI Cloud API 1.18 (vom Projekt vorgegeben). Protokolldetails gelten nur soweit durch die verlinkten offiziellen API-Referenzen belegt. Vollständige 1.18-Konformität ist nicht getestet.

## Eingesetzte Referenzen

- Offiziell: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/
- Gerätekennung: https://developer.dji.com/doc/cloud-api-tutorial/en/overview/product-support.html
- Pilot-Topologie: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/rc-plus/device.html
- Fluggeräte: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/aircraft/properties.html
- RC Pro Enterprise: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/rc-pro/properties.html
- Aircraft-OSD: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/aircraft/properties.html
- Alt-Demo: https://github.com/dji-sdk/Cloud-API-Demo-Web (laut DJI seit 10.04.2025 nicht mehr gepflegt)

## Eingereichte api.zip

Das bereitgestellte Archiv enthält AeroNexus-On-Prem-Patches gegen die DJI-Referenzdemos von April 2025:

- Backend: Spring Boot / Java 11, gepatchte Matrice-4-/RC-Plus-2-Gerätekennungen, WHIP-Stream-URL.
- Control: Vue 3, Vite 2, Gerätebezeichnungen, AMap-zu-Leaflet-Adapter, WebRTC-WHEP/HLS-Player.
- Edge: eigener Compose-Stack mit MySQL, Redis, EMQX, MinIO und MediaMTX.
- Diese Dateien sind KEINE DJI-Cloud-API-1.18-Spezifikation und wurden nicht in SkyHub Next übernommen.

## Umgesetzte Abweichungen

1. Read-only MQTT-Topics: sys/product/{gateway_sn}/status, thing/product/{sn}/osd, thing/product/{sn}/state, events und services_reply.
2. Topologie update_topo: Gateway-Untergeräte-Kanten, Unterscheidung von Pilot- und Dock-Varianten, verschiedene Datentypen für version, index und domain.
3. Geheimnisse aus Topologie-Nachrichten werden nicht in den Browser, den Gerätekatalog oder das Cache-Modell übernommen.
4. Gerätemodelle werden nur anhand der Kombination domain/type/sub_type aufgelöst. Kamera-Typ 89 ist nicht mit Fluggerät-Typ 89 gleichzusetzen.
5. Eindeutige Flughöhen: elevation (relativ zum Startpunkt) und height (Ellipsoidbezug) sind getrennte Werte.
6. mode_code aus OSD und state, nicht ausschließlich aus state.
7. PostGIS: device_sn als Fluggerätekennung, gateway_sn optional; beide dürfen nicht verwechselt werden.
8. Stale-Packets überschreiben keine neueren OSD-Meldungen; reine Topologie- und Statusnachrichten erzeugen keine fingierte OSD-Frische.

## Telemetrie-Feldinventar (21.10.2026, Hardware-Snapshot)

Die RC Pro Enterprise meldete fünf der 17 bisher normalisierten Felder
(`latitude`, `longitude`, `heightEllipsoid`, `battery`, `linkQuality`).
Die Mavic 3M meldete 14 von 17; es fehlten die zwei gültigen GPS-Koordinaten
(DJI lieferte `0,0`) und `linkQuality`, ein Gateway-spezifisches Feld.
Die Profil-Diagnose unterscheidet deshalb typische RC- und Aircraft-Felder,
optionale zusätzliche DJI-Werte und für die Rolle nicht anwendbare Felder.
Die Verfügbarkeit im Snapshot belegt nicht, dass ein Wert in jedem OSD-Paket
vorhanden oder ein GNSS-Fix gültig war.

Die Parser-Erweiterung wertet nur dokumentierte, optionale DJI-OSD-Lesefelder
aus: Wind, kumulierte Flugwerte, SDR-/4G-Verbindungszustände und
4G-Signalqualität. Windrichtung ist ein Sektor-Code 1–8, kein Gradwinkel.
Ungültige Signalqualitäts-Sentinels (z. B. 65535) werden verworfen.
RTK bleibt optional; die fortlaufende Positionsaufzeichnung bleibt aus.

## Abgleich mit dem Pilot Feature Set (22.10.2026)

Quellen: `feature-set/pilot-feature-set/pilot-access-to-cloud` und
`pilot-map-elements` sowie die JSBridge-Referenz
(`api-reference/pilot-to-cloud/jsbridge`) von
`developer.dji.com/doc/cloud-api-tutorial/en/`.

Übereinstimmung der Pilot-Login-Seite (`frontend/public/pilot-login.js`) mit
der Referenz:

- Lizenzprüfung vor allen weiteren Aufrufen: `platformIsVerified`,
  `platformVerifyLicense(appId, appKey, license)`.
- Workspace: `platformSetWorkspaceId(uuid)` (UUID-Format wird serverseitig
  erzwungen) und `platformSetInformation(platformName, workspaceName, desc)`.
- Cloud-Modul: `platformLoadComponent('thing', {host, username, password,
  connectCallback})` mit `tcp://`-Adresse, Status über `thingGetConnectState`,
  Wiederverbindung über `thingConnect(user, pass, callback)`.
- Antwortformat der JSBridge (JSON-String mit `code`, `message`, `data`) wird
  mit `code === 0` ausgewertet.
- Ablauf „kein Token → H5-Login, gültiger Token → Hauptseite, ungültiger
  Token → neuer Ablauf“: entspricht dem Kopplungstoken (gültig → Bootstrap,
  ungültig oder widerrufen → neue Kopplung).

Bewusste Abweichungen und Lücken:

- Das `api`-Modul (`X-Auth-Token`), das `ws`-Modul und das Karten-Modul werden
  nicht geladen. Sie sind Voraussetzung für Karten-Elemente, Wayline-,
  Medien- und TSA-Funktionen. Der lesende Karten-Endpunkt ist standardmäßig
  deaktiviert (`SKYHUB_DJI_MAP_ELEMENTS_ENABLED=false`); die DJI-Referenz
  empfiehlt, das Karten-Modul in der Login-Phase zu laden. Dieser Schritt fehlt
  absichtlich, bis Schreib-, WebSocket- und Wayline-Pfade validiert sind.
- Livestream-, Wayline-, DRC- und Log-Funktionen sind nicht umgesetzt. Für die
  Medienverwaltung existiert nur ein isolierter Vertragsbaustein ohne Route
  und ohne Zugangsdaten-Ausgabe: [Medien-Upload-Vertrag](dji-media-upload-contract.md).
- MQTT läuft im LAN unverschlüsselt (`tcp://`, Port 1884). DJI weist darauf
  hin, dass Pilot 2 für TLS-Verbindungen Zertifikate bestimmter Aussteller
  (z. B. GoDaddy) erwartet; TLS ist deshalb als eigene Firmware-Validierung
  offen (siehe `pilot-config.js`).

## Abgleich mit den Basiskonzepten und der Produktliste (22.10.2026)

Quellen: `overview/basic-concept/` (`proper-noun`, `mqtt`, `thing-model`, `https`, `websocket`,
`jsbridge`) und `overview/product-support` von `developer.dji.com/doc/cloud-api-tutorial/en/`.
Nicht verglichen wurden `product-introduction` und `product-architecture`. Die Webseite nennt
keine Cloud-API-Version.

| Thema | DJI-Definition | SkyHub |
|---|---|---|
| Protokoll | MQTT 5.0 | `protocolVersion: 5` |
| Themenpräfixe | `sys/` (Gerätelebenszyklus), `thing/` (Property, Service, Event) | abonniert: `sys/product/+/status`, `thing/product/+/osd`, `state`, `events`, `services_reply`; veröffentlicht nur `status_reply` über einen eigenen Benutzer |
| Nachrichtenhülle | `tid`, `bid`, `method`, `data`, `timestamp` (13-stellig, ms) | `timestamp` muss eine Ganzzahl zwischen 1e12 und 1e15 sein, sonst wird die Nachricht verworfen; `method` wird übernommen; `tid` und `bid` nur für die `status_reply`-Antwort |
| Push-Modi | 0: 0,5 Hz (`osd`); 1: bei Änderung (`state`); 2: Änderung wird **nicht** gemeldet, der Server muss abfragen | Der Parser übernimmt ein Feld nur auf seinem Kanal (0 → OSD, 1 → State). Im Katalog hat kein Wurzelfeld `pushMode` 2 |
| Property setzen, Services | über `property/set` und `services` | nicht umgesetzt (lesend) |
| Geräte-/Gateway-Begriffe | Gateway-Gerät, Komponente, Gerätetopologie | Rollen `gateway`/`subdevice`, Topologie aus `update_topo` |
| Gerätestatus | online, getrennt (Verbindung ohne Meldung verloren), offline (ausdrücklich gemeldet) | `topologyOnline` (`true`/`false`/`null`: `false` nur bei ausdrücklicher Entfernung aus der Topologie), `aircraftConnected` (Modus 14) und `fresh` (OSD jünger als 15 s). Eine zusammengefasste Statusgröße wurde bewusst **nicht** ergänzt: Die Abbildung auf DJIs drei Zustände wäre eine Ableitung, die DJI nicht veröffentlicht, und es gäbe keinen Verbraucher dafür |
| HTTPS-Format | `{scheme}://{endpoint}/{module}/api/{version}/{resource}`, `https` Pflicht, Kopf `X-Auth-Token` | Karten-Endpunkt `/map/api/v1/…` mit HTTPS-Pflicht und `X-Auth-Token`; `X-Device-ID`, `X-Firmware-Version` und `X-Request-ID` werden nicht gelesen (optional) |
| HTTPS-Antwort | immer `{code, message, data}`; Pilot 2 zeigt bei 5xx „(resp.code)“ | **Korrigiert:** Fehlerantworten des Karten-Endpunkts haben jetzt `{code, message, data}` (`code` = HTTP-Status, `error` bleibt für bestehende Aufrufer). Vorher nur `{error}` |
| HTTP-Status in Pilot 2 | 400 Parameterfehler, 401 Anmeldung ungültig (Abmeldung von der Cloud), 403 keine Berechtigung, 404 Ressource fehlt | deckt sich mit den gelieferten Statuscodes |
| WebSocket | Pilot 2 verbindet sich mit der vom Server gelieferten URL; Push `{biz_code, version, timestamp, data}` (z. B. `device_topo_update`) | Lagebild (TSA) umgesetzt, standardmäßig aus: [Situation Awareness](dji-pilot-situation-awareness.md). Kartenelemente über den WebSocket fehlen weiterhin |
| JSBridge | siehe Abschnitt Pilot Feature Set | unverändert |

**Produktliste (`product-support`):** Die Aufzählung der Flugzeuge, Fernsteuerungen und Docks
(domain/type/sub_type) stimmte bis auf eine Lücke mit `backend/catalog.js` überein. Ergänzt wurden:

- `8/135/0` DJI O4 Ground Station (Netzwerk-Basisstation für Dock 3), Kategorie `base-station`.
- Kamera- und Nutzlasttypen (Domain 1): Zenmuse Z30, XT2, XTS, H20, H20T, H20N, H30, H30T,
  Matrice 30/30T/3D/3TD/4D/4TD Camera, Mavic 3TA Camera, Aircraft FPV Camera, Vision Assist Camera
  und DJI Dock Camera (18 neue Typen; vorher nur vier). In DJIs Schreibweise
  `type-sub_type-gimbalindex` ist die dritte Zahl die Montageposition und kein Teil des Schlüssels.

Bewusst unverändert: `0/77/2` (Mavic 3M, nur an Hardware beobachtet, nicht in DJIs Liste), die
Kameraken­nung `1/68/0` (unbestätigt, nicht in DJIs Liste) und die Anzeigenamen (`Mavic 3E` statt
„Mavic 3 Enterprise Series (M3E Camera)“, `DJI RC Plus 2 Enterprise` statt „DJI RC Plus 2“).

## Ausdrückliche Einschränkungen

- Mavic 3M: Das Fluggerät `0/77/2` ist seit dem 20.10.2026 per Hardware bestätigt (Topologie über die RC Pro Enterprise) und eingetragen. Die im AeroNexus-Patch genannte **Kamera**-ID 68 bleibt unbestätigt und ist weiterhin nicht zugeordnet.
- Die zusätzliche Cloud-API-1.18-Funktionspalette muss getrennt anhand der offiziellen gerätespezifischen Schemas verifiziert werden. Es werden keine neuen Flugsteuerungs- oder FTS-Methoden blind übernommen.
- Die Demo enthält Pilot-2-JSBridge und vollständige Arbeitsbereiche; SkyHub Next besitzt derzeit nur das gesicherte Read-only-Monitoring. Pilot-2-Onboarding, Medienimport, Video und Wayline-Verwaltung sind eigene zukünftige Adapter.
- Die Backends der DJI-Demo basieren auf anderen Java-/Vue-Bibliotheken. Versionen aus diesem Archiv sind keine Empfehlungen für das neue Node.js-Projekt.
- Alte ZIP-Konfigurationen und Zugangsdaten werden nicht übernommen.

## Prüfstatus

Node-JS-Parser- und Registrierungs-Tests sowie der Docker-Compose-/Container-Build laufen auf dem PR-Branch in GitHub Actions.
Ohne tatsächliche Pilot-2-/Aircraft-/Dock-Hardware bleibt die Protokollvalidierung unvollständig.


## Statuskorrektur (23.10.2026)

**Quelle der Runtime-Aussage:** `main` @ `399e18900db11d976b61cc59a5cd8b081b6570e1`. Die Datumsangaben früherer Hardwaretests bleiben historische Evidenz.
Mit [#15](https://github.com/mason82-dotcom/SkyHub-Next/pull/15),
[#17](https://github.com/mason82-dotcom/SkyHub-Next/pull/17) und
[#20](https://github.com/mason82-dotcom/SkyHub-Next/pull/20) wurden der
typisierte Feldkatalog, die RC-Pro/M3M-Diagnostik und die zusätzlichen
M3M-OSD-Feldpfade in Main integriert. Vorläufige Katalogpfade sind keine
durch Hardware bestätigten Messwerte. Einzelheiten: [Hardwarebericht](hardware-rc-pro-m3m.md).

**In Main – rein lesende Diagnostik:** Mit [#66](https://github.com/mason82-dotcom/SkyHub-Next/pull/66) sind die M3M-Kamerafeld-/State-Lückenklassifikation und der RC-Plus-2/M4T-Offline-Prüfer mit synthetischer Integration verfügbar. 54 statische RC-Plus-2- und 199 vorläufige M4T-Feldpfade (neun dynamische Gimbal-Feldtypen) sind Katalogumfang, **kein realer M4T-Hardware-Nachweis**. Die echten Geräte müssen separat geprüft werden.

**Weiterhin außerhalb von Main:** Die historischen Abnahmezweige [#18](https://github.com/mason82-dotcom/SkyHub-Next/pull/18), [#21](https://github.com/mason82-dotcom/SkyHub-Next/pull/21), [#22](https://github.com/mason82-dotcom/SkyHub-Next/pull/22) und [#27](https://github.com/mason82-dotcom/SkyHub-Next/pull/27) bleiben als Quell-/Evidenzgeschichte offen, jedoch selektiv durch #66 ersetzt; [WPML #16](https://github.com/mason82-dotcom/SkyHub-Next/pull/16) und [HiveMind-Labor #46](https://github.com/mason82-dotcom/SkyHub-Next/pull/46) sind getrennte offene Feature-Entwicklungen. Der [DJI-1.18-Paritätsaudit #47](https://github.com/mason82-dotcom/SkyHub-Next/pull/47) ist **nach Main gemergt**, prüft aber ausschließlich 16 synthetische Status-/Service-Reply-Fälle ohne Live-MQTT oder DJI-Hardware. Simulation mit SDK 1.16.1.3
oder 16 synthetische Protokoll-Fixtures belegen keine Cloud-API-1.18-
Hardwarekonformität. Ein erfolgreiches M3M-OSD-Ereignis belegt ebenso wenig
Pilot-2-Medien-HTTPS, WPML-Missionsausführung oder Multispektral-Radiometrie.
[Komplettes Statusregister](projektstand-2026-10-23.md).

