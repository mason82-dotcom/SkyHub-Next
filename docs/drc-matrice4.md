# Live-Steuerung (DRC) der Matrice 4E/4T über DJI RC Plus 2

**Stand 04.11.2026, Entwicklung. Keine Hardwarefreigabe.** Referenz: DJI Cloud API 1.18, Seiten in [dji-referenz-1.18.md](dji-referenz-1.18.md)
(*Live Flight Controls*, *dji-rc-plus-2/drc*, */remote-control*, *topic-definition*, *m4-series/properties*).

## Was geht, was nicht
| | Matrice 4E/4T + RC Plus 2 | Mavic 3E/3T/3M + RC Pro |
|---|---|---|
| Cloud-Flugsteuerung (Knüppel, Zielanflug, Abheben, Rückkehr, Not-Stopp, Landen) | **ja** (DJI) – in SkyHub umgesetzt | nein (DJI bietet sie nicht an) |
| Nutzlast (Kamera, Gimbal) | **ja** (DJI, `drc_camera_*` über `drc/down`) – in SkyHub umgesetzt | ja (DJI, `camera_*` über `services`) – noch nicht umgesetzt |
| Flugaufträge `flighttask_*` | nein (nur Dock) | nein |
| Routen | über die Pilot-2-Bibliothek, Start an der RC | ebenso |

## Sicherheitsmodell
- **Während der Cloud-Steuerung sind Knüppel, Rückkehr- und Not-Aus-Taste der RC wirkungslos (DJI).** Ein Pilot steht trotzdem mit Sichtkontakt
  an der RC und weiß, wie er in Pilot 2 die Cloud-Kontrolle beendet.
- **Bediener-Lease:** Nur ein Bediener steuert. Seine Seite schickt alle 300 ms ein Lebenszeichen, nur wenn „Ich steuere“ an ist und der Tab sichtbar ist.
- **Totmannschaltung:** Fehlt das Lebenszeichen 1,5 s, gehen die Knüppel auf neutral, ein Zielanflug oder Abheben wird gestoppt (`fly_to_point_stop`),
  und nach weiteren 3 s verlässt SkyHub den DRC-Modus und gibt die Cloud-Kontrolle frei (`drc_mode_exit`, `cloud_control_release`). Die RC hat dann wieder
  alle Funktionen. Kommt der Bediener vorher zurück, wird abgebrochen. Das Gerät selbst verlässt DRC erst nach **1 Minute** ohne Herzschlag – darauf
  verlässt sich SkyHub nicht.
- **Beenden des Backends** (Update, Absturz-Neustart): zuerst Rückgabe an die RC.
- **Knüppel** 10 Hz nur bei Eingabe, Ausschlag begrenzt (Standard 50 %), Eingaben älter als 300 ms → neutral, danach Stille (das Fluggerät bremst).
- **Not-Stopp** (`drone_emergency_stop`): jeder angemeldete Bediener, auch ohne Lease; Leertaste oder roter Knopf.
- **Grenzen:** Höhe 20–120 m über Start, Entfernung ≤ 2000 m vom Startpunkt (`home_*`), Geschwindigkeit ≤ 10 m/s (max. 15). Höhe wird in die
  Ellipsoidhöhe umgerechnet, die DJI für `fly_to_point` verlangt (`height` − `elevation` + Zielhöhe).
- **Abheben** nur am Boden (≤ 2 m) aus Standby/Live-Steuerung, mit Rückkehr bei Signalverlust; Bestätigung durch Eintippen von ABHEBEN.
  **Landen** nur mit LANDEN.
- **Ereignisse mit `need_reply`** (Anflug-/Abhebefortschritt, Knüppel ungültig, Rückkehrinfo) werden auf `events_reply` bestätigt.
- **Audit:** jeder Befehl, jede Ablehnung und jede Fail-safe-Aktion in PostgreSQL (`drc_audit`), ohne Token.

