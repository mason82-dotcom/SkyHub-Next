# Betrieb, Diagnose und Entwicklung – SkyHub Next

**Wichtig:** Die folgenden Pi-Zustände und Portbelegungen wurden am 20.10.2026 dokumentiert; sie ersetzen keine erneute Prüfung am Zielsystem. Dieser Text unterscheidet zwischen lesenden Diagnosebefehlen und Befehlen, die Container/Dateien verändern. Ein Git-Checkout oder ein Merge nimmt **keinen** automatischen Cutover vor.

**Repository-Stichtag:** [Projektstand 23.10.2026](projektstand-2026-10-23.md), Main-Commit `496a1f84f22b15f85ad5442965b2cd218a93969a`. Die bis dahin hinzugekommenen Feature-PRs und in den Integrationsbranch übernommenen UI-PRs sind **kein** automatisches Upgrade dieser Root-Compose-Installation. Die folgenden historischen Hardwareangaben behalten ihr jeweiliges Datum.

**Betriebsgrenzen:****Opt-in-Brokerprofil:** [Anleitung EMQX/1884 oder Mosquitto/1883](pi-mosquitto-migration.md). Im Code existiert nun ein explizites Mosquitto-Profil mit Port-/Pilot-Konsistenzprüfung. Historische EMQX-Beobachtungen in diesem Dokument bleiben historische Nachweise, keine aktuelle Pi-Bestätigung. Für manuelle Mosquitto-Prüfung `bash scripts/pi-preflight.sh --broker-kind mosquitto --broker-port 1883` verwenden. Das Backend-Updateskript bestimmt das Profil aus dem gerenderten Compose und startet keinen Broker.

**Aktualisierungswarnung 23.10.2026:** Nach dem zuletzt vom Betreiber gemeldeten Stand wurde EMQX auf dem Raspberry Pi entfernt; Mosquitto lauscht auf Port 1883. Das vorliegende `main` verlangt dagegen weiterhin EMQX auf 1884: `scripts/pi-preflight.sh` prüft zusätzlich den Containernamen `skyhub_emqx`, und `scripts/pi-update-backend.sh --apply` ruft diesen Preflight auf. Dieser Konflikt ist durch die GitHub-Merges #89/#65 **nicht** behoben. Vor einem Live-Backend-Rebuild Broker-/Topic-/ACL-Vertrag und tatsächliche Pi-Listener erneut prüfen; bei Fehlschlag nur Git und nichtschreibende Tests aktualisieren. Nicht durch Starten des archivierten EMQX oder ungetestetes Umschalten der Ports umgehen.

 Das Root-Compose ist `skyhub-next` mit Backend-Hostport `127.0.0.1:4001`; der vorhandene Broker ist auf Hostport `1884`. Der bisherige produktive Backend-Hostport `4000` darf nicht ungeprüft übernommen werden. Das Compose im Legacy-Snapshot darf nicht gestartet werden.

**Wirkung von Pi-Skripten und Freigaben:** [Betriebswerkzeuge](scripts.md). `apply`-, `rollback`- und Kopplungsaufrufe nicht mit lesenden Diagnosen verwechseln.

**Querverweise:** [Sicherheit](security.md), [Architektur](architecture.md), [Konfiguration](config-reference.md), [API-Referenz](api-reference.md), [MQTT/OSD](mqtt-osd-integration.md), [kontrollierte Migration](legacy-migration.md).

## Entwicklung auf dem Pi (nicht die produktive Python-Installation überschreiben!)

    # Nur bei einer echten Neuinstallation; vorhandenes Projekt NICHT überschreiben.
    if [ ! -e ~/Projekte/SkyHub-Next ]; then
      git clone --branch main https://github.com/mason82-dotcom/SkyHub-Next.git ~/Projekte/SkyHub-Next
    fi
    cd ~/Projekte/SkyHub-Next
    # Nur falls .env noch nicht existiert:
    test -e .env || cp -n .env.example .env

