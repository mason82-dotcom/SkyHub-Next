# DJI Pilot 2: Lagebild (Situation Awareness, TSA)

Stand: 22.10.2026. **Standardmäßig aus.** Nicht an Hardware geprüft.

Quellen (englische DJI-Webreferenz, ohne Versionsangabe): `feature-set/pilot-feature-set/pilot-situation-awareness`,
`api-reference/pilot-to-cloud/websocket/situation-awareness/message-push`,
`api-reference/pilot-to-cloud/https/situation-awareness/obtain-device-topology-list` und der Abschnitt
„WS Module“/„TSA Module“ der JSBridge-Referenz.

## Was es tut

Pilot 2 zeigt auf seiner Karte alle Geräte desselben Workspaces, die der Server meldet. SkyHub liefert dafür:

| Teil | Umsetzung |
|---|---|
| `GET /manage/api/v1/workspaces/{id}/devices/topologies` | Liste aus der Registry: `parents` = Fernsteuerung, `hosts` = ihre Flugzeuge, mit `device_model` (`domain-type-sub_type`), `online_status` und dem Modellnamen als `device_callsign`. HTTPS-Pflicht, Kopf `X-Auth-Token`, DJI-Hülle `{code, message, data}` |
| WebSocket `wss://<öffentliche Adresse>/ws/tsa?x-auth-token=…` | `device_osd` mit Breite, Länge, Höhe, Kurs, relativer Höhe und Geschwindigkeiten, sobald eine **neue** gültige Position vorliegt (etwa 0,5 Hz); `device_online`, `device_offline` und `device_update_topo` bei Änderungen, höchstens eine Meldung je Art und Sekunde |
| Login-Seite | lädt nach dem Cloud-Modul `api`, `ws` und `tsa`, aber nur wenn der Bootstrap `tsa` enthält; ein Fehler dort lässt die MQTT-Anbindung unberührt |

`online_status` ist nur `true`, wenn die Topologie das Gerät meldet **und** sein OSD jünger als 15 s ist. Eine nach
einem Neustart aus Redis wiederhergestellte Topologie allein reicht nicht.

## Sicherheit

- Nur lesend: Der Kanal sendet und ignoriert alles, was der Client schickt (höchstens 1 KB je Nachricht, größere
  Nachrichten trennen nur diese Verbindung).
- Zugang nur mit dem Pilot-Zugangstoken oder einem **für diesen Workspace** gekoppelten Gerätetoken; Ablehnungen sind
  401, ohne HTTPS (über Caddy) 403, bei voller Belegung (20) oder gestörter Prüfung 503.
- `X-Forwarded-Proto: https` wird nur von einem Loopback- oder privaten Absender (Caddy) geglaubt.
- Verbindungen ohne Antwort auf Pings werden nach spätestens 60 s getrennt.
- Die Nullposition `0/0` wird nie gesendet. Fremde Daten (AirSense) sind nicht Teil des Kanals.
- DJI sieht das Token in der WebSocket-URL vor. `scripts/pi-caddy-pilot-tsa.sh` entfernt es aus den
  Caddy-Zugriffsprotokollen, ebenso den Kopf `X-Auth-Token` der HTTPS-Abfragen.

## Einschalten (in dieser Reihenfolge)

1. `sudo bash scripts/pi-caddy-pilot-tsa.sh apply` (prüft, lädt neu, nimmt bei Fehlern zurück; `rollback` vorhanden).
2. In `.env`: `SKYHUB_DJI_TSA_ENABLED=true` und `SKYHUB_PILOT_PUBLIC_URL=https://rpi5.fritz.box`
   (dieselbe Adresse, über die die RC `/pilot-login` öffnet).
3. `docker compose up -d --no-deps --force-recreate backend`.
4. Auf der RC `/pilot-login` neu öffnen; die Diagnose zeigt „Lagebild (TSA): Module geladen“ und den WebSocket-Status.
5. `/api/health` zeigt unter `tsa` die Zahl der verbundenen RCs und gesendeten Nachrichten.

## Nicht nachgewiesen

- Ob Pilot 2 an einen `host` mit Pfad (`/ws/tsa`) korrekt `?x-auth-token=…` anhängt, ist nur durch DJIs Beispiel
  ohne Pfad belegt.
- Wie Pilot 2 eigene Geräte (die RC selbst und ihr Flugzeug) neben den gemeldeten darstellt.
- Kartenelemente über den WebSocket (`map_element_*`) sind nicht umgesetzt.