## Kamera und Gimbal (Matrice 4E/4T)
Quelle: *dji-rc-plus-2/remote-control* (1.18). Laut *pilot-feature-set/drc* unterscheidet DJI bei Matrice 4 nicht zwischen Flug- und
Nutzlastrechten: dieselbe Autorisierung gilt. Befehle gehen als `drc_*` über `drc/down` mit `seq`; die Antwort `{method,seq,data:{result}}`
kommt auf `drc/up` und wird über `seq` **und** Methode zugeordnet (5 s Zeitlimit, `result ≠ 0` = abgelehnt, beides sichtbar und im Audit).
- **Nur im Live-Steuermodus mit Bediener-Lease.** Kamera: `payload_index` 88-0-0 (4E) / 89-0-0 (4T) laut *product-support*; ein in der
  OSD gemeldeter `payload_index` derselben Kamera hat Vorrang (*m4-series/properties*, `{type-subtype-gimbalindex}`).
- **Angeboten:** Kameramodus, Foto, Video Start/Stopp, Zoom (`drc_camera_focal_length_set`, sichtbar 2–200, IR 2–20), Gimbal ziehen
  (`drc_camera_screen_drag`), Gimbal-Reset (Mitte, nach unten, Schwenk zentrieren), Kamera auf Kartenpunkt (`drc_camera_look_at`,
  Ellipsoidhöhe wie beim Zielanflug umgerechnet), Kamera auf Bildpunkt, Fokus, Belichtungsmodus/-korrektur, geteilter Bildschirm,
  Temperaturmessung (nur 4T). API: `POST /api/drc/payload/<befehl>`, `POST /api/drc/payload/look-at`, Socket `gimbal`.
- **Bewusst nicht angeboten:** Positions-/Antikollisionslichter (`drc_night_lights_state_set`) und Diskretmodus (`drc_stealth_state_set`)
  bleiben beim Piloten; Speicher-, Auflösungs-, ISO-, Verschluss-, Blenden-Einstellungen vorerst in Pilot 2.
- **Gimbal ziehen** ist ein Geschwindigkeitsbefehl. DJI nennt weder Bereich noch Senderate. **Annahmen (am Boden prüfen):** höchstens
  ±0,6 rad/s, `locked=false` (nur der Gimbal dreht, nicht das Fluggerät), 10 Hz solange gehalten, 300 ms nach der letzten Eingabe eine
  Nachricht mit Geschwindigkeit 0. Totmannschaltung und Rückgabe stoppen den Gimbal ebenso.
- **Zustand:** `drc_camera_state_push` (Modus, Aufnahme, Restkapazität), `drc_camera_osd_info_push` (Zoom, IR), `drc_camera_photo_info_push`;
  Gimbalwinkel aus `osd_info_push` bzw. der Fluggeräte-OSD. Felder werden einzeln übernommen, Unbekanntes verworfen.
- **`drc_state`** kommt laut *dji-rc-plus-2/properties* (pushMode 0) in der **OSD der RC** (0,5 Hz), nicht in `state`. SkyHub liest beide;
  dafür braucht `skyhub_commander` Leserecht auf `thing/product/+/osd` (siehe unten).

## Einrichten
1. **Broker-Benutzer** (Mosquitto auf brix-node, `ops/brix/mosquitto/acl` und `passwd`; Passwörter mit `mosquitto_passwd`):
   ```
   user skyhub_commander            # Backend (SKYHUB_DRC_MQTT_*)
   topic write thing/product/+/services
   topic write thing/product/+/drc/down
   topic write thing/product/+/events_reply
   topic read thing/product/+/services_reply
   topic read thing/product/+/events
   topic read thing/product/+/osd     # drc_state der RC (pushMode 0, dji-rc-plus-2/properties)
   topic read thing/product/+/state
   topic read thing/product/+/drc/up

   user skyhub_drc_link             # bekommt die RC per drc_mode_enter (SKYHUB_DRC_BROKER_*)
   topic write thing/product/+/drc/up
   topic read thing/product/+/drc/down

   user mqttx_debug                 # nur Mitlesen mit MQTTX; bewusst OHNE …/services: drc_mode_enter enthält das DRC-Passwort
   topic read thing/product/+/services_reply
   topic read thing/product/+/events
   topic read thing/product/+/events_reply
   topic read thing/product/+/drc/up
   topic read thing/product/+/drc/down
   topic read thing/product/+/osd
   topic read thing/product/+/state
   topic read sys/product/+/status
   ```
   Danach den Broker neu laden. Der Benutzer `pilot2` bleibt unverändert.
2. **`.env`**: `SKYHUB_DRC_*` laut `.env.example`, `SKYHUB_DRC_GATEWAY_SN` = Seriennummer **der** RC Plus 2.
   `SKYHUB_DRC_BROKER_ADDRESS` = Adresse, unter der die RC den Broker erreicht (heute `192.168.178.63:1884`, Weiterleitung zum brix-node).
