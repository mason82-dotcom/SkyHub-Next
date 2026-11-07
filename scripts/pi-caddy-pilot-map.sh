#!/usr/bin/env bash
# Caddy routes for DJI Pilot 2 map elements and situation awareness (DJI Cloud API 1.18):
#   /map/api/v1/workspaces/*                              map element groups + create/update/delete (map-element-*.js)
#   /manage/api/v1/workspaces/*/devices/topologies        TSA device topology list (tsa-hub.js)
#   /ws/tsa                                               WebSocket: device_osd/topology + map_element_* pushes
#   sudo bash scripts/pi-caddy-pilot-map.sh apply      add routes, validate, reload (automatic restore on failure)
#   sudo bash scripts/pi-caddy-pilot-map.sh rollback   restore the Caddyfile from before apply
#   bash scripts/pi-caddy-pilot-map.sh check|print     test reachability / show the result (no changes)
# Inserted after the wayline routes of site rpi5.fritz.box, with the same upstream. Nothing else is changed;
# X-Auth-Token is already removed from that site's access log; the ws module's ?x-auth-token= query parameter is removed too.
set -euo pipefail

CADDYFILE="${SKYHUB_CADDYFILE:-/opt/caddy/Caddyfile}"
CONTAINER=caddy
SITE='rpi5.fritz.box'
MARKER='# SKYHUB-NEXT PILOT MAP + TSA ROUTES'

transform() {
python3 - "$1" "$MARKER" <<'PY'
import sys
path, marker = sys.argv[1], sys.argv[2]
lines = open(path).read().split('\n')
start = [i for i, l in enumerate(lines) if l.strip() == 'rpi5.fritz.box {']
if len(start) != 1: sys.exit('Site "rpi5.fritz.box" not found exactly once')
s = start[0]
e = next((i for i in range(s + 1, len(lines)) if lines[i] == '}'), None)
if e is None: sys.exit('End of site not found')
if any(l.strip() == '@skyhub_pilot_map {' for l in lines[s:e]): sys.exit('Already applied')
w = [i for i in range(s, e) if lines[i].strip() == 'handle @skyhub_pilot_wayline {']
if len(w) != 1: sys.exit('Wayline routes missing: run scripts/pi-caddy-pilot-wayline.sh apply first')
close = next(i for i in range(w[0] + 1, e) if lines[i].strip() == '}')
upstream = [lines[i].strip() for i in range(w[0] + 1, close) if lines[i].strip().startswith('reverse_proxy ')]
if len(upstream) != 1: sys.exit('Upstream of the wayline routes not found')
ind = lines[w[0]][:len(lines[w[0]]) - len(lines[w[0]].lstrip())]
block = ['', ind + marker, ind + '# Managed by SkyHub-Next/scripts/pi-caddy-pilot-map.sh',
         ind + '@skyhub_pilot_map {',
         ind + ind + 'path /map/api/v1/workspaces/* /manage/api/v1/workspaces/*/devices/topologies /ws/tsa',
         ind + '}', ind + 'handle @skyhub_pilot_map {', ind + ind + upstream[0], ind + '}']
lines[close + 1:close + 1] = block
# Access log of the site: Pilot 2's ws module passes the device token as ?x-auth-token=… → remove it from logged URIs.
s = start[0]; e = next(i for i in range(s + 1, len(lines)) if lines[i] == '}')
if not any(l.strip() == 'delete x-auth-token' for l in lines[s:e]):
    anchor = [i for i in range(s, e) if lines[i].strip() == 'request>headers>X-Auth-Token delete']
    if len(anchor) != 1: sys.exit('Log filter of the main site not found exactly once')
    li = lines[anchor[0]][:len(lines[anchor[0]]) - len(lines[anchor[0]].lstrip())]
    lines[anchor[0] + 1:anchor[0] + 1] = [li + 'request>uri query {', li + '\tdelete x-auth-token', li + '\tdelete X-Auth-Token', li + '}']
print('\n'.join(lines), end='')
PY
}

caddy() { docker exec "$CONTAINER" caddy "$@" --config /etc/caddy/Caddyfile --adapter caddyfile; }
restore() { cat "$1" > "$CADDYFILE"; }   # in place: the single-file bind mount keeps its inode

check() {
  local ws out
  ws=00000000-0000-4000-8000-000000000000
  out=$(curl -sk -o /dev/null -w '%{http_code} %{content_type}' --resolve "${SITE}:443:127.0.0.1" \
    "https://${SITE}/map/api/v1/workspaces/${ws}/element-groups" || true)
  echo "Kartenelemente über Caddy: ${out}  (erwartet 401/404 mit application/json vom SkyHub-Backend)"
  # HTTP/1.1: a WebSocket upgrade by header does not exist in HTTP/2 (curl would negotiate h2 and get the plain 404).
  out=$(curl -sk --http1.1 -o /dev/null -w '%{http_code}' --resolve "${SITE}:443:127.0.0.1" -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "https://${SITE}/ws/tsa" || true)
  echo "WebSocket /ws/tsa über Caddy: HTTP ${out}  (erwartet 401 ohne Token)"
}

case "${1:-}" in
  print) transform "$CADDYFILE" ;;
  apply)
    [ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo ausführen."; exit 2; }
    new=$(mktemp); trap 'rm -f "$new"' EXIT
    if ! out=$(transform "$CADDYFILE" 2>&1 > "$new"); then
      if [[ "$out" == *"Already applied"* ]]; then echo "Bereits eingerichtet."; check; exit 0; fi
      echo "Abbruch: $out"; exit 1
    fi
    backup="${CADDYFILE}.before-skyhub-map-$(date +%Y%m%d-%H%M%S)"
    cp -p "$CADDYFILE" "$backup"; echo "Sicherung: $backup"
    cat "$new" > "$CADDYFILE"
    if ! caddy validate >/dev/null 2>&1; then restore "$backup"; echo "Validierung fehlgeschlagen - wiederhergestellt."; exit 1; fi
    if ! caddy reload; then restore "$backup"; caddy reload || true; echo "Reload fehlgeschlagen - wiederhergestellt."; exit 1; fi
    echo "Caddy neu geladen."; sleep 2; check ;;
  rollback)
    [ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo ausführen."; exit 2; }
    backup=$(ls -1t "${CADDYFILE}".before-skyhub-map-* 2>/dev/null | head -1 || true)
    [ -n "$backup" ] || { echo "Keine Sicherung gefunden."; exit 1; }
    restore "$backup"; caddy reload; echo "Wiederhergestellt aus $backup." ;;
  check) check ;;
  *) echo "Verwendung: sudo bash $0 apply|rollback   oder   bash $0 check|print"; exit 2 ;;
esac
