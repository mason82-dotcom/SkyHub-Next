# SkyHub Next auf brix-node (x86-64)

Seit Anfang November 2026 läuft der SkyHub-Next-Stack auf brix-node (`192.168.178.50`). Der Pi bleibt
Eingangstür: Caddy (:443/:4443/:9446) und die MQTT-TCP-Weiterleitung (:1884) zeigen über das LAN auf brix-node.
nftables (`/etc/nftables.d/brix-access.nft`) lässt auf 1884/4001/4002 nur den Pi (`192.168.178.63`) zu.

| Datei | Zweck |
|---|---|
| `docker-compose.brix.yml` | Overlay statt `docker-compose.arm64.yml`: amd64-Images, Bindung an `SKYHUB_BRIX_BIND`, Mosquitto im Stack |
| `docker-compose.minio-shared.brix.yml` | Gemeinsamer MinIO (`skyhub-storage`), Daten unter `/srv/appdata/skyhub-next/minio` |
| `scripts/brix-compose.sh` | Compose-Wrapper (Overlays + Profile aus `.env`, verweigert Befehle ohne Dienstnamen) |
| `ops/brix/mosquitto/` | Broker-Konfiguration; `passwd`/`acl` bleiben lokal (600, nicht im Git) |
| `ops/brix/monitoring/` | Prometheus-Job und Grafana-Alarmregeln für SkyHub und das restic-Backup |

## Betrieb

```bash
cd /srv/stacks/skyhub-next
bash scripts/brix-compose.sh ps
bash scripts/brix-compose.sh build backend && bash scripts/brix-compose.sh up -d --no-deps backend
```

Nie `docker compose up` ohne den Wrapper: ohne Overlays würde der Stack mit Pi-Einstellungen starten.

## Monitoring

Das Backend liefert `/api/health` zusätzlich als Prometheus-Text unter `/api/health/metrics` (`skyhub_*`,
ohne Token, ohne Seriennummern). Einbindung in `/srv/stacks/monitoring`:

1. Inhalt von `monitoring/prometheus-skyhub.yml` an `scrape_configs` in `prometheus.yml` anhängen,
   `docker restart brix-prometheus`.
2. `monitoring/skyhub-alerts.yaml` und `monitoring/brix-backup-alerts.yaml` nach
   `/srv/stacks/monitoring/grafana/alerting/` kopieren, `docker restart brix-grafana`.

Alarme: Backend nicht erreichbar (3 min), MQTT „degraded“ (5 min), Redis weg (5 min), Neustartschleife eines
`skyhub-*`-Containers (> 2 Starts in 30 min), Backup älter als 26 h oder fehlgeschlagen. Die Benachrichtigung
hängt vom Grafana-Kontaktpunkt ab (Notification Policy der Organisation).

## Backup

Täglich 03:30 per restic (`~/.local/bin/brix-backup`, User-Timer `brix-backup.timer`) auf den rpi5
(`/mnt/hc4backup/restic-brix-node`): Postgres-Dump (`pg_dump -Fc` + Globals), Redis-RDB, MinIO-Daten,
Stack-Ordner und Host-Konfiguration. Wiederherstellung Postgres:

```bash
brix-backup restore latest --include '/home/mason/.cache/brix-backup/stage/db' --target /tmp/restore
docker exec -i skyhub-next-postgres-1 sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
  < /tmp/restore/home/mason/.cache/brix-backup/stage/db/skyhub_next.pgdump
```
