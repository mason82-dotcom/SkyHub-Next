# Konfigurationsreferenz – SkyHub Next (Korrekturabgleich 25.10.2026)

> **Historische Tabellenbasis:** `main` @ `496a1f84f22b15f85ad5442965b2cd218a93969a`. **Aktueller Code-Korrekturabgleich:** [`662cb94d`](stand-2026-10-25-main-audit.md), insbesondere `backend/mqtt-config.js`, `backend/server.js` und `docker-compose.yml`. Die Tabelle wurde gegen `.env.example`, `docker-compose.yml`, `backend/server.js`, `backend/pilot-config.js` und die zugehörigen Module geprüft. Angaben gelten **nicht automatisch** für offen gestapelte PRs oder individuell konfigurierte Pi-Overrides. [Projektstatus](projektstand-2026-10-23.md).

## Geltungsbereich und Priorität

**Brokerprofil (Nachtrag 23.10.2026):** Compose reicht jetzt `SKYHUB_MQTT_BROKER_KIND` (Default `emqx`) und `SKYHUB_MQTT_REQUIRED_PORT` (Default `1884`) an das Backend durch. Erlaubte Paare sind `emqx/1884`, `mosquitto/1883` **und `mosquitto-dedicated/1884`**; der MQTT-Endpunkt muss denselben Port verwenden. Für Pilot 2 gilt die RC-erreichbare LAN-Adresse mit derselben Portbindung. Die alte Tabellenangabe „Compose fest: 1884“ unten bezeichnet den historischen Stand; die verbindliche aktuelle Anleitung steht unter [Mosquitto-Migration](pi-mosquitto-migration.md). Keine Änderung an laufenden Broker-Diensten.

- `.env` ist **lokal und privat**, wird nicht versioniert, und muss bei Änderungen gegen das **tatsächlich verwendete** Compose/Override geprüft werden.
- Compose interpoliert Host-Variablen in Container-Umgebung. **Eine Variable in `.env` ist erst dann im Backend vorhanden, wenn Compose/Override sie weitergibt.** Die Beispiel-`.env` ist **kein** bereites Deployment.
- Der Root-Compose-Projektname lautet `skyhub-next`. Bestehende Dienste anderer Compose-Projekte werden nicht automatisch aktualisiert. Standard-Backend-Port **Host 127.0.0.1:4001 → Container 4000**, bestehender Pi-Broker **EMQX/1884 (Default) oder Mosquitto/1883 (Opt-in)**.
- Die optionalen Fähigkeiten sind **nicht automatisch aktiv**: Pilot 2, Topologie-Antwort, DJI-Karten-Gruppen, Medienprofil und GPS-Track-Aufnahme haben eigene Grenzen.

## Konfiguration, die Root-Compose tatsächlich an den Backend-Container weitergibt

