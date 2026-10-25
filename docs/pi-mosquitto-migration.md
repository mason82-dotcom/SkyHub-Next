# Raspberry Pi 5: MQTT-Brokerprofil EMQX/1884 oder Mosquitto/1883

**Stand 23.10.2026 · Sicherheitsstufe: Opt-in / keine automatische Live-Migration**

## Istzustand und Grenzen

SkyHub Next betreibt selbst keinen MQTT-Broker. Das historische Profil
`emqx/1884` bleibt in `.env.example` und Docker Compose der Standard.
Für den zuletzt vom Betreiber beschriebenen Pi-Zustand (lokaler Mosquitto
auf TCP 1883, EMQX entfernt) ist das Profil `mosquitto/1883` vorgesehen.
Dies bestätigt **nicht** den aktuellen Zustand des Pi. Ein Git-Merge oder
ein grüner GitHub-Test nimmt weder eine Broker- noch eine Gerätemigration vor.

| Konfiguration | EMQX (Legacy) | Mosquitto (Opt-in) |
| --- | --- | --- |
| `SKYHUB_MQTT_BROKER_KIND` | `emqx` | `mosquitto` |
| `SKYHUB_MQTT_REQUIRED_PORT` | `1884` | `1883` |
| `MQTT_BROKER_URL` | `mqtt://host.docker.internal:1884` | `mqtt://host.docker.internal:1883` |
| `SKYHUB_PILOT_MQTT_URL` | `mqtt://<Pi-LAN-IP>:1884` | `mqtt://<Pi-LAN-IP>:1883` |

Der Hostname `host.docker.internal` ist ausschließlich für den **Docker-Backendclient**.
Für DJI Pilot 2 muss eine tatsächlich vom Controller erreichbare Pi-LAN-Adresse
verwendet werden. Werden Brokerart, Pin oder Endpoint-Port widersprüchlich gesetzt,
lehnt die Servervalidierung die Konfiguration ab; die Pilot-Konfiguration ist
nicht bereit. MQTT/TLS wird nicht automatisch aktiviert.

## Nur lesen: Befund vor jedem Änderungsversuch

```bash
cd ~/Projekte/SkyHub-Next
git status --short --branch
docker compose -p skyhub-next ps
sudo ss -ltnp | grep -E ':(1883|1884|4000|4001)\b' || true
systemctl is-active mosquitto
bash scripts/pi-preflight.sh --broker-kind mosquitto --broker-port 1883
```

Das mosquitto-Profil verlangt systemd-`mosquitto` und einen
**nicht nur an 127.0.0.1/::1 gebundenen Listener** auf 1883.
Nur `ss` reicht nicht: Docker-Host-Gateway-Erreichbarkeit, Firewall,
MQTT-Authentifizierung, Topic-ACL und tatsächliche OSD-Verarbeitung sind
danach immer noch **nicht nachgewiesen**. Beim EMQX-Profil muss wie bisher
die Abbildung `skyhub_emqx:1883 -> Pi:1884` nachweisbar sein.

## Private Konfiguration: ausschließlich nach Broker-/ACL-Prüfung

1. Lokale `.env` und `docker-compose.override.yml` vor Änderung **privat**
   sichern. Weder Zugangsdaten noch komplette Compose-JSON-Ausgaben posten.
2. Prüfen, ob Pilot 2 und SkyHub auf **demselben Broker** landen und
   ob Mosquitto wirklich MQTT v5, Authentifizierung und die fünf eng
   begrenzten SkyHub-Subscriptions erlaubt:
   `sys/product/+/status`, `thing/product/+/osd`,
   `thing/product/+/state`, `thing/product/+/events`,
   `thing/product/+/services_reply`.
3. Nur falls die DJI-Topologie-Antwort gesondert freigegeben ist:
   getrenntes Publisher-Konto mit ausschließlich
   `sys/product/+/status_reply`-Schreibberechtigung nachweisen.
   Niemals `allow_anonymous true` oder allgemeine `#`-Publish-ACL
   als schnelle Reparatur einsetzen.
4. In der **bereits vorhandenen lokalen** `.env` die vier Werte der
   Mosquitto-Spalte gemeinsam setzen. Vorhandene DJI-Lizenzwerte, Tokens
   und Passwörter unangetastet lassen. Pilot 2 nur aktivieren, wenn der
   tatsächliche RC-Endpunkt/HTTPS/ACL gesondert validiert ist.
5. Rein statische Konfigurationsprüfung durchführen:

```bash
cd ~/Projekte/SkyHub-Next
docker compose -p skyhub-next --env-file .env config --quiet
bash scripts/pi-preflight.sh --broker-kind mosquitto --broker-port 1883
node --test backend/test/mqtt-config.test.js backend/test/pilot-config.test.js
python3 -m unittest discover -s tests -p 'test_pi_broker_preflight.py'
```

