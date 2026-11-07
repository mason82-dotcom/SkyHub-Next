#!/usr/bin/env bash
# Route DJI Pilot 2 situation awareness (TSA) through the existing Caddy site rpi5.fritz.box.
#   sudo bash scripts/pi-caddy-pilot-tsa.sh apply      add the routes and the log filter, validate, reload
#   sudo bash scripts/pi-caddy-pilot-tsa.sh rollback   restore the Caddyfile from before apply
#   bash scripts/pi-caddy-pilot-tsa.sh check           test reachability (no changes)
#   bash scripts/pi-caddy-pilot-tsa.sh print           show the resulting Caddyfile (no changes)
# Adds /ws/tsa (WebSocket) and /manage/api/v1/workspaces/*/devices/topologies next to the existing
# "SKYHUB-NEXT PILOT ROUTES" block. Pilot 2 sends the device token as ?x-auth-token=... in the
# WebSocket URL and as X-Auth-Token header on HTTPS calls, so both are removed from the access log.
# The backend stays on 127.0.0.1:4001; enable it with SKYHUB_DJI_TSA_ENABLED=true afterwards.
set -euo pipefail

CADDYFILE=/opt/caddy/Caddyfile
CONTAINER=caddy
SITE='rpi5.fritz.box'
MARKER='# SKYHUB-NEXT PILOT TSA ROUTES'

transform() {
python3 - "$1" "$MARKER" <<'PY'
import sys
path, marker = sys.argv[1], sys.argv[2]
lines = open(path).read().split('\n')
start = [i for i, l in enumerate(lines) if l.strip() == 'rpi5.fritz.box {']
if len(start) != 1: sys.exit('Site "rpi5.fritz.box {" not found exactly once')
end = next((i for i in range(start[0] + 1, len(lines)) if lines[i] == '}'), None)
if end is None: sys.exit('End of site block not found')
site = lines[start[0]:end + 1]
if any(marker in l for l in site): sys.exit('Already applied')
handle = [i for i, l in enumerate(site) if l.strip() == 'handle @skyhub_pilot {']
if len(handle) != 1: sys.exit('Existing "handle @skyhub_pilot" block not found exactly once')
close = next(i for i in range(handle[0] + 1, len(site)) if site[i].strip() == '}')
fmt = [i for i, l in enumerate(site) if l.strip() == 'format json']
if len(fmt) != 1: sys.exit('"format json" not found exactly once in the site log block')
indent = site[fmt[0]][:len(site[fmt[0]]) - len(site[fmt[0]].lstrip())]
log_filter = [indent + 'format filter {', indent + '\twrap json', indent + '\tfields {',
  indent + '\t\t' + marker + ': never log Pilot 2 device tokens',
  indent + '\t\trequest>uri query {', indent + '\t\t\tdelete x-auth-token', indent + '\t\t}',
  indent + '\t\trequest>headers>X-Auth-Token delete', indent + '\t}', indent + '}']
routes = ['', '    ' + marker, '    # Managed by SkyHub-Next/scripts/pi-caddy-pilot-tsa.sh',
  '    @skyhub_pilot_tsa {', '        path /ws/tsa /manage/api/v1/workspaces/*/devices/topologies', '    }',
  '    handle @skyhub_pilot_tsa {', '        reverse_proxy 127.0.0.1:4001', '    }']
site = site[:fmt[0]] + log_filter + site[fmt[0] + 1:]
site = site[:close + 1] + routes + site[close + 1:]
print('\n'.join(lines[:start[0]] + site + lines[end + 1:]), end='')
PY
}

caddy() { docker exec "$CONTAINER" caddy "$@" --config /etc/caddy/Caddyfile --adapter caddyfile; }
# Write in place (cat >) so the single-file bind mount keeps its inode.
restore() { cat "$1" > "$CADDYFILE"; }

check() {
  local code
  code=$(curl -sk -o /dev/null -w '%{http_code}' --resolve "${SITE}:443:127.0.0.1" \
    "https://${SITE}/manage/api/v1/workspaces/00000000-0000-4000-8000-000000000000/devices/topologies" || true)
  echo "Topologieliste ohne Token: HTTP ${code} (erwartet 401 bei aktivem TSA, 404 wenn TSA aus)"
  code=$(curl -sk -o /dev/null -w '%{http_code}' --resolve "${SITE}:443:127.0.0.1" \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
    -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "https://${SITE}/ws/tsa" || true)
  echo "WebSocket ohne Token: HTTP ${code} (erwartet 401 bei aktivem TSA)"
  if docker exec "$CONTAINER" sh -c 'grep -c "x-auth-token=" /data/logs/access.json' 2>/dev/null | grep -qv '^0$'; then
    echo "Hinweis: Das Zugriffsprotokoll enthält ältere Einträge mit x-auth-token (vor dem Filter)."
  fi
}

case "${1:-}" in
  print) transform "$CADDYFILE" ;;
  apply)
    [ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo ausführen."; exit 2; }
    if grep -qF "$MARKER" "$CADDYFILE"; then echo "Bereits eingerichtet."; check; exit 0; fi
    backup="${CADDYFILE}.before-skyhub-tsa-$(date +%Y%m%d-%H%M%S)"
    cp -p "$CADDYFILE" "$backup"
    echo "Sicherung: $backup"
    new=$(mktemp); trap 'rm -f "$new"' EXIT
    transform "$CADDYFILE" > "$new"
    cat "$new" > "$CADDYFILE"
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
    ;;
  rollback)
    [ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo ausführen."; exit 2; }
    backup=$(ls -1t "${CADDYFILE}".before-skyhub-tsa-* 2>/dev/null | head -1 || true)
    [ -n "$backup" ] || { echo "Keine Sicherung gefunden."; exit 1; }
    restore "$backup"
    caddy reload
    echo "Wiederhergestellt aus $backup und neu geladen."
    ;;
  check) check ;;
  *) echo "Verwendung: sudo bash $0 apply|rollback   oder   bash $0 check|print"; exit 2 ;;
esac
