# DJI-Cloud-API-Demo lokal (Testweg neben SkyHub Next)

**Stand 24.10.2026 · Opt-in · nur LAN-Test.** Der offizielle DJI-Demo-Stack (Java-Backend und Vue-Frontend) läuft als **zweiter, isolierter Docker-Stack** neben SkyHub Next. Er ist **kein Ersatz** für SkyHub Next und kein FlightHub 2 (siehe [Bewertung](dji-flighthub2-on-premises-bewertung.md)).

> **DJI hat die Demo am 10.04.2025 eingestellt** und schreibt im README, sie sei **nicht produktionsreif** und könne ungepatchte Sicherheitslücken enthalten (u. a. Datenabfluss, unbefugter Zugriff). Deshalb nur im LAN, nie über das Internet oder freigegebene Tailscale-Adressen betreiben.

## Wo liegt was

Der Stack liegt **im Projektordner** unter `ops/cloud-api-demo/` (versioniert). Die MIT-lizenzierten Upstream-Quellen von DJI werden **nicht** eingecheckt, sondern per `sources.lock` auf feste Commits gepinnt und nach `third_party/dji-cloud-api-demo/` (per `.gitignore` ausgeschlossen) geklont.

| Pfad | Inhalt |
| --- | --- |
| `ops/cloud-api-demo/docker-compose.yml`, `backend.Dockerfile`, `web.Dockerfile`, `emqx/emqx.conf` | Compose-Projekt `cloudapidemo` (eigenes Netz, eigene Volumes) |
| `ops/cloud-api-demo/pi-cloud-api-demo.sh` | Verwaltung: `init`, `fetch-sources`, `preflight`, `build`, `apply`, `provision`, `status`, `logs`, `rollback` |
| `ops/cloud-api-demo/web-overlay/` | Leaflet-Schicht und Koordinatenhilfe für die Karte |
| `ops/cloud-api-demo/sources.lock` | Upstream-Repositories und feste Commits (`DJI-Cloud-API-Demo` `bef525c`, `Cloud-API-Demo-Web` `bfcf3ee`, beide Stand 10.04.2025) |
| `ops/cloud-api-demo/.env`, `runtime/` | **Nur lokal**, nicht im Git: Zufallsgeheimnisse (600) und erzeugte Konfiguration (700) |
| `third_party/dji-cloud-api-demo/` | Geklonte Quellen, nicht im Git, bei Abweichung vom Pin bricht `preflight` ab |

Die Quellen werden im Build **nicht verändert**: Anpassungen entstehen nur im Build-Container oder als erzeugte Konfiguration unter `runtime/`. Das Skript verlangt unveränderte Arbeitsbäume.

## Betrieb

```bash
cd ~/Projekte/SkyHub-Next/ops/cloud-api-demo
bash pi-cloud-api-demo.sh init           # .env mit Zufallsgeheimnissen anlegen/ergänzen (überschreibt nichts)
bash pi-cloud-api-demo.sh fetch-sources  # Upstream klonen und auf den Commit aus sources.lock setzen
# DJI_APP_ID, DJI_APP_KEY, DJI_APP_LICENSE selbst in .env eintragen
bash pi-cloud-api-demo.sh preflight      # LAN-Bindung, Quellen-Pin, Ports, Speicher, Zugangsdaten (nur lesen)
bash pi-cloud-api-demo.sh apply          # bauen, starten, EMQX-Benutzer anlegen, warten
```

Weitere Befehle, jeweils einzeln aufrufen (keine Reihenfolge):

```bash
bash pi-cloud-api-demo.sh status         # Container, Erreichbarkeit, EMQX-Benutzer und Backend-Anmeldung, Speicher
bash pi-cloud-api-demo.sh logs backend   # letzte Logzeilen (mysql redis emqx backend web), Geheimnisse geschwärzt
bash pi-cloud-api-demo.sh rollback       # nur bei Bedarf: Container und Netz entfernen, Daten bleiben
bash pi-cloud-api-demo.sh rollback --purge   # zusätzlich Volumes, lokale Images und erzeugte Konfiguration löschen
```

Kein `sudo`, keine Änderung an SkyHub Next, Mosquitto, Caddy oder anderen Containern.

## Dienste und Ports