**Vorhandene Installationen:** kein neues Clone, kein `cp` über bestehende `.env`, keinen lokalen Branch ohne sauberen Arbeitsbaum wechseln. Für ein bestehendes Pi-System zunächst nur `git status --short --branch`, `docker compose -p skyhub-next ps` und [Preflight](scripts.md) lesen; neue Funktionen werden nicht automatisch deployed.

Die Datei `.env` bei erstmaliger Inbetriebnahme lokal bearbeiten. Alle `REPLACE_*`-Platzhalter ersetzen. Zufallstokens/Passwörter mit openssl rand -hex 32 erzeugen. **Für den Raspberry Pi ist MQTT-Port 1884 verbindlich**: `MQTT_BROKER_URL=mqtt://host.docker.internal:1884`. Nutzername und Passwort des vorhandenen Pi-Brokers in MQTT_USER und MQTT_PASSWORD eintragen. SkyHub Next startet keinen eigenen MQTT-Broker und belegt weder Host-Port 1883 noch 1884. `SKYHUB_MQTT_REQUIRED_PORT=1884` im Pi-Compose verhindert den versehentlichen Betrieb mit einem anderen Port. MinIO wird erst mit docker compose --profile media up -d minio gestartet, da die Medien-API noch aussteht. Das separate System benötigt keinen eigenen EMQX-Broker und belegt keine bestehenden DJI-Dienstports. Auf dem Pi läuft das bestehende `skyhub_backend` bereits auf **4000**. Deshalb verwendet SkyHub Next standardmäßig den Host-Port **4001** (intern weiterhin 4000) und lauscht nur auf `127.0.0.1`. Vor jedem Start mit dem beigefügten Preflight-Skript kontrollieren, dass auch 4001 frei ist. Eine bereits vorhandene lokale `.env` mit `SKYHUB_HTTP_PORT=4000` muss manuell angepasst werden; sie wird nicht automatisch überschrieben.

**Nur nach eigener, aktueller Prüfung** von SSD/NVMe-Gesundheit, Ressourcen, Sicherungen, Portbelegung, Git-Arbeitsbaum und Compose-Konfiguration (die älteren NVMe-Befunde sind keine Aussage über den Zustand am 23.10.2026):

    docker compose config --quiet
    docker compose up -d --build
    curl -s http://127.0.0.1:4001/api/health
    docker compose logs --tail=60 backend

Der Gesundheitsendpunkt meldet unter anderem `mqttBrokerPort: 1884`, `mqtt`,
`subscribed`, `mqttLastMessageAt`, `mqttAcceptedMessages` und
`mqttRejectedMessages`, `mqttChannelCounts`, `mqttLastOsdAt`,
`mqttLastTelemetryAt` und `mqttValidTelemetryUpdates`. `mqtt: true` belegt nur
die MQTT-Verbindung, `subscribed: true` bestätigte Abonnements. Erst
`mqttLastMessageAt` zeigt empfangene, erkannte DJI-Topic-Nachrichten;
`mqttLastOsdAt` zeigt OSD-Pakete; `mqttLastTelemetryAt` zeigt den letzten
verwertbaren, vom Registry übernommenen OSD-Messwert. Diese drei Zustände
sind ausdrücklich **nicht** gleichzusetzen. Die Zähler der Health-API
enthalten keine Seriennummern, Nutzdaten oder Anmeldedaten.

### Bestehende Raspberry-Pi-Broker- und Porttopologie (20.10.2026)

Die lesend ermittelte Host-Konfiguration:

- `skyhub_emqx`: Host-TCP **1884** → EMQX-Container-TCP **1883**.
- `mosquitto`: eigenständiger Host-Broker auf TCP **1883**. Nicht mit EMQX gleichsetzen; ohne Bridge werden keine Topics synchronisiert.
- `skyhub_backend`: bestehende produktive HTTP-Portfreigabe **4000**.
- `skyhub-next`: bewusst eigener Compose-Projektname; geplanter **4001** am Host (Loopback), **4000** nur innerhalb des neuen Backend-Containers.