| Variable | Main-Default / Pflicht | Zweck und fachliche Grenze |
| --- | --- | --- |
| `SKYHUB_VIEW_TOKEN` | Pflicht, mindestens 24 Zeichen; kein `REPLACE_` | Schutz der regulären HTTP- und Socket.IO-APIs; gilt **nicht** als Pilot-/Admin-Identität |
| `MQTT_BROKER_URL` | Pflicht, Docker-Beispiel `mqtt://host.docker.internal:1884` | Empfang über ausgewählten bestehenden Broker; kein Broker in Root-Compose |
| `SKYHUB_MQTT_BROKER_KIND` | `emqx`, `mosquitto` oder `mosquitto-dedicated` | Strenge Paarung mit 1884, 1883 bzw. 1884; keine automatische Brokerumschaltung |
| `SKYHUB_MQTT_REQUIRED_PORT` | **`1884` standardmäßig, `1883` mit `mosquitto` oder `1884` mit `emqx`/`mosquitto-dedicated`**, jetzt aus `.env` durchgereicht | Start-Validierung verweigert andere Zielports |
| `MQTT_USER` / `MQTT_PASSWORD` | Bei Bedarf gesetzt, Compose-Default leer | **Lese-Subscriber**; nicht für Pilot oder Topologie-Publisher wiederverwenden |
| `SKYHUB_BIND_ADDRESS` | `127.0.0.1` | Host-Bindung; **keinen öffentlichen Bind** für Pilot-HTTPS-Onboarding verwenden |
| `PORT` | Container fest `4000` | Innerer Express-Port; Host-Port über `SKYHUB_HTTP_PORT` |
| `SKYHUB_PILOT_ENABLED` | `false` | Deaktiviert Pilot-Bootstrap bis vollständiger Konfiguration |
| `SKYHUB_PILOT_ACCESS_TOKEN` | Platzhalter/leer, bei Pilot mindestens 32 Zeichen | Separater Pilot-Zugriff; **nicht** identisch mit View-Token |
| `SKYHUB_DJI_APP_ID` / `SKYHUB_DJI_APP_KEY` / `SKYHUB_DJI_APP_LICENSE` | Pilot-Pflichtwerte, wenn aktiviert | DJI-Cloud-App-Konfiguration; nicht in README, Logs oder Support-Ausgaben veröffentlichen |
| `SKYHUB_PILOT_MQTT_URL` / `SKYHUB_PILOT_MQTT_USER` / `SKYHUB_PILOT_MQTT_PASSWORD` | Pilot-Pflichtwerte, wenn aktiviert | Pilot 2 benötigt vom Controller erreichbare Hostadresse auf dem ausgewählten Port 1884 oder 1883, **nicht** `host.docker.internal` oder localhost |
| `SKYHUB_PILOT_WORKSPACE_ID` | Gültige UUID, wenn aktiviert | Serverseitige Arbeitsbereichsbindung für Pairing und Kartenleserecht |
| `SKYHUB_TOPOLOGY_ACK_ENABLED` | `false` | Optionaler `update_topo`/`status_reply`-Antwortpfad, **keine** Flugkommandos |
| `SKYHUB_TOPOLOGY_ACK_MQTT_USER` / `SKYHUB_TOPOLOGY_ACK_MQTT_PASSWORD` | Leer, bei aktiviertem ACK erforderlich | **Eigenes** auf `sys/product/+/status_reply` eingeschränktes Publisher-Konto; ACL vor Betrieb nachweisen |
| `SKYHUB_LAN_VIEW_CIDR` | Leer | Tokenfreier Zugriff nur für kleine zulässige private Netze und exakt definierte GET-/Socket-Routen; Proxy-Vertrauen und Header müssen separat gesichert werden |
| `SKYHUB_TRACK_RECORDING_ENABLED` | `false` | Neue PostGIS-GPS-Spuren und Pruning aus; Live-Telemetrie und Abruf alter Spuren bleiben möglich |
| `SKYHUB_TRACK_RETENTION_DAYS` | `30` | Aufbewahrung 1–3650 Tage; nur wirksam, wenn Aufnahme/Bereinigung aktiviert |
| `REDIS_URL` | Compose intern `redis://redis:6379` | Redis-Verbindungsziel des Next-Stacks |
| `DATABASE_URL` | Compose intern PostgreSQL-URI aus `SKYHUB_DB_PASSWORD` | PostGIS-Verbindungsziel; enthält geheimes Passwort, daher niemals ausgeben |

**Wichtig:** Auch ein explizites `SKYHUB_TOPOLOGY_ACK_ENABLED=true` bestätigt nur die Bereitstellung des Antwortpfads; es ist weder eine DJI-Hardwarefreigabe noch eine Versicherung, dass Broker-ACLs, Gerät oder Pilot 2 bereit sind.

## Compose-Variablen und Profile außerhalb der Backend-Environment

| Variable / Mechanismus | Stand | Wirkung |
| --- | --- | --- |
| `SKYHUB_HTTP_PORT` | `4001` | Host-HTTP-Port für das Next-Backend |
| `SKYHUB_DB_PASSWORD` | Compose-Pflichtwert | Initialer PostgreSQL-User/Verbindungsstring; lokale DB-Daten bleiben in `pgdata` |
| `SKYHUB_MINIO_USER` / `SKYHUB_MINIO_PASSWORD` | Compose-Pflichtwerte mit lokalen Platzhaltern | Nur für den opt-in MinIO-Dienst; auf `main` existiert eine **separate, standardmäßig deaktivierte read-only Medien-API**. Backend-Reader benötigt eigenständige minimale S3-Rechte |
| Compose-Profil `media` | Standard **aus** | Startet optional `minio` mit internem Objektspeicher und `minio_data`-Volume; **keine Hostports** veröffentlicht |
| `pgdata` / `redis_data` / `minio_data` | Persistente Docker-Volumes | **Nicht löschen**. `docker compose down -v` ist kein Update-/Cleanup-Verfahren |
| `SKYHUB_BIND_ADDRESS` | Compose Host-Port-Bindung; zudem Backend-Konfigurationswert | Container lauscht intern auf `0.0.0.0:4000`, der Host-Port wird standardmäßig auf Loopback begrenzt |

## Konfigurations-Sonderfälle: an Backend durchgereicht oder bewusst nicht