| Dienst | Image | Erreichbar | Speicherlimit |
| --- | --- | --- | --- |
| Web (nginx) | selbst gebaut | **LAN-Adresse :8081** | 64 MB |
| Backend | selbst gebaut | **LAN-Adresse :6789** | 768 MB |
| EMQX 5.3.0 | `emqx/emqx:5.3.0` | **LAN-Adresse :18830** (MQTT), **:18084** (MQTT über WebSocket für DRC), Dashboard nur Loopback :18083 | 640 MB |
| MySQL 8.0 | `mysql:8.0` | nur Loopback :3307 | 512 MB |
| Redis 7 | `redis:7-alpine` | nur Loopback :6380 | 96 MB |

**Bindung:** Web, Backend und MQTT sind an `DEMO_BIND_ADDRESS` gebunden (Standard: die LAN-Adresse aus `LAN_IP`), **nicht** an `0.0.0.0`. Damit sind sie nicht über Tailscale oder andere Schnittstellen erreichbar. Der Port-Bereich ist gegen SkyHub Next getrennt (SkyHub: 4001, 4443, 1884). `preflight` bricht bei einer Wildcard-Adresse oder einer Adresse ab, die keiner Schnittstelle gehört. Die Backend-Konfiguration muss die LAN-Adresse behalten, weil das Backend sie den Clients als MQTT-Adresse zurückgibt.

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

Die Demo benötigte einen AMap-Key (chinesische Plattform, Sicherheitsschlüssel seit 12/2021). Stattdessen ersetzt eine **Leaflet-Kompatibilitätsschicht** (`ops/cloud-api-demo/web-overlay/leaflet-shim/`) per Vite-Alias den AMap-Loader und bildet nur die benutzte Teilmenge der AMap-API nach (Karte, Marker mit animiertem `moveTo`, Linie, Polygon, Kreis, Text, Zeichenwerkzeug). Koordinaten bleiben WGS-84 (die GCJ-02-Umrechnung der Demo ist die Identität).

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

## HTTPS-Route über Caddy (opt-in, eigener Port 4444)

Für Browser im Heimnetz (z. B. die Verwaltungsoberfläche am PC) gibt es eine verschlüsselte Route über das vorhandene Caddy: `https://rpi5.fritz.box:4444` bzw. `https://192.168.178.63:4444`, nur aus `192.168.178.0/24` (sonst 403). Sie ist **ausgeschaltet**, solange du sie nicht aktivierst. Der RC-Weg über `http://192.168.178.63:8081/pilot-login` bleibt unverändert und funktioniert in beiden Modi.

```text
Browser ──https──► Caddy :4444 ──► Web (nginx) :8081 ──► /manage|map|media|wayline|storage|control/api/v1/…  und  /api/v1/ws
                                                       └► Backend :6789 (nur Loopback, wenn DEMO_SAME_ORIGIN=true)
RC (Pilot 2) ──http──► Web :8081 (gleicher Weg, unverschlüsselt)        RC ──MQTT (tcp)──► EMQX :18830 (unverändert)
```

**Warum „gleicher Ursprung“:** Eine HTTPS-Seite darf keine `http://…:6789`-Aufrufe und kein `ws://` öffnen (Mixed Content). Mit `DEMO_SAME_ORIGIN=true` leitet nginx im Web-Container die API-Präfixe des Demo-Backends und den WebSocket an das Backend weiter, und die Seite leitet Basis- und WebSocket-Adresse zur Laufzeit aus ihrer eigenen Adresse ab (gleiches Bundle für `http://<IP>:8081` und `https://<Host>:4444`). Das Backend lauscht dann nur noch auf Loopback, der LAN-Port 6789 entfällt. Unbekannte Pfade werden nicht weitergereicht.

**Aktivieren** (jeder Schritt einzeln; der erste baut das Web-Image neu, das dauert auf dem Pi einige Minuten):

```bash
cd ~/Projekte/SkyHub-Next/ops/cloud-api-demo
sed -i 's/^DEMO_SAME_ORIGIN=.*/DEMO_SAME_ORIGIN=true/' .env     # oder die Zeile von Hand ändern
bash pi-cloud-api-demo.sh preflight
bash pi-cloud-api-demo.sh apply                                  # Web neu bauen, Backend nur noch auf Loopback
sudo bash pi-caddy-cloud-api-demo.sh apply                       # Caddyfile sichern, :4444 ergänzen, validieren, neu laden
bash pi-caddy-cloud-api-demo.sh check                            # wartet bis zu 90 s auf das Backend; erwartet: 200, 200/401/405, 403 von außen, 6789 geschlossen
```

