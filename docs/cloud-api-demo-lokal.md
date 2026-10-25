# DJI-Cloud-API-Demo lokal (Testweg neben SkyHub Next)

**Stand 24.10.2026 · Opt-in · nur LAN-Test.** Der offizielle DJI-Demo-Stack (Java-Backend und Vue-Frontend) läuft als **zweiter, isolierter Docker-Stack** neben SkyHub Next. Er ist **kein Ersatz** für SkyHub Next und kein FlightHub 2 (siehe [Bewertung](dji-flighthub2-on-premises-bewertung.md)).

> **DJI hat die Demo am 10.04.2025 eingestellt** und schreibt im README, sie sei **nicht produktionsreif** und könne ungepatchte Sicherheitslücken enthalten (u. a. Datenabfluss, unbefugter Zugriff). Deshalb nur im LAN, nie über das Internet oder freigegebene Tailscale-Adressen betreiben.

## Wo liegt was

Alles liegt **außerhalb dieses Repositories** unter `~/Projekte/Cloud-API-Demo-Local/` und ist nicht versioniert:

| Pfad | Inhalt |
| --- | --- |
| `DJI-Cloud-API-Demo/` | Backend-Quellen (`dji-sdk/DJI-Cloud-API-Demo`, Spring Boot 2.7, Java 11, Maven), unverändert |
| `Cloud-API-Demo-Web/` | Frontend-Quellen (`dji-sdk/Cloud-API-Demo-Web`, Vue 3, Vite 2), unverändert |
| `Cloud-API-Demo/` | Byte-identische Kopie des Frontends (gleicher Commit); kann gelöscht werden |
| `stack/` | `docker-compose.yml`, zwei Dockerfiles, EMQX-Konfiguration, `pi-cloud-api-demo.sh`, `web-overlay/` (Karte), `.env` (nur für dich lesbar), `runtime/` (erzeugt) |

Die Quellen werden im Build **nicht verändert**: Anpassungen entstehen nur im Build-Container oder als erzeugte Konfiguration unter `runtime/`.

## Betrieb

```bash
cd ~/Projekte/Cloud-API-Demo-Local/stack
bash pi-cloud-api-demo.sh init        # .env mit Zufallsgeheimnissen anlegen/ergänzen (überschreibt nichts)
# DJI_APP_ID, DJI_APP_KEY, DJI_APP_LICENSE selbst in .env eintragen
bash pi-cloud-api-demo.sh preflight   # Ports, Speicher, Quellen, Zugangsdaten (nur lesen)
bash pi-cloud-api-demo.sh apply       # bauen, starten, EMQX-Benutzer anlegen, warten
bash pi-cloud-api-demo.sh status | logs [dienst] | rollback [--purge]
```

`rollback` entfernt Container und Netz (Daten bleiben), `--purge` löscht zusätzlich Volumes, lokale Images und die erzeugte Konfiguration. Kein `sudo`, keine Änderung an SkyHub Next, Mosquitto, Caddy oder anderen Containern.

## Dienste und Ports

| Dienst | Image | Erreichbar | Speicherlimit |
| --- | --- | --- | --- |
| Web (nginx) | selbst gebaut | **LAN :8081** | 64 MB |
| Backend | selbst gebaut | **LAN :6789** | 768 MB |
| EMQX 5.3.0 | `emqx/emqx:5.3.0` | **LAN :18830** (MQTT), **:18084** (MQTT über WebSocket für DRC), Dashboard nur Loopback :18083 | 640 MB |
| MySQL 8.0 | `mysql:8.0` | nur Loopback :3307 | 512 MB |
| Redis 7 | `redis:7-alpine` | nur Loopback :6380 | 96 MB |

Gemessen im laufenden Betrieb: rund 600 MiB gesamt. **Nicht enthalten:** MinIO (Medien-Upload) und MediaMTX (Livestream); beides ist in dieser Phase aus.

## Anmeldung und Absicherung

- **Zufallsgeheimnisse** aus `init` für MySQL, Redis, JWT, EMQX-Dashboard und alle MQTT-Konten. Die **öffentlichen Demo-Zugänge** (`adminPC`/`adminPC`, `pilot`/`pilot123`, MQTT `admin`/`admin`, Bind-Code `qwe`) werden beim ersten Start in der Datenbank **überschrieben**; geprüft: Anmeldung mit Demo-Passwörtern ergibt 401.
- **EMQX** mit Anmeldung (eingebaute Datenbank) und ACL-Datei; alles nicht Genannte wird verweigert und die Verbindung getrennt. Geprüft: anonym, falsches Passwort und Demo-Passwörter werden abgelehnt, `pilot` darf nur `thing/product/#` und `sys/product/#`, `#` ist verboten. EMQX 5.3.0 kennt kein `bootstrap_file`; die Benutzer legt das Skript über die REST-API an (`provision`).
- **Keine TLS-Verschlüsselung** im LAN. Die DJI-App-ID und der Schlüssel stecken im ausgelieferten Frontend-Bundle und sind für jeden im LAN lesbar.
- Dateirechte: `.env` 600, `runtime/` 700.