3. Backend neu starten; Log: `[drc] live flight control active for RC …`.
4. Oberfläche: `https://rpi5.fritz.box:4443/drc.html` (SkyHub-Token + Steuer-Token).

## Mitlesen mit MQTTX (DJI-Empfehlung)
Desktop: neue Verbindung, Host = Broker (`192.168.178.63`, Port `1884`), Benutzer `mqttx_debug`. Abonnieren:
`thing/product/<RC-SN>/services_reply`, `…/events`, `…/events_reply`, `…/drc/up`, `…/drc/down`, `thing/product/<Fluggerät-SN>/osd`.
`…/services` ist absichtlich nicht lesbar: `drc_mode_enter` überträgt dort Zugangsdaten für die DRC-Verbindung an die RC.
Kommandozeile:
```bash
mqttx sub -h 192.168.178.63 -p 1884 -u mqttx_debug -P '<passwort>' -t 'thing/product/<RC-SN>/events' -t 'thing/product/<RC-SN>/drc/up' -t 'thing/product/<RC-SN>/services_reply'
```
`mqttx_debug` darf **nur lesen**. Steuerbefehle nie von Hand aus MQTTX senden.

## Testablauf
1. **Ohne Hardware:** (Simulator kennt auch Kamera, Zoom, Gimbal und meldet `drc_state` über die RC-OSD) `node scripts/drc-rc-simulator.js --url mqtt://192.168.178.63:1884 --username <test-benutzer> --password-file <datei>`
   (Seriennummer `SIMRCP2`, Fluggerät `SIMM4T`; `SKYHUB_DRC_GATEWAY_SN=SIMRCP2`). Ablauf in `drc.html` durchspielen, MQTTX mitlesen lassen,
   Tab wechseln → Rückgabe nach ~4,5 s prüfen. `--deny` simuliert einen ablehnenden Piloten.
2. **Am Boden, Propeller ab:** Webansicht in Pilot 2 bei Bedarf mit Chrome DevTools mitlesen (`chrome://inspect/#devices`, in Pilot 2
   mehrmals auf die Titelleiste der Cloud-Seite tippen; *debug/dji-pilot2-webview-debug*). Dann echte RC Plus 2, Autorisierung, Live-Modus, Herzschlag/Latenz, Not-Stopp-Antwort, Totmann-Rückgabe, Rückgabe beim
   Neustart des Backends. Prüfen, wie Pilot 2 die Cloud-Kontrolle beenden lässt und welcher `mode_code` am Boden im Live-Modus gemeldet wird.
3. **Erster Flug:** freies Gelände, Sichtflug, 30 m, Zielanflug 50 m, Rückkehr; Knüppel nur kurz mit 30 % Ausschlag
   (`SKYHUB_DRC_STICK_SCALE=0.3`). Abbruchkriterium: jede unerwartete Reaktion → Not-Stopp, Rückgabe, RC übernimmt.

## Offen
- Nutzlaststeuerung der Mavic 3E-Serie über RC Pro (`camera_*`/`gimbal_reset` auf `services`, *rc-pro/drc*); Befehlskatalog
  `drc-payload.js` ist dafür vorbereitet, Übertragungsweg und Freigabe der RC Pro fehlen.
- Kamera/Gimbal am Boden prüfen: Senderate und Bereich von `drc_camera_screen_drag`, Verhalten von `locked`, Antwortzeiten.
- `dji-rc-plus-2/device` nennt als Topic `thing/product/{gateway_sn}/status` und keine `domain`; alle anderen Seiten und die echte RC
  (22.10.2026) nutzen `sys/product/{gateway_sn}/status`. SkyHub bleibt bei `sys/…`; fehlt `domain`, ergänzt die DRC-Erkennung sie nur
  für RC Plus 2 (type 174) und Matrice 4 (type 99).
- Livevideo aus der Cloud starten (`live_start_push`, WebRTC bei RC Plus 2) für die Steueroberfläche.
- POI-Kreisflug (`poi_mode_enter` …).
- `takeoff_to_point.target_height` ist laut Tabelle „Target point height“ ohne Bezug; SkyHub nimmt wie bei `fly_to_point` Ellipsoidhöhe an –
  **am Boden mit Simulator und dann mit echter RC prüfen**.
