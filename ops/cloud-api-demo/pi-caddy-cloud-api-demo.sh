#!/usr/bin/env bash
# Publiziert die Cloud-API-Demo (Web + API + WebSocket) per HTTPS im Heimnetz ueber das vorhandene Caddy, auf einem
# eigenen Port. Voraussetzung: DEMO_SAME_ORIGIN=true in ops/cloud-api-demo/.env und danach `pi-cloud-api-demo.sh apply`
# (nginx im Web-Container leitet /<prefix>/api/v1/ und /api/v1/ws an das Backend weiter, das nur noch auf Loopback lauscht).
#   sudo bash pi-caddy-cloud-api-demo.sh apply      Block fuer :4444 anhaengen, validieren, neu laden
#   sudo bash pi-caddy-cloud-api-demo.sh rollback   Caddyfile von vor `apply` wiederherstellen
#   bash pi-caddy-cloud-api-demo.sh check           Erreichbarkeit pruefen (keine Aenderung)
#   bash pi-caddy-cloud-api-demo.sh print           den Caddy-Block anzeigen (keine Aenderung)
#   bash pi-caddy-cloud-api-demo.sh ca              oeffentliches Root-Zertifikat von Caddy und Fingerabdruck anzeigen
# Aendert weder SkyHub Next (:4443) noch Nextcloud (:443) noch die Demo-Container.
set -euo pipefail

CADDYFILE=/opt/caddy/Caddyfile
CONTAINER=caddy
MARKER='# CLOUD-API-DEMO HTTPS (LAN only)'
LAN_CIDR=192.168.178.0/24
PI_IP=192.168.178.63
PORT=4444
UPSTREAM="${PI_IP}:8081"

block() {
cat <<BLOCK

${MARKER}
# Managed by SkyHub-Next/ops/cloud-api-demo/pi-caddy-cloud-api-demo.sh
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
	@lan remote_ip ${LAN_CIDR}
	handle @lan {
		# WebSocket (/api/v1/ws) wird von Caddy ohne Zusatz durchgereicht.
		reverse_proxy ${UPSTREAM}
	}
	handle {
		respond "Forbidden" 403
	}
}
BLOCK
}

caddy() { docker exec "$CONTAINER" caddy "$@" --config /etc/caddy/Caddyfile --adapter caddyfile; }

# In place schreiben (cat >), damit der Single-File-Bind-Mount seine Inode behaelt.
restore() { cat "$1" > "$CADDYFILE"; }

code() { curl -sk -o /dev/null -m 6 -w '%{http_code}' "$@" || true; }

check() {
  echo "Web ueber HTTPS aus dem LAN (${PI_IP}:${PORT}):                 HTTP $(code "https://${PI_IP}:${PORT}/") (erwartet 200)"
  echo "API ueber denselben Ursprung (Anmelde-Endpunkt):               HTTP $(code "https://${PI_IP}:${PORT}/manage/api/v1/login") (200/401/405: Backend antwortet; 404 = nginx-Proxy fehlt)"
  echo "WebSocket-Pfad (Upgrade-Anfrage ohne Token):                   HTTP $(code -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: c2t5aHViY2hlY2s=' "https://${PI_IP}:${PORT}/api/v1/ws") (101/400/401/403: Backend antwortet; 404 = Proxy fehlt)"
  echo "Von ausserhalb ${LAN_CIDR} (Test ueber 127.0.0.1):             HTTP $(code --resolve "rpi5.fritz.box:${PORT}:127.0.0.1" "https://rpi5.fritz.box:${PORT}/") (erwartet 403)"
  echo "Demo-Web ueber HTTP (RC, unveraendert):                         HTTP $(code "http://${PI_IP}:8081/") (erwartet 200)"
  if timeout 2 bash -c "exec 3<>/dev/tcp/${PI_IP}/6789" 2>/dev/null; then
    echo "Backend-Port 6789 im LAN:                                      OFFEN (bei DEMO_SAME_ORIGIN=true erwartet geschlossen: apply ausgefuehrt?)"
  else
    echo "Backend-Port 6789 im LAN:                                      geschlossen"
  fi
}

case "${1:-}" in
  apply)
    [ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo ausfuehren."; exit 2; }
    if grep -qF "$MARKER" "$CADDYFILE"; then echo "Bereits eingerichtet."; check; exit 0; fi
    if [ "$(code "http://${UPSTREAM}/manage/api/v1/login")" = "404" ]; then
      echo "Abbruch: ${UPSTREAM} leitet /manage/api/v1/ nicht an das Backend weiter."
      echo "Erst DEMO_SAME_ORIGIN=true in ops/cloud-api-demo/.env setzen und 'bash pi-cloud-api-demo.sh apply' ausfuehren."
      exit 1
    fi
    backup="${CADDYFILE}.before-cloud-api-demo-$(date +%Y%m%d-%H%M%S)"
    cp -p "$CADDYFILE" "$backup"
    echo "Sicherung: $backup"
    block >> "$CADDYFILE"
    if ! caddy validate >/dev/null 2>&1; then
      restore "$backup"; echo "Validierung fehlgeschlagen - Caddyfile unveraendert wiederhergestellt."; exit 1
    fi
    if ! caddy reload; then
      restore "$backup"; caddy reload || true
      echo "Reload fehlgeschlagen - vorherige Konfiguration wiederhergestellt."; exit 1
    fi
    echo "Caddy neu geladen."
    sleep 2
    check
    echo "Im Browser: https://rpi5.fritz.box:${PORT}  oder  https://${PI_IP}:${PORT}  (Root-Zertifikat: bash $0 ca)"
    ;;
  rollback)
    [ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo ausfuehren."; exit 2; }
    backup=$(ls -1t "${CADDYFILE}".before-cloud-api-demo-* 2>/dev/null | head -1 || true)
    [ -n "$backup" ] || { echo "Keine Sicherung gefunden."; exit 1; }
    restore "$backup"
    caddy reload
    echo "Wiederhergestellt aus $backup und neu geladen."
    ;;
  check) check ;;
  print) block ;;
  ca)
    pem="$(docker exec "$CONTAINER" cat /data/caddy/pki/authorities/local/root.crt)"
    printf '%s\n' "$pem"
    printf '%s\n' "$pem" | openssl x509 -noout -subject -fingerprint -sha256 -enddate
    ;;
  *) echo "Verwendung: sudo bash $0 apply|rollback   oder   bash $0 check|print|ca"; exit 2 ;;
esac
