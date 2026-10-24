# Betriebswerkzeuge – Wirkung und Freigabe

Diese Übersicht bezieht sich auf das **aktive SkyHub-Next-Repository-Root**. Ein Skript im Verzeichnis `scripts/` ist nicht automatisch harmlos; die **Argumente** entscheiden über Schreibzugriffe. Die aktuelle Live-Installation und ihre Konfiguration müssen vor betrieblichen Änderungen erneut geprüft werden.

**CI-/Betriebsgrenze:** GitHub Actions führt eine Reihe von Syntax-, Node-/Python-, Compose- und isolierten Datenbank-/Backup-/Restore-Prüfungen mit Wegwerf-Testumgebungen aus, jedoch keine der hier beschriebenen **Pi-Live-Aktionen** wie EMQX-/Caddy-Apply, Pilot-Pairing, Backend-Update oder Legacy-Übernahme. Ein synthetischer CI-Restore ist kein Restore-Test des echten Pi-Datenbestands. Bei Branch-spezifischen Simulator-/Medien-Workflows deren eigene Schutzgrenzen beachten.

## Wirkungsgruppen

| Tool | Aufruf / Modus | Wirkung | Betriebsregel |
|---|---|---|---|
| `pi-m3m-media-inventory.js` | `node scripts/pi-m3m-media-inventory.js --directory /absoluter/pfad` | **Lokal lesend, opt-in**: unmittelbare Dateinamen, nur aggregierte RGB/G/R/RE/NIR-Zähler | Kein EXIF/XMP, kein S3/MinIO, keine Bildinhalte oder validierte Reflexionswerte; [Grenzen](m3m-offline-media-inventory.md) |
| `pi-preflight.sh` | `bash scripts/pi-preflight.sh` | **Lesend**: Zeit, Listener und Docker-Portzuordnung | Geeignet vor Staging; beweist keine DJI-MQTT-Daten |
| `pi-skyhub-takeover-audit.sh` | `bash scripts/pi-skyhub-takeover-audit.sh` | **Lesend**: Container-, HTTP-, Compose- und Secret-*Status* | Keine Geheimniswerte weitergeben; kein Cutover |
| `pi-tls-audit.sh` | `bash scripts/pi-tls-audit.sh` | **Lesend**: TLS-Zertifikat und CA-Vertrauen | Pi-CA-Vertrauen beweist kein DJI-Android-Vertrauen |
| `pi-mqtt-osd-check.js` | `node scripts/pi-mqtt-osd-check.js` | **Lesend**: HTTP-Diagnose, kein MQTT-Publish | Werte/Zeitstempel nicht mit bestätigtem Flugzustand verwechseln |
| `pi-prepare-staging-env.py` | `python3 scripts/pi-prepare-staging-env.py` | **Lesend**: zeigt fehlende Secret-Schlüssel an | Standard ist Dry-Run |
| `pi-prepare-staging-env.py` | `python3 scripts/pi-prepare-staging-env.py --apply` | **Lokale Schreibaktion**: Backup und Änderung der privaten `.env` | Nur nach Prüfung von Datei, Rechten und Sicherung |
| `pi-backup-legacy.sh` | `bash scripts/pi-backup-legacy.sh` | **Dateischreibend**: PostgreSQL-Dump, Redis-RDB-Kopie, Manifest | Keine Containerstopps; Sicherung und Wiederherstellung gesondert validieren |
| `pi-caddy-lan-dashboard.sh` | `bash scripts/pi-caddy-lan-dashboard.sh print` | **Lesend**: geplanten Caddy-Block anzeigen | Keine Prüfung realer TLS-Vertrauensstellung |
| `pi-caddy-lan-dashboard.sh` | `bash scripts/pi-caddy-lan-dashboard.sh check` | **Lesend**: HTTP-Reachability; nutzt `curl -k` ausschließlich diagnostisch | Kein TLS-Trust-Nachweis |
| `pi-caddy-lan-dashboard.sh` | `sudo bash scripts/pi-caddy-lan-dashboard.sh apply` / `rollback` | **Live-Änderung**: Caddyfile schreiben, Caddy reload | Nur mit vorher geprüftem Backup und Rollback |
| `pi-mosquitto-dedicated.js` | `plan` / `verify` / `init-env` (Trockenlauf) | **Lesend bzw. aktive Probe**: ACL anzeigen; `verify` verbindet Probe-Clients und veröffentlicht nur Probe-Topics (`skyhub/probe/#`, `status_reply`, `requests`), die das Backend nicht ingestiert | Keine Zugangsdaten veröffentlichen; Profil [mosquitto-dedicated](pi-mosquitto-migration.md) |
| `pi-mosquitto-dedicated.js` | `init-env --write` | **Lokale Schreibaktion**: ergänzt fehlende `MQTT_USER`/`MQTT_PASSWORD` in `.env` mit Sicherung (0600) | Vorhandene Werte bleiben unangetastet |
| `pi-mosquitto-dedicated.js` | `sudo ... apply` / `rollback` / `status` | **Live-Änderung** (apply/rollback): eigene systemd-Unit `skyhub-mosquitto` auf 1884, Auto-Rollback bei Fehlern; Broker 1883 und `.env` bleiben unberührt | Sicherheitskritisch; nach `apply` Umstellung von `.env`/Backend manuell |
| `pi-emqx-harden.js` | `node scripts/pi-emqx-harden.js plan` | **Lesend**: prüft lokale Rollen und gibt geplante ACL aus | Keine Zugangsdaten veröffentlichen |
| `pi-emqx-harden.js` | `node scripts/pi-emqx-harden.js verify` | **Aktiver MQTT-Test**: verbindet Probes und prüft Berechtigungen | Keine Broker-ACL-Änderung, aber Netzwerkverkehr |
| `pi-emqx-harden.js` | `node scripts/pi-emqx-harden.js apply` / `rollback` | **Live-Änderung**: EMQX-Authentifizierung/ACL; Rollback setzt historischen anonymen Zugang und Allow-all wieder | Sicherheitskritisch; niemals als generischen Cleanup ausführen |
| `pi-pilot-pair.js` | `node scripts/pi-pilot-pair.js` | **Lesend**: zeigt ausstehende Codes und Gerätekennungen | Ausgabe vertraulich behandeln |
| `pi-pilot-pair.js` | `node scripts/pi-pilot-pair.js 123456` / `--revoke <device-id>` | **Live-Änderung**: Gerät koppeln oder widerrufen | Nur mit Freigabe des Geräteverantwortlichen |
| `build-hms-texts.js` | `node scripts/build-hms-texts.js <hms.json>` | **Dateischreibend**: erzeugt `backend/data/hms-texts.json` | Nur mit geprüftem DJI-HMS-Quelldokument und Lizenz |
| `stacks/legacy-skyhub/scripts/migrate-env.sh` | **Nicht ausführen** | Historisches Migrationswerkzeug des archivierten Stacks | Kein Teil der aktiven SkyHub-Next-Betriebslogik |