| Name | Ist-Befund | Betriebsfolge |
| --- | --- | --- |
| `SKYHUB_DJI_MAP_ELEMENTS_ENABLED` | `.env.example` enthält `false`; `backend/pilot-routes.js` prüft `'true'`; das Root-Compose reicht den Wert **mit Default `false`** bereits weiter | Aktivierung zusätzlich nur bei vollständiger Pilot-Konfiguration, HTTPS, `x-auth-token`, autorisiertem Workspace und geprüften Datenbankgrenzen. `.env` allein ist keine sichere Freigabe |
| `SKYHUB_MEDIA_ENABLED` / `SKYHUB_S3_ENDPOINT` / `SKYHUB_S3_ACCESS_KEY` / `SKYHUB_S3_SECRET_KEY` | PR-#24-Code kann eine geschützte read-only S3-Medien-API aktivieren; Root-Compose reicht diese Variablen weiter, aber mit leeren Standardwerten und `SKYHUB_MEDIA_ENABLED=false`; `.env.example` enthält sie nur auskommentiert | Ohne ausdrückliches `SKYHUB_MEDIA_ENABLED=true` und eng begrenzte MinIO-Reader-IAM-ACL bleibt die Medien-API **aus**. Keine Root-Credentials und keine PUT-/DELETE-Rechte verwenden |
| `SKYHUB_M3M_CATALOG_ENABLED` | Der Server kennt den geschützten Metadata-only-Katalog, Root-Compose reicht dieses Flag standardmäßig **nicht** an den Container durch | Nicht durch bloßes Setzen in `.env` aktiv; keine Pixel, Indexkarten oder wissenschaftliche Freigabe |
| `SKYHUB_MINIO_DR_ENABLED` | Root-Compose: **true**; `SKYHUB_MINIO_DR_COMPOSITE_ENABLED=false` | Nur read-only Status/Report unter `/api/dr/minio` nach View-Authentifizierung; ohne Reports „unavailable“ |
| `NODE_ENV` | Code nutzt `test` für Loopback-Listen-Bind in separaten Tests; nicht als Host-Betriebsoption in Root-Compose definiert | Keine ungeprüfte Umschaltung als Sicherheitsmaßnahme |

**Weitere Feature-Flags** aus gestapelten Branches (STS, WPML-KMZ-Inspektion, produktive XMP-Verarbeitung, Simulator, YOLO/Thermal) existieren **nicht** im hier geprüften Main-Compose und dürfen nicht als sofort benutzbare `.env`-Einstellungen ausgegeben werden. Details in [PR-Register](projektstand-2026-10-23.md).

## Sicherheitsentwurf für künftige Proxy-Umstellung (noch nicht in Main)

Im separaten [Proxy-Trust-Draft](proxy-trust-rollout.md) wird `SKYHUB_TRUSTED_PROXY_IPS` als durch Compose übergebene Allowlist für **exakte private Socket-Peers** hinzugefügt. Nur nach gesonderter Freigabe und Übernahme des Drafts hat diese Variable eine Wirkung; auf dem hier beschriebenen `main` gilt weiterhin der ältere Vertrauenscode. Vor einem Pi-Upgrade die tatsächlich benutzte Caddy-Proxy-IP bestimmen und Pilot-HTTPS sowie LAN-View im Staging nachweisen. Es handelt sich **nicht** um die TSA-spezifische `SKYHUB_DJI_TSA_TRUSTED_PROXY_IPS`-Liste.

## Nicht-destruktive Prüfungen

**Nur im dafür vorgesehenen SkyHub-Next-Checkout:**

```bash
cd ~/Projekte/SkyHub-Next
git status --short --branch
git rev-parse HEAD
docker compose -p skyhub-next ps
docker compose --env-file .env.example config --quiet
bash scripts/pi-preflight.sh
```

Die Compose-Prüfung mit `.env.example` validiert lediglich die Syntax und Platzhalterkonfiguration. Sie beweist **keine** gültigen Passwörter, gebundene Dienste, TLS-Vertrauen, S3-Rechte, DJI-Hardware oder echte Migrationen. `docker compose ... config` ohne `--quiet` kann interpolierte Geheimnisse anzeigen: **keine vollständige Ausgabe posten**.

**Bei noch nicht existierendem Checkout** darf `.env.example` lediglich einmalig kopiert werden. Vorhandene `.env`, `docker-compose.override.yml`, Datenvolumes und unbekannte Git-Änderungen niemals überschreiben.

## Sichere Freigabereihenfolge

1. Tatsächliche Pi-Ports, Broker-ACL und HTTPS-Reverse-Proxy lesen; die historischen Diagnosen von 20./21.10.2026 sind keine aktuellen Zustandsnachweise.
2. Lokale `.env` und Overrides gegen **aktuell gestartetes** Compose prüfen; kein sensibles Material in Git/Chats kopieren.
3. Für neue Komponenten erst PR-Kette/CI/Migration/ACL prüfen; dann Sicherung, isoliertes Staging und erst danach explizit freigegebenes Backend-Update.
4. Nach Änderungen nur lesenden Health-/OSD-/Pairing-Status prüfen; keine Flug-, Speicher-Schreib- oder Pilot-Admin-Operationen als Smoke-Test ausführen.

**Referenzen:** [Betrieb](ops.md), [Sicherheit](security.md), [API-Referenz](api-reference.md), [Skriptwirkungen](scripts.md), [Projektstand](projektstand-2026-10-23.md).
