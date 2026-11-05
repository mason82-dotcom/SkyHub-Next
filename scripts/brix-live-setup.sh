#!/usr/bin/env bash
# Livestream auf brix-node einrichten: MediaMTX-Relay (docker-compose.live.yml) + Stream-Anforderung über MQTT
# (backend/live-control.js, live_start_push). Als mason auf brix-node im Stack-Ordner ausführen (kein root):
#   bash scripts/brix-live-setup.sh 192.168.178.50
# Argument: LAN-Adresse von brix-node aus Sicht der Fernsteuerung (RTMP-Ziel, Port 1935).
# Die zwei MediaMTX-Passwörter werden erzeugt und NIE angezeigt. Nutzt das vorhandene MQTT-Konto skyhub_commander (DRC);
# keine Broker-Änderung. Idempotent: ändert nichts, wenn SKYHUB_LIVE_* schon in .env steht. Sicherung: .env.before-live-<zeit>.
set -Eeuo pipefail
cd "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${1:?LAN-Adresse von brix-node angeben, z. B. 192.168.178.50}"
[[ "$HOST" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo "IPv4-Adresse erwartet" >&2; exit 2; }
[[ -f .env && -f docker-compose.live.yml ]] || { echo ".env oder docker-compose.live.yml fehlt" >&2; exit 2; }
if grep -q '^SKYHUB_LIVE_' .env; then echo "SKYHUB_LIVE_* steht schon in .env – nichts geändert."; exit 0; fi
grep -q '^SKYHUB_DRC_MQTT_USERNAME=' .env || { echo "MQTT-Konto der Live-Steuerung fehlt (zuerst scripts/brix-drc-setup.sh)" >&2; exit 2; }
if ss -ltn 2>/dev/null | grep -q ':1935 '; then echo "Port 1935 ist schon belegt – bitte prüfen." >&2; exit 2; fi

ts=$(date +%Y%m%d-%H%M%S); umask 077
cp -p .env ".env.before-live-$ts"
gen(){ openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-"$1"; }
pp=$(gen 32); pr=$(gen 32)
{
  printf '\n# Livestream (MediaMTX + Anforderung über MQTT), eingerichtet %s mit scripts/brix-live-setup.sh\n' "$ts"
  printf 'SKYHUB_LIVE_ENABLED=true\nSKYHUB_LIVE_RTMP_URL=rtmp://%s:1935\n' "$HOST"
  printf 'SKYHUB_LIVE_PUBLISH_PASS=%s\nSKYHUB_LIVE_READ_PASS=%s\nSKYHUB_LIVE_CONTROL_ENABLED=true\n' "$pp" "$pr"
} >> .env
unset pp pr
bash scripts/brix-compose.sh up -d --no-deps mediamtx
bash scripts/brix-compose.sh up -d --no-deps backend
echo "Fertig. Pilot 2: SkyHub-Seite neu laden (Liveshare-Modus wechselt auf Anforderung durch SkyHub)."