Erst nach abgeschlossener Broker-/Topic-/Pilot-2-Abnahme und DB-/Env-Backup:
`bash scripts/pi-update-backend.sh --apply`.
Das Update-Skript liest das **gerenderte Compose-Modell** und führt
kein `source .env` aus. Der Port-Preflight läuft vor jedem Backup oder Rebuild.
Er darf dennoch nicht als End-to-End-Broker/RC-Freigabe missverstanden werden.
Danach **nur lesende** Gesundheitsprüfung mit
`curl -fsS http://127.0.0.1:4001/api/health` und
`node scripts/pi-mqtt-osd-check.js`.

## Rollback und Nicht-Ziele

Das Backend-Updateskript archiviert das vorherige Image und erstellt einen
PostgreSQL-Dump; es führt keinen automatischen Image-Rollback aus und ändert
weder Mosquitto noch EMQX. Ein Rollback darf den vorab dokumentierten Broker,
die zugehörige private `.env` und die RC-Konfiguration nicht auseinanderziehen.
Kein `docker compose down -v`, kein Neustart des Legacy-Compose, kein
fliegerischer Funktionstest und kein stilles Umschalten von DJI Pilot 2.


## Profil `mosquitto-dedicated`: eigene authentifizierte Instanz auf 1884

**Stand 24.10.2026 · Opt-in.** Der bestehende Host-Mosquitto auf 1883 (Xiaozhi, `allow_anonymous true`)
bleibt unverändert. Zusätzlich läuft eine **zweite, eigene Mosquitto-Instanz** (systemd-Unit
`skyhub-mosquitto`, Konfiguration unter `/etc/skyhub-mosquitto`) auf TCP **1884** mit Passwortdatei
(PBKDF2-SHA512) und Topic-ACL. Der Port passt zu bereits ausgelieferten RC-Konfigurationen.

| Konfiguration | Wert |
| --- | --- |
| `SKYHUB_MQTT_BROKER_KIND` | `mosquitto-dedicated` |
| `SKYHUB_MQTT_REQUIRED_PORT` | `1884` |
| `MQTT_BROKER_URL` | `mqtt://host.docker.internal:1884` |
| `SKYHUB_PILOT_MQTT_URL` | `mqtt://<Pi-LAN-IP>:1884` |

Die Rollen entsprechen der EMQX-Härtung: `MQTT_USER` (nur die fünf SkyHub-Abos), Topologie-Publisher
(nur `sys/product/+/status_reply`) und Pilot-Konto (Gerät → Cloud schreiben, Cloud → Gerät lesen).
Alles Übrige ist verweigert.

**Wichtig:** Mosquitto (`acl_file`) quittiert Wildcard-Subscriptions mit Erfolg und filtert erst bei der
Zustellung. SUBACK-Codes beweisen deshalb keine ACL. `verify` prüft daher die tatsächliche Zustellung
(alle drei Rollen abonnieren `#`, jede darf nur ihre Lese-Topics erhalten).

```bash
cd ~/Projekte/SkyHub-Next
node scripts/pi-mosquitto-dedicated.js plan                 # ACL ohne Geheimnisse
node scripts/pi-mosquitto-dedicated.js init-env             # Trockenlauf; --write ergänzt MQTT_USER/MQTT_PASSWORD
sudo node scripts/pi-mosquitto-dedicated.js apply           # Unit anlegen, prüfen, bei Fehler Rollback
node scripts/pi-mosquitto-dedicated.js verify               # Login- und Zustellprobe aus dem Backend-Container
sudo node scripts/pi-mosquitto-dedicated.js status          # Verbindungen je Benutzer/IP der letzten 30 min
sudo node scripts/pi-mosquitto-dedicated.js rollback        # Unit und /etc/skyhub-mosquitto entfernen
```

`apply` ändert weder `.env` noch das SkyHub-Backend. Die Umstellung der vier Werte erfolgt danach
manuell mit `bash scripts/pi-preflight.sh --broker-kind mosquitto-dedicated --broker-port 1884` und
`bash scripts/pi-update-backend.sh --apply`. Die Brokerprobe veröffentlicht nur Topics, die das Backend nicht abonniert
(`status_reply`, `requests` und den Probe-Namensraum `skyhub/probe/#`, den nur der Reader lesen und nur das Pilot-Konto
schreiben darf). Ein Test (`backend/test/mosquitto-dedicated-probe.test.js`) stellt sicher, dass kein Probe-Topic zu den
Abos des Backends passt; andernfalls legt das Backend ein Geisterobjekt `SKYHUBPROBE` im Geräte-Register an.
Nach einer Änderung am Skript oder an der ACL gilt die neue ACL erst nach erneutem `sudo node scripts/pi-mosquitto-dedicated.js apply`. Firewall, DJI-Pilot-2-Annahme und echte
OSD-Verarbeitung bleiben ungeprüft, bis die RC nachweislich Telemetrie liefert.
