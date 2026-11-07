#!/usr/bin/env bash
# Publish the SkyHub Next dashboard to the home LAN only, via the existing Caddy.
#   sudo bash scripts/pi-caddy-lan-dashboard.sh apply      add the :4443 site, validate, reload
#   sudo bash scripts/pi-caddy-lan-dashboard.sh rollback   restore the Caddyfile from before apply
#   bash scripts/pi-caddy-lan-dashboard.sh check           test reachability (no changes)
#   bash scripts/pi-caddy-lan-dashboard.sh print           show the Caddy block (no changes)
# The backend stays bound to 127.0.0.1:4001. Pairing administration is not exposed.
set -euo pipefail

CADDYFILE=/opt/caddy/Caddyfile
CONTAINER=caddy
MARKER='# SKYHUB-NEXT DASHBOARD (LAN only)'
# LAN incl. the home network IPv6 prefixes (06.11.2026): ULA fd1a:baaf:283e::/64 (stable) and provider prefix 2a02:8071:3184:88c0::/64.
# Without IPv6, clients resolving rpi5.fritz.box to IPv6 got 403. Override: SKYHUB_LAN_CIDR="..." sudo -E bash $0 apply
LAN_CIDR="${SKYHUB_LAN_CIDR:-192.168.178.0/24 fd1a:baaf:283e::/64 2a02:8071:3184:88c0::/64}"
PI_IP=192.168.178.63
PORT=4443

block() {
cat <<EOF

${MARKER}
# Managed by SkyHub-Next/scripts/pi-caddy-lan-dashboard.sh
rpi5.fritz.box:${PORT}, ${PI_IP}:${PORT} {
	tls internal
	log {
		output file /data/logs/access.json {
			roll_size 10mb
			roll_keep 5
			roll_keep_for 168h
		}
		format json
	}
	header {
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
		X-Frame-Options "DENY"
		-Server
		-Via
	}
	# Pairing administration stays on the Pi (loopback/SSH): a view token must not
	# be enough to pair a device and obtain DJI license and Pilot MQTT credentials.
	@pilot_admin path /api/pilot-admin /api/pilot-admin/*
	handle @pilot_admin {
		respond "Forbidden" 403
	}
	@lan remote_ip ${LAN_CIDR}
	handle @lan {
		reverse_proxy 127.0.0.1:4001
	}
	handle {
		respond "Forbidden" 403
	}
}
EOF
}

caddy() { docker exec "$CONTAINER" caddy "$@" --config /etc/caddy/Caddyfile --adapter caddyfile; }

# Write in place (cat >) so the single-file bind mount keeps its inode.
restore() { cat "$1" > "$CADDYFILE"; }

check() {
  local code
  code=$(curl -sk -o /dev/null -w '%{http_code}' "https://${PI_IP}:${PORT}/api/health" || true)
  echo "Dashboard aus dem LAN (${PI_IP}): HTTP ${code} (erwartet 200)"
  code=$(curl -sk -o /dev/null -w '%{http_code}' --resolve "rpi5.fritz.box:${PORT}:127.0.0.1" "https://rpi5.fritz.box:${PORT}/" || true)
  echo "Zugriff von außerhalb ${LAN_CIDR} (Test über 127.0.0.1): HTTP ${code} (erwartet 403)"
  code=$(curl -sk -o /dev/null -w '%{http_code}' "https://${PI_IP}:${PORT}/api/pilot-admin/pairings" || true)
  echo "Kopplungsverwaltung über LAN: HTTP ${code} (erwartet 403)"
}

case "${1:-}" in
  apply)
    [ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo ausführen."; exit 2; }
    if grep -qF "$MARKER" "$CADDYFILE"; then echo "Bereits eingerichtet."; check; exit 0; fi
    backup="${CADDYFILE}.before-skyhub-dashboard-$(date +%Y%m%d-%H%M%S)"
    cp -p "$CADDYFILE" "$backup"
    echo "Sicherung: $backup"
    block >> "$CADDYFILE"
    if ! caddy validate >/dev/null 2>&1; then
      restore "$backup"; echo "Validierung fehlgeschlagen - Caddyfile unverändert wiederhergestellt."; exit 1
    fi
    if ! caddy reload; then
      restore "$backup"; caddy reload || true
      echo "Reload fehlgeschlagen - vorherige Konfiguration wiederhergestellt."; exit 1
    fi
    echo "Caddy neu geladen."
    sleep 2
    check
    echo "Im Browser: https://rpi5.fritz.box:${PORT}  oder  https://${PI_IP}:${PORT}"
    ;;
  rollback)
    [ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo ausführen."; exit 2; }
    backup=$(ls -1t "${CADDYFILE}".before-skyhub-dashboard-* 2>/dev/null | head -1 || true)
    [ -n "$backup" ] || { echo "Keine Sicherung gefunden."; exit 1; }
    restore "$backup"
    caddy reload
    echo "Wiederhergestellt aus $backup und neu geladen."
    ;;
  check) check ;;
  print) block ;;
  *) echo "Verwendung: sudo bash $0 apply|rollback   oder   bash $0 check"; exit 2 ;;
esac
