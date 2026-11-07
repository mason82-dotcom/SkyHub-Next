# Betriebsvorfälle 26.10.2026 und Konsequenzen

> Datierter Bericht, Raspberry Pi `rpi5`. Kein Schuldzuweisungsprotokoll: Beide Vorfälle entstanden durch Änderungen, die zur Verbesserung des Betriebs gedacht waren, und beide wurden behoben. Die Konsequenzen stehen bereits in `main` ([ops.md](ops.md), `scripts/pi-compose.sh`, Test `tests/test_pi_compose_wrapper.py`).

## 1. Postgres und Backend fielen nach `docker compose up -d` aus

**Auslöser.** Nach dem Merge der Log-Rotation (PR #202) wurde auf dem Pi `docker compose up -d` ohne die Overlay-Dateien ausgeführt, in der Annahme, dass nur Dienste mit geänderter Konfiguration neu angelegt werden.

**Ablauf und Ursache.**
- Compose nahm `docker-compose.yml` allein. Postgres wurde mit dem x86-Image `postgis/postgis:15-3.3` und einem **neuen leeren Volume** `skyhub-next_pgdata` neu angelegt. Der laufende Container nutzte bis dahin das Overlay (`docker-compose.arm64.yml`): Image `skyhub-next-postgis:pg15-arm64`, Volume `skyhub-next_pgdata_arm64`.
- Das x86-Image startete auf dem Pi nicht (`libicui18n.so.67: failed to map segment`), Postgres blieb in einer Neustartschleife, das Backend (`depends_on: service_healthy`) wurde nie gestartet. Telemetrie und Pilot-Anmeldung waren für mehrere Minuten unterbrochen.
- Die Datenbankdaten blieben unberührt: das Volume `skyhub-next_pgdata_arm64` (71 MB) wurde nicht eingehängt, das fälschlich angelegte war leer (4 KB). Es existierten Sicherungen vom 25.10. (21:40 und 22:25 UTC) unter `~/Projekte/_backups/skyhub-next/`.

**Behebung.** `docker compose -p skyhub-next --env-file .env -f docker-compose.yml -f docker-compose.arm64.yml -f docker-compose.override.yml up -d --no-build`. Danach: PostgreSQL 15.19 `healthy`, PostGIS 3.6.4, 14 Tabellen, Backend `online` mit 4 aus Redis wiederhergestellten Geräten. Das leere Volume wurde später entfernt.

**Zusätzlicher Befund.** Der Container lief bis dahin mit einem älteren Stand des Image-Tags `pg15-arm64`; das Tag zeigte seit dem 20.10. auf ein neu gebautes Image. Das Neuanlegen hat deshalb auch den Imagewechsel vollzogen (ohne Auffälligkeiten). Der frühere Stand existiert lokal nicht mehr.

**Konsequenzen.**
- `scripts/pi-compose.sh` gibt auf dem Pi **immer** `docker-compose.yml`, `docker-compose.arm64.yml` und (falls vorhanden) `docker-compose.override.yml` mit und lehnt `up`/`down`/`restart`/`stop`/`rm` **ohne Dienstnamen** ab (`--all-services` hebt das bewusst auf).
- Warnkommentar im Kopf von `docker-compose.yml`, Abschnitt in [ops.md](ops.md), hermetischer Test.
- Regel: Ein Compose-Aufruf, der `postgres` neu anlegt, ist eine Datenbankmaßnahme (Image, Neuanlegen) und gehört in ein Wartungsfenster mit frischer Sicherung, nicht in eine Routine nach einem Logging-Merge.

## 2. `docker logs --tail` hing nach externer Log-Rotation

**Auslöser.** Als Sicherheitsnetz für bestehende Container ohne Log-Grenze wurde `logrotate` mit `copytruncate` auf `/mnt/data/docker/containers/*/*-json.log` eingerichtet und einmal mit `logrotate -f` ausgeführt.

**Ursache.** `-f` erzwingt die Rotation **aller** passenden Dateien, nicht nur der großen. Docker zählt die Schreibposition seiner `json-file`-Logdatei selbst mit. Wird die Datei von außen gekürzt, stimmt diese Position nicht mehr: `docker logs --tail` hängt danach, bis der Container (genauer: sein Logger) neu gestartet wird. Betroffen waren **29 Container**; `docker logs` ohne `--tail` und alle sonstigen Funktionen liefen weiter. Frische oder gestoppte Container waren nicht betroffen (Gegenprobe mit einem Wegwerf-Container).

**Behebung.** Die logrotate-Datei wurde entfernt (der tägliche Lauf hätte den Fehler wiederholt). Der Neustart des Docker-Dienstes beim Reboot am 26.10. um 20:28 setzte alle Logger zurück; `scripts/pi-docker-logrotation.sh diagnose` (im Begleitprojekt [Pi-Hub](pi-hub.md)) meldet seitdem keinen betroffenen Container. Der Inhalt vor der Rotation lag in `…-json.log.1` und ist nicht verloren gegangen.

**Konsequenzen.**
- **Nicht** von außen kürzen. Eine Log-Grenze gilt nur über Docker selbst: `logging:` im Compose-Projekt (für SkyHub-Next in `docker-compose.yml`, PR #202) oder der Standard in `/etc/docker/daemon.json`; beides wirkt erst beim **Neuanlegen** eines Containers.
- Die Pi-Hub-Log-Ansicht meldet ein hängendes `--tail` nach 10 Sekunden verständlich statt zu blockieren.
- Die Dokumentation des Fehlers steht im [Betriebsstand](stand-2026-10-27-betriebsstand.md) und in der Betriebsdoku von Pi-Hub.

## Gemeinsame Lehre
Hinweise wie „legt nur geänderte Dienste neu an“ gelten nur, wenn man sicher weiß, **gegen welche Dateien** Compose rechnet. Auf dem Pi weicht der Ist-Zustand (Overlay, lokaler Override, lokal gebaute Images) von `docker-compose.yml` ab. Vor jedem Compose-Aufruf auf dem Pi `scripts/pi-compose.sh config --quiet` bzw. `ps` prüfen und im Zweifel nur einen Dienst nennen.
