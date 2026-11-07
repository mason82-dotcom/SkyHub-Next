# Betriebsstand Raspberry Pi – 27.10.2026

> **Momentaufnahme des Pi `rpi5`, erhoben am 25.–27.10.2026, Quellcode `main` bei `3a1766b`.** Quelle sind Messungen und Testläufe auf dem Gerät (Docker 29.9.2, PostgreSQL 15.19 mit PostGIS 3.6.4, Kernel 6.18.58). Es ist **keine DJI-Hardware- oder Einsatzfreigabe**. Datierte Befunde nie rückwirkend ändern: bei neuen Messungen eine neue Momentaufnahme anlegen und im [Wegweiser](index.md) verlinken. Statuswörter nach [Dokumentationspflege](dokumentationspflege.md).

## Der Stack

| Teil | Zustand | Anmerkung |
|---|---|---|
| `skyhub-next-backend-1`, `-postgres-1`, `-redis-1` | **Deployed**, laufen, Postgres und Redis `healthy` | Backend `/api/health`: `online`, MQTT (Port 1884) und Redis verbunden, 4 Geräte aus Redis wiederhergestellt |
| PostgreSQL | Image `skyhub-next-postgis:pg15-arm64` (lokal gebaut, arm64), Volume `skyhub-next_pgdata_arm64` | PostgreSQL 15.19, PostGIS 3.6.4, 14 Tabellen. **Nur mit dem arm64-Overlay starten**, siehe [Vorfälle](vorfaelle-2026-10-26.md) |
| Start/Neuanlegen | immer über `scripts/pi-compose.sh` oder `scripts/pi-update-backend.sh` | [ops.md](ops.md#compose-auf-dem-pi-immer-mit-den-overlays-pi-composesh) |
| Log-Rotation | `backend`, `postgres`, `redis`: `json-file`, 10 MB × 3 (seit dem Neuanlegen am 26.10.) | Compose-Anker `x-logging` (PR #202); `/etc/docker/daemon.json` setzt denselben Standard für neu angelegte Container anderer Projekte |

## Sicherheit: exakte Proxy-Peers

**Deployed.** `SKYHUB_TRUSTED_PROXY_IPS` ist gesetzt (PR #176 in `main`). Caddy erreicht das Backend über den Userland-Proxy von Docker, deshalb ist der Socket-Peer das Gateway der Bridge `skyhub-next_default`, nicht `127.0.0.1` (am 25.10. gemessen: `172.25.0.1`). `scripts/pi-proxy-peer-check.sh --enforce` läuft vor jedem Backend-Update; `pi-reboot-test.sh post` prüft nach einem Neustart, dass das Gateway unverändert ist. Siehe [proxy-trust-rollout.md](proxy-trust-rollout.md).

## Gemeinsamer MinIO und Medien-API

- Container `skyhub-shared-minio` (Image `sha256:117cf7ed…`, arm64), **kein Host-Port**, Netz `skyhub-storage-net` mit Alias `skyhub-minio`, Daten auf `/mnt/hc4backup/skyhub-next/minio` (ext4, NVMe), Restart-Policy `no` (bewusst).
- **Autostart** nur über die mountgeschützte systemd-Unit `skyhub-shared-minio.service` (`scripts/pi-minio-autostart.sh`): `RequiresMountsFor=/mnt/hc4backup`, Mount-Prüfung vor dem Start, nur `docker start`/`stop` des vorhandenen Containers.
- Fünf Buckets (`basemaps`, `dji-cloud`, `farming`, `mapping-results`, `pv-inspections`). Das Backend nutzt ein **nur lesendes** S3-Konto (`ListBucket`/`GetObject`); `/api/media/*` ist aktiv (`SKYHUB_MEDIA_ENABLED`). `scripts/pi-minio-backend-access.sh check` bestätigt HEAD 200 je Bucket.

## Backup und Wiederherstellung (hardwarebeobachtet, 25./26.10.2026)

| Prüfung | Ergebnis |
|---|---|
| Offline-Backup (`pi-minio-acceptance/launch_backup.py`), 25.10. 22:53–23:30 CET | **bestanden**: Datenarchiv 28,83 GB und Image-Archiv 51,5 MB (GPG, AES256) auf `/mnt/benz`, SHA256 beider Archive OK, `ARCHIVE-COMPLETE.txt` gesetzt, Quelle gegen Offline-Manifest verglichen (54.835 Einträge: SHA256, Größen, Besitzer, Modi, xattrs). MinIO stand rund 37 Minuten; derselbe Container lief danach weiter |
| Isolierter Restore (`restore.sh`), 26.10. | **bestanden**: Manifestabgleich PASS (54.835 Einträge), isolierter MinIO bereit, Service-Account aktiv mit der erwarteten Nur-Lese-Policy, LIST bei 5/5 Buckets, Stichproben-GET bei 4/5 (Bucket 1 ist leer, dort kein GET möglich). Rückbau sauber |
| Negativer Schreibtest (PUT/DELETE/Bucket anlegen müssen mit `AccessDenied` scheitern) | **Code in `main`** (PR #200, #201), gegen einen Wegwerf-MinIO mit derselben Policy geprüft: alles verweigert. **Der Lauf gegen eine echte Restore-Kopie steht noch aus** |
| Backup-Passphrase außerhalb des Pi | **liegt beim Betreiber**, nicht prüfbar. Ohne sie ist das Archiv wertlos |
| Wiederimport des Image-Archivs auf einem frischen Host | offen (Portabilitätstest) |

Details und Befehle: [pi-minio-acceptance/README.md](../pi-minio-acceptance/README.md) (Abschnitt „Ergebnis 25./26.10.2026“). Die früheren Archive vom 22.10. sind nicht mehr vorhanden; maßgeblich ist das Archiv vom 25.10.

## Neustart und Persistenz (26.10.2026)

- **Stop/Start desselben Containers** (`scripts/pi-minio-restart-test.sh`): bestanden. Gleiche Container-ID und gleiches Image, Netz und Alias erhalten, Backend ohne Neustart, 5/5 Buckets lesbar.
- **Pi-Neustart** (`scripts/pi-reboot-test.sh pre` → `sudo reboot` → `post`), zweimal: Mounts, Backend, Mosquitto, Proxy-Peer und alle Container mit Autostart wieder oben. Beim zweiten Neustart (20:28) startete der **MinIO von selbst über die Unit**, alle Container hatten wieder heile Logger (`docker logs --tail` bei keinem hängend).
- Beobachtet, nicht von SkyHub verursacht: `nextcloud-aio-notify-push` startet nicht (feste IP `172.18.0.2` beim Boot belegt), das Pironman-5-Gehäuse meldet einmal je Start `PiPower5Addon` nicht bereit (siehe unten).

## Weitere Betriebsänderungen

- **PiPower 5 entfernt** (Board nicht angeschlossen): Das Overlay `sunfounder-pipower5` ist in `config.txt` auskommentiert, das DKMS-Modul `pipower5` samt udev-Regel entfernt, Sicherung unter `/var/backups/pi-pipower-removal-*`. Zuvor schrieb der Treiber über 150.000 Kernel-Meldungen pro Boot. Das Gehäuse (OLED, RGB, Lüfter über `pironman5.service`) läuft weiter.
- **Cloud-API-Demo** (`ops/cloud-api-demo/`, nur LAN): Ports 8081/6789/18830/18084 an die LAN-Adresse gebunden, Restart-Policy `unless-stopped` (startet nach einem Neustart von selbst, PR #199). Optionale HTTPS-Route über Caddy auf Port 4444. Die Fernsteuerung kann nur an **eine** Plattform gekoppelt sein.
- **Docker-Logs der übrigen Projekte** (Immich, Nextcloud, Home Assistant, …): ohne eigene Grenze, bis die Container neu angelegt werden; der Standard in `daemon.json` greift erst dann. Das Prüf- und Einrichtungswerkzeug liegt im Begleitprojekt [Pi-Hub](pi-hub.md).

## Offene Punkte

1. Negativer Schreibtest in einem echten Restore-Lauf (Code vorhanden, Lauf offen).
2. Backup-Passphrase außerhalb des Pi sichern und Wiederimport des Image-Archivs testen.
3. Beim nächsten geplanten Neuanlegen von Postgres bewusst prüfen: das lokale PostGIS-Image ist seit 20.10. neu gebaut, der laufende Container nutzt seit dem 26.10. dieses Image auf den vorhandenen Daten (Start ohne Auffälligkeiten im Log, Erweiterung `postgis` in Version 3.6.4). Ein Update der Erweiterung wurde nicht ausgeführt und ist nicht geprüft.
4. `nextcloud-aio-notify-push` über die AIO-Oberfläche beheben (nicht Teil von SkyHub).
5. Reale Kalibrierungs- und Einsatzfreigaben bleiben unverändert offen (siehe [Hardware-Abnahmestatus](hardware-acceptance-status-2026-10-24.md) und [RC Plus 2/M4T](hardware-rc-plus2-m4t.md)).