## Reale Betriebspfade

- **Diagnose:** `pi-preflight.sh` und `pi-skyhub-takeover-audit.sh` ergänzen sich. Preflight kontrolliert die erreichbare lokale Topologie; das Takeover-Audit prüft zusätzlich Legacy-Container, HTTP und Staging-Konfiguration. Beide bleiben eigenständige Tools.
- **Sicherung:** `pi-backup-legacy.sh` schreibt lokale Sicherungsdateien. Es ist **kein** allgemeines Rollback-Skript und ersetzt keinen Restore-Test.
- **Netzwerk & Trust:** `pi-tls-audit.sh` diagnostiziert CA-Vertrauen, während `pi-caddy-lan-dashboard.sh` einen optionalen LAN-Zugang verwaltet. Die Zuständigkeiten überschneiden sich nicht.
- **DJI-MQTT:** `pi-mqtt-osd-check.js` liest Telemetrie-Zähler. `pi-emqx-harden.js` verändert bei `apply` aktiv Broker-Authentifizierung und -Autorisierung. Diese Aufgaben **niemals** in einem Cleanup zusammenführen.
- **Geräteverwaltung:** `pi-pilot-pair.js` hat schreibende Funktionen zur Pilot-2-Kopplung. Ein Listenaufruf ist keine Freigabe für Approve oder Revoke.
- **Konfiguration:** `pi-prepare-staging-env.py` arbeitet ausschließlich an der lokalen SkyHub-Next-`.env`; vorhandene DJI-/MQTT-Credentials bleiben unverändert.

## Bewusst nicht automatisiert

Es gibt keine CI-Schritte, die `pi-caddy-lan-dashboard.sh apply`, `pi-emqx-harden.js apply`, `pi-pilot-pair.js` oder den Legacy-Compose ausführen. Der laufende SkyHub-Dienst bleibt bis zu einem ausdrücklich geprüften und freigegebenen Cutover eigenständig.

**Weitere Details:** [Betrieb](ops.md), [Sicherheit](security.md), [Legacy-Migration](legacy-migration.md), [Cutover-Plan](skyhub-legacy-takeover.md) und [DJI MQTT](mqtt-osd-integration.md).