Nur die EMQX-Verbindung auf Port 1884 konfigurieren; den alten Mosquitto weder stoppen noch umkonfigurieren. Dass der Port lauscht, beweist **nicht**, dass sich DJI Pilot 2 korrekt anmeldet oder dass OSD-Nachrichten ankommen.

Vor der Inbetriebnahme ohne Änderungen an laufenden Diensten:

    bash scripts/pi-preflight.sh

### EMQX-Istzustand aus der Pi-Diagnose

Am 20.10.2026 wurden 2 aktive Clients, 6 Subscriptions mit
`thing/product/`-Muster und 0 `sys/product/`-Subscriptions gemeldet.
Das beweist weder, dass die verbundenen Clients DJI-Fernsteuerungen
sind, noch den Eingang von Telemetrie. Da SkyHub Next noch nicht läuft,
ist sein zusätzliches `sys/product/+/status`-Abo noch nicht vorhanden.
Das bisherige Backend auf Host-Port 4000 liefert für
`GET /api/health` die HTML-Antwort `Cannot GET /api/health`,
weil die ältere Implementierung diesen Endpunkt nicht definiert;
das ist kein Nachweis eines Ausfalls.

Nächste **lesende** Überprüfung (vor Start der neuen Umgebung):

    docker exec skyhub_emqx emqx ctl broker metrics | grep -E 'messages\\.(received|delivered)|packets\\.publish\\.received'
    docker exec skyhub_emqx emqx ctl clients list

Die Client-Liste kann Gerätekennungen, Benutzernamen und Netzwerkadressen
enthalten; vor dem Teilen bereinigen. Diese Broker-Zähler sind
aggregiert und können auch Nicht-DJI-MQTT-Verkehr enthalten. Nur eine
separate Prüfung der Zeitdifferenz bzw. der SkyHub-Next-Live-Zähler kann
neue Nachrichten belegen.

### Diagnose bei MQTT-Verbindungsfehlern auf dem Raspberry Pi

    sudo ss -ltnp | grep ':1884'
    docker compose logs --tail=60 backend

Der MQTT-Broker muss TCP 1884 auf einer vom Container erreichbaren Host-Adresse
anbieten. Ein Dienst, der ausschließlich an `127.0.0.1:1884` lauscht, ist
über `host.docker.internal` aus einem Bridge-Container üblicherweise **nicht**
erreichbar. Prüfen Sie deshalb zuerst Bind-Adresse, Broker-ACL und Firewall.
Port 1883 muss weder umgebogen noch abgeschaltet werden. Bei einer anderen
Pi-Adresse darf der Hostname in `MQTT_BROKER_URL` angepasst werden, der Port
bleibt 1884. Die Portprüfung testet die **Konfiguration**, nicht die tatsächliche
Erreichbarkeit; die bestätigt erst der MQTT-Verbindungsstatus.


Remote-Tunnel vom PC:

    ssh -L 4001:127.0.0.1:4001 mason@rpi5.local

Dann http://127.0.0.1:4001 öffnen, SKYHUB_VIEW_TOKEN aus .env eingeben. Token verbleibt nur im Speicher des Browsers bis zum Neuladen.