## Anpassungen nur im Build

| Problem | Behandlung |
| --- | --- |
| Das Root-Pom des Backends führt `spring-boot:repackage` nicht aus (nur ein 1-MB-Jar ohne Startklasse) | Ausführung im Build-Container ergänzt |
| Konfiguration der Livestream-Zahlenfelder enthält Platzhaltertext (Start bricht ab) | Überschrieben in der erzeugten `application.yml` |
| NTP-Server der Demo ist der fremde Host `Google.mzr.me` | `de.pool.ntp.org` |
| Frontend-Lockfile zeigt auf chinesische Mirror (`npmmirror`, `nlark`); `nlark` existiert nicht mehr | `nlark` im Build auf `npmmirror` umgeschrieben; npm prüft jede Datei gegen die Lockfile-Prüfsumme (466 von 677 Paketen nur SHA-1) |

## Karte: Leaflet statt AMap, komplett offline

Die Demo benötigte einen AMap-Key (chinesische Plattform, Sicherheitsschlüssel seit 12/2021). Stattdessen ersetzt eine **Leaflet-Kompatibilitätsschicht** (`stack/web-overlay/leaflet-shim/`) per Vite-Alias den AMap-Loader und bildet nur die benutzte Teilmenge der AMap-API nach (Karte, Marker mit animiertem `moveTo`, Linie, Polygon, Kreis, Text, Zeichenwerkzeug). Koordinaten bleiben WGS-84 (die GCJ-02-Umrechnung der Demo ist die Identität).

Basiskarten aus `~/Projekte/SkyHub-Next-data/basemaps/` (PMTiles v3, schreibgeschützt in den Webserver gemountet, Auslieferung per HTTP-Range, nur `*.pmtiles`):

| Ebene | Datei | Typ | Zoom | Quelle/Lizenz |
| --- | --- | --- | --- | --- |
| Karte (offline), Standard | `baden-wuerttemberg.pmtiles` (844 MB) | Vektorkacheln (Protomaps-Basiskarte) | 0 bis 15, Baden-Württemberg | © OpenStreetMap-Mitwirkende (ODbL), Protomaps |
| Luftbild (offline), zuschaltbar | `luftbild-home.pmtiles` (490 MB) | JPEG | 10 bis 19, kleines Gebiet um den Heimatstandort | LGL-BW (2026) dl-de/by-2-0 (Quellenangabe wird in der Karte angezeigt) |
| OpenStreetMap (online), Auswahl | | Raster | | nur wenn ausgewählt; Standard ist offline |

Startposition und Zoom: `MAP_CENTER`, `MAP_ZOOM` in `.env`. Fehlt `PMTILES_DIR`, fällt die Karte auf OpenStreetMap online zurück. Bibliotheken: `leaflet` 1.9.4, `pmtiles` 4.5.0, `protomaps-leaflet` 5.1.0 (BSD-3).

**Bekannte Abweichungen von AMap:** Polygone sind nicht per Maus verschiebbar, Kreise zeichnet man per Klick (Mitte) und zweitem Klick (Radius), Linien und Polygone beendet ein Doppelklick; keine Satellitenansicht außer dem lokalen Luftbild, kein Wetter, keine Routenmessung. Außerhalb von Baden-Württemberg liefert die Offline-Karte keine Daten.

## Was geprüft ist und was nicht

**Geprüft (24.10.2026, Pi, LAN-Adresse):** Alle fünf Container laufen und sind gesund; Anmeldung mit den neuen Passwörtern und Ablehnung der Demo-Passwörter; MQTT-Anmeldung und ACL; Backend als `JavaServer` am EMQX angemeldet. **Im Browser** (Headless-Chromium über das DevTools-Protokoll): Karte rendert, Marker/Linie/Polygon/Kreis/Text, Zeichnen von Pin, Polygon und Kreis mit echten Mausklicks, Schwenken plus Zoom, 20 Vektor-Canvas mit Inhalt, 25 von 25 Luftbild-Kacheln, **0 Anfragen an openstreetmap.org und an externe Hosts**, keine Konsolenfehler außer dem Agora-Livestream-SDK (startet ohne HTTPS nicht).

**Nicht geprüft:** Kopplung der RC an `http://<Pi-IP>:8081/pilot-login`, ob die Demo die M3M erkennt (sie steht nicht namentlich in DJIs Produktliste; die in [DJI-Cloud-API-Kompatibilität](dji-cloud-api-compatibility.md) beschriebene `api.zip` enthält gepatchte Matrice-4-/RC-Plus-2-Gerätekennungen, was auf Lücken in den Gerätetabellen der Demo hindeutet), die Karte in der Pilot-2-Webview mit Touch, echte Gerätepositionen, Flugbereichs-Seiten, Livestream und Medien.

**Wichtig:** Eine Fernsteuerung kann nur an **eine** Plattform gekoppelt sein. Solange sie an der Demo hängt, erhält SkyHub Next keine Telemetrie (und umgekehrt). Zurück zu SkyHub Next über dessen Pilot-Seite.