`sudo bash pi-caddy-cloud-api-demo.sh rollback` stellt das Caddyfile von vor `apply` wieder her. Zurück zum alten Modus: `DEMO_SAME_ORIGIN=false` setzen und `pi-cloud-api-demo.sh apply` erneut ausführen. Nach dem Wechsel der Seitenadresse für die RC (`:6789` → `:8081`) muss die Demo-Seite dort einmal neu geöffnet werden; ein erneutes Anmelden kann nötig sein.

**Root-Zertifikat:** Caddy nutzt seine interne CA (`tls internal`). Ein PC-Browser warnt, bis das **öffentliche** Root-Zertifikat installiert ist: `bash pi-caddy-cloud-api-demo.sh ca` gibt es mit Fingerabdruck aus (derselbe Root wie bei `:4443` und `:443`).

**Grenzen:**
- Verschlüsselt ist nur der Browser-Weg. **MQTT (:18830) und die DRC-WebSocket-Verbindung (:18084) bleiben Klartext**; der Browser-DRC (`ws://`) funktioniert von einer HTTPS-Seite aus nicht (Mixed Content). Für die Mavic 3M wird DRC nicht gebraucht.
- Ob die **native** Anbindung der RC (Pilot-2-Module `api`/`ws`) das Caddy-Zertifikat akzeptiert, ist **nicht geprüft**. Deshalb bleibt die RC bei HTTP (:8081).
- Die Prüfung am Caddy-Block war eine reine Syntaxprüfung (`caddy adapt`). Der Proxy-Pfad wurde mit einem Wegwerf-nginx und einem Attrappen-Backend getestet (statisch, REST, WebSocket-Upgrade, 150-MB-Upload, unbekannte Präfixe); **nicht** gegen das echte Backend, den Browser oder die RC.

## Prüfung vom 25.10.2026 (Code-Review des Stacks)

Geprüft wurden Compose, beide Dockerfiles, EMQX-Konfiguration und ACL, das Verwaltungsskript, die erzeugte Konfiguration (ohne Geheimnisse), die Pins der Quellen und der laufende Zustand (nur lesend). In dieser Änderung behoben: Bindung an `0.0.0.0` statt an die LAN-Adresse, Quellen ohne Pin und außerhalb des Projekts, `RUNTIME`-Löschung ohne Pfadprüfung, unvollständige Schwärzung in `logs`, Statusabfragen über Loopback.

**Offen, bewusst nicht geändert (Demo, nur LAN):**