**DJI-Diagnosekorrektur (23.10.2026):** Der HTTP-400-Validierungsfehler für gültige Modellkennungen wurde in [PR #61](https://github.com/mason82-dotcom/SkyHub-Next/pull/61) nach `main` übernommen und durch echte HTTP-Regressionstests abgesichert. Eine weiterhin mit altem Image laufende Pi-Installation kann den historischen Fehler bis zum ausdrücklich freigegebenen Backend-Update noch zeigen. **Keine automatische Aktualisierung oder Gerätefreigabe durch den GitHub-Merge.**

## Tests

Der Backend-Testlauf benötigt installierte Abhängigkeiten. `npm ci` schreibt
**nur** in `backend/node_modules/` und darf ausschließlich im dafür vorgesehenen
Entwicklungscheckout ausgeführt werden (nicht als angeblich rein lesende Diagnose).
Die folgenden Tests starten keine produktiven Container oder DJI-Kommandos.

    npm ci --prefix backend --ignore-scripts --no-audit --no-fund
    node --check backend/server.js
    node --check backend/dji.js
    node --check backend/mqtt-metrics.js
    npm test --prefix backend
    python3 -m unittest discover -s tests -p 'test_*.py'
    docker compose --env-file .env.example config --quiet

## MQTT/OSD-Adapter (Version 0.1.0)

Der vorhandene EMQX-Broker auf Host-Port **1884** bleibt bestehen. Der Open-Source-Referenzclient von Ömer Mersin wurde ausgewertet; übernommen wurden das Konzept des expliziten DJI-`thingConnect()`-Wiederholungsversuchs und die getrennte OSD-Eingangsdiagnose – **nicht** dessen separater EMQX-Container, breiten Topic-Subscriptions oder ungeschützte Konfigurations-API.

Bei getrennt gemeldetem MQTT-Status bietet DJI Pilot 2 den Button **„MQTT erneut verbinden“**. Kein automatisches Reconnect-Spamming und keine Geheimnisse in Statusmeldungen. Der Backend-Health-Endpunkt unterscheidet `mqttObservedOsdPackets` (roh empfangene Topics), `mqttOsdMessages` (übernommene OSD) und `mqttValidTelemetryUpdates` (verwertbare Daten). Die Diagnose liest keine Rohdaten aus.

Nach einem kontrollierten Deployment auf dem Pi: `node scripts/pi-mqtt-osd-check.js` (Standardport 4001). Für Konfiguration, Grenzen, Quellennachweis und Prüfablauf siehe [MQTT/OSD-Integration](mqtt-osd-integration.md).

## Hardware-Befund 20.10.2026: RC Pro verbunden, kein OSD

Die DJI RC Pro Enterprise ist als Gateway an EMQX angemeldet und sendet
`update_topo` sowie `state`, aber **kein OSD**. SkyHub hatte nie ein
`status_reply` gesendet (Topologie-Bestätigung war aus); Pilot 2 wiederholt
`update_topo` dann und sendet kein OSD. Das Diagnoseskript erkennt diesen Fall
jetzt ausdrücklich. Neu: `GET /api/diagnostics/mqtt-shapes` (Token nötig)
zeigt pro Kanal/Methode nur die empfangenen Feldnamen, keine Werte oder
Seriennummern. Zusätzliche OSD-Felder: GNSS-/RTK-Satelliten und Fix-Status,
Lage, Home-Distanz, Restflugzeit, RC-Funkqualität.

**Sicherheitsbefund:** Der bestehende EMQX auf 1884 erlaubt anonyme Anmeldung
und hat `{allow, all}` als ACL. Die vorgesehene Publish-only-Beschränkung des
Topologie-Publishers wird dadurch noch nicht durchgesetzt. Details und
Vorgehen: [MQTT/OSD-Integration](mqtt-osd-integration.md).

**Ergebnis nach Aktivierung der Topologie-Bestätigung (22:07):** Die RC Pro
sendet OSD (Akku, Position, Ellipsoidhöhe, Funkqualität), frisch und zeitlich
verifiziert.

## Pilot 2 ohne manuelles Token

Die Seite `/pilot-login` koppelt jede RC einmalig: Sie zeigt einen 6-stelligen
Code, der auf dem Pi mit `node scripts/pi-pilot-pair.js <code>` bestätigt
wird. Danach verbindet sich die RC bei jedem Öffnen automatisch, lädt das
Cloud-Modul nur bei Bedarf und baut eine unbestätigte Sitzung selbst neu auf.
Übersicht und Widerruf: `node scripts/pi-pilot-pair.js` bzw. `--revoke <id>`.
Details: [MQTT/OSD-Integration](mqtt-osd-integration.md#pilot-2-connection-sequence-handshake).

## Neustart-Test (20.10.2026)

Nach einem Neustart von Pilot 2 und RC hat sich die gekoppelte RC ohne neuen
Kopplungscode und ohne Öffnen der Cloud-Seite selbst wieder mit EMQX verbunden
(Anmeldung mit Passwort, alle Abos genehmigt). Ihre Topologie wurde sofort
bestätigt, OSD von RC und Mavic 3M lief nach rund 70 s wieder. Pilot 2 behält
die Cloud-Verbindung samt Zugangsdaten über Neustarts; die Pilot-Seite ist nur
für die Ersteinrichtung nötig. Details:
[MQTT/OSD-Integration](mqtt-osd-integration.md#restart-test-2026-10-20-pilot-2-and-rc-restarted-after-pairing).


## Sicheres Backend-Update nach GitHub-Merge (21.10.2026)

Das Repo enthält `scripts/pi-update-backend.sh` als **ausdrücklich zustimmungspflichtigen lokalen** Pi-Updatepfad. **Das GitHub-Merge allein installiert nichts auf dem Pi.** Das Skript benötigt eine bereits laufende `skyhub-next`-Compose-Installation, Linux ARM64, einen sauberen lokalen `main`-Checkout sowie einen zuvor synchronisierten `origin/main`. Es gibt weder ein hartes Zurücksetzen von lokalen Git-Dateien noch ein automatisches Überschreiben der lokalen `.env`.

Auf dem Pi zunächst den lokalen Zustand nur lesend prüfen (Ausgaben vor dem Branchwechsel auf Konflikte untersuchen):

```bash
cd ~/Projekte/SkyHub-Next
git status --short --branch
git remote -v
docker compose -p skyhub-next ps
bash scripts/pi-preflight.sh
```

**Nur bei sauberem Git-Arbeitsbaum und bestehender Next-Installation** anschließend aktualisieren:

```bash
cd ~/Projekte/SkyHub-Next
git fetch origin main
git switch main
git pull --ff-only origin main
bash scripts/pi-update-backend.sh --apply
```

Vor der Backend-Neuerstellung kopiert das Skript `.env` und den optionalen `docker-compose.override.yml` in ein privates Sicherungsverzeichnis unter `~/Projekte/_backups/skyhub-next/`, sichert das bestehende Backend-Image unter einem Zeitstempel-Tag und erstellt einen **echten `pg_dump -Fc`** aus der bestehenden Datenbank. Bei fehlender Datenbank, fehlgeschlagenem Backup, unerwartetem Containernamen oder Preflight-Fehler wird vor der Backend-Neuerstellung abgebrochen. Es verwendet `docker compose build backend` und `docker compose up -d --no-deps --no-build backend` – nicht `docker compose down`, nicht `--remove-orphans` und **nie `-v`**. Dadurch wird nur das vorhandene Next-Backend neu erstellt. Weder die optionale DJI-Migration 001/002 noch ein DJI-Karten-Schreibpfad wird angewendet oder aktiviert. Das Health-API muss danach lesend erreichbar sein.

**Grenzen:** Es werden nicht sämtliche Redis-Persistenzdateien oder MinIO-Objekte gesichert; sie werden bei diesem Backend-Update auch nicht neu gestartet. Ein `pg_dump` ist ein Datenbank-Backup, **kein** vollständiger Restore-Test auf dem Pi. Die Aufnahme der Sicherung erfolgt auf dem Pi und enthält echte sensible Daten; niemals mit Chat oder GitHub teilen. Das Skript nimmt kein neues Caddy-/EMQX-Setup vor und verlangt keinen Export von Broker- oder DJI-Geheimnissen. Es führt keinen automatischen Rollback nach einem fehlgeschlagenen Health-Test durch, bewahrt aber den vorherigen Backend-Image-Tag für eine gezielte Wiederherstellung.

Bei lokal veränderten versionierten Dateien, Konflikten beim `git switch` oder einem abweichenden Compose-Layout **abbrechen, nicht `git reset --hard` oder `git clean` ausführen**. Stattdessen lokalen Stand prüfen und das Update anpassen. Nach der Installation: `docker compose -p skyhub-next logs --tail=80 backend`, `curl -fsS http://127.0.0.1:4001/api/health` und die DJI-OSD-Diagnose getrennt ausführen. Ein erfolgreicher Health-Test ersetzt keine RC-/Drohnen-Hardwareabnahme.