| Befund | Einordnung |
| --- | --- |
| Kein TLS: Anmeldung, JWT und MQTT-Zugangsdaten laufen im Klartext im LAN | Für Browser gibt es die opt-in [HTTPS-Route](#https-route-über-caddy-opt-in-eigener-port-4444). MQTT-TCP (18830) und der RC-Weg bleiben Klartext. |
| Die DJI-App-ID, der Schlüssel und die Lizenz stehen im ausgelieferten Frontend-Bundle | Vom Demo-Design verlangt (JSBridge), für jeden im LAN lesbar. |
| Backend nutzt den MySQL-`root`-Benutzer und sendet `Access-Control-Allow-Origin: *` | Upstream-Code (`CorsFilter`), im Build nicht geändert. |
| EMQX-ACL: `pilot` darf `thing/product/#` und `sys/product/#` lesen und schreiben, also auch fremde Gerätethemen | Für eine einzelne RC unkritisch, bei mehreren Geräten einschränken (`thing/product/<SN>/#`). |
| Eingestellte Software: Spring Boot 2.7, Java 11, Node 16 im Build; Basis-Images mit beweglichen Tags (`mysql:8.0`, `redis:7-alpine`, `nginx:1.27-alpine`, `node:16`, `maven:3.9`), npm-Lockfile über `npmmirror` | Prüfsummen sichern die Pakete. Keine Digest-Pins, bekannte Lücken in EOL-Komponenten möglich. Nur für den LAN-Test vertretbar. |
| `restart: unless-stopped` | Die Demo startet nach einem Neustart des Pi von selbst (seit 26.10.2026, auf Wunsch). Nach `rollback` oder einem manuellen Stopp bleibt sie aus. Das Backend kann kurz nach dem Boot ein paar Mal neu starten, bis MySQL bereit ist. Ein bereits laufender Stack übernimmt die Policy erst nach `apply` oder `docker update --restart unless-stopped $(docker ps -aq --filter label=com.docker.compose.project=cloudapidemo)`. |

## Nachtrag 27.10.2026: MQTT-Benutzer nach dem Reboot verschwunden

**Befund:** Nach dem Reboot am 26.10. meldete das Demo-Backend alle 10 s `Not authorized to connect`; die eingebaute Benutzerdatenbank des EMQX war leer. Ursache: Ohne festen Knotennamen leitet das Image `emqx/emqx:5.3.0` den Namen aus der Container-IP ab (`emqx@172.26.0.2` vor, `emqx@172.26.0.3` nach dem Reboot). Zu jedem Knotennamen gehört ein eigenes Mnesia-Verzeichnis im Volume; mit dem neuen Namen begann EMQX mit einer leeren Datenbank. `node.name` in `emqx/emqx.conf` greift nicht, weil das Image den Namen beim Start setzt.

**Behoben:** `docker-compose.yml` setzt `EMQX_NODE__NAME: emqx@127.0.0.1`; der Name hängt damit nicht mehr von der IP ab. `status` zeigt jetzt die EMQX-Benutzer und ob das Backend angemeldet ist (nur lesend, `provision check`).

**Einmalig nach dem Update** (der neue Name bekommt wieder ein eigenes, leeres Verzeichnis):

```bash
cd ops/cloud-api-demo
bash pi-cloud-api-demo.sh apply    # legt EMQX mit dem neuen Namen an, ruft provision auf (Builds kommen aus dem Cache)
bash pi-cloud-api-demo.sh status   # erwartet: JavaServer, admin, pilot | Backend angemeldet: ja
```

Nur die Benutzer fehlen (Stack sonst unverändert): `bash pi-cloud-api-demo.sh provision`.

Das Backend verbindet sich von selbst neu (es versucht es alle 10 s). Die alten Verzeichnisse `emqx@172.26.0.*` im Volume sind klein und können bleiben.

## Nachtrag 30.10.2026: Watchtower lässt die Demo aus

Alle Demo-Dienste tragen `com.centurylinklabs.watchtower.enable: "false"` (Anker `x-restart`). Watchtower konnte das selbst gebaute
`cloudapidemo-web:local` nicht prüfen und meldete jede Nacht einen Fehlschlag; zugleich holte er neue `mysql:8.0`/`redis:7-alpine` und
startete dabei das Backend neu. Der Web-Container wurde am 30.10. mit dem aktuellen `cloudapidemo-web:local` neu angelegt; das Label
greift nach dem nächsten `bash pi-cloud-api-demo.sh apply`. Updates der Demo nur noch bewusst (`build` und `apply`).

## Umzug vom alten Ort

Der alte Stack unter `~/Projekte/Cloud-API-Demo-Local/stack/` läuft unverändert weiter, bis du umschaltest. Die Volumes (`cloudapidemo_mysql_data`, `cloudapidemo_emqx_data`) behalten ihre Daten, weil Projektname und Volume-Namen gleich bleiben:

```bash
cd ~/Projekte/SkyHub-Next && git pull --ff-only origin main
mkdir -p third_party/dji-cloud-api-demo
cp -p ~/Projekte/Cloud-API-Demo-Local/stack/.env ops/cloud-api-demo/.env        # Geheimnisse übernehmen (600)
mv ~/Projekte/Cloud-API-Demo-Local/DJI-Cloud-API-Demo ~/Projekte/Cloud-API-Demo-Local/Cloud-API-Demo-Web third_party/dji-cloud-api-demo/
cd ops/cloud-api-demo
bash pi-cloud-api-demo.sh preflight        # nur lesen: Bindung, Quellen-Pin, Ports
bash pi-cloud-api-demo.sh apply            # erzeugt die Konfiguration neu und startet die Container neu (kurze Unterbrechung)
```

Alte Pfade in der `.env` (`STACK_DIR`, `DEMO_*_DIR`) schaden nicht, das Skript setzt sie aus seinem Standort selbst. Danach kann `~/Projekte/Cloud-API-Demo-Local/` entfernt werden (die Kopie `Cloud-API-Demo/` ist doppelt). Zurück: `bash pi-cloud-api-demo.sh rollback` (Daten bleiben).
