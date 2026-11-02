#!/usr/bin/env bash
# Caddy routes for the DJI Pilot 2 wayline library (DJI Cloud API wayline/api/v1).
#   sudo bash scripts/pi-caddy-pilot-wayline.sh apply      add routes, validate, reload (automatic restore on failure)
#   sudo bash scripts/pi-caddy-pilot-wayline.sh rollback   restore the Caddyfile from before apply
#   bash scripts/pi-caddy-pilot-wayline.sh check           test reachability (no changes)
#   bash scripts/pi-caddy-pilot-wayline.sh print           show the resulting Caddyfile (no changes)
# 1. Site rpi5.fritz.box: /wayline/api/v1/workspaces/* -> backend 127.0.0.1:4001 (same as the media routes;
#    X-Auth-Token is already removed from that site's access log).
# 2. Site :9446 (S3 endpoint, home LAN only): GET/HEAD /skyhub-wpml/missions/* -> narrow proxy 127.0.0.1:4002,
#    which forwards only presigned requests for one wayline file (<uuid>.kmz) to MinIO. Signature query
#    parameters are already removed from that site's access log.
# 3. Site rpi5.fritz.box access log: also drop the response Location header, because the 302 of
#    .../waylines/{id}/url carries the presigned download link. Each part is added only if missing.
# Requires scripts/pi-caddy-pilot-media.sh to be applied first. Nothing else in the Caddyfile is changed.
set -euo pipefail

CADDYFILE="${SKYHUB_CADDYFILE:-/opt/caddy/Caddyfile}"
CONTAINER=caddy
SITE='rpi5.fritz.box'
S3_PORT=9446
MARKER='# SKYHUB-NEXT PILOT WAYLINE ROUTES'

transform() {
python3 - "$1" "$MARKER" "$S3_PORT" <<'PY'
import sys
path, marker, port = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()
lines = text.split('\n')
changed = False

def l_strip(line): return line.strip()

def block(head):
    start = [i for i, l in enumerate(lines) if l.strip() == head]
    if len(start) != 1: sys.exit('Site "%s" not found exactly once' % head)
    end = next((i for i in range(start[0] + 1, len(lines)) if lines[i] == '}'), None)
    if end is None: sys.exit('End of site "%s" not found' % head)
    return start[0], end

# 1) Main site: after the existing pilot media handle.
s, e = block('rpi5.fritz.box {')
routes_present = any(l.strip() == '@skyhub_pilot_wayline {' for l in lines[s:e])
media = [i for i in range(s, e) if lines[i].strip() == 'handle @skyhub_pilot_media {']
if len(media) != 1: sys.exit('Pilot media routes missing: run scripts/pi-caddy-pilot-media.sh apply first')
if not routes_present:
    close = next(i for i in range(media[0] + 1, e) if lines[i].strip() == '}')
    api = ['', '    ' + marker, '    # Managed by SkyHub-Next/scripts/pi-caddy-pilot-wayline.sh',
           '    @skyhub_pilot_wayline {', '        path /wayline/api/v1/workspaces/*', '    }',
           '    handle @skyhub_pilot_wayline {', '        reverse_proxy 127.0.0.1:4001', '    }']
    lines[close + 1:close + 1] = api
    changed = True

# 1b) Main site access log: drop the Location response header (presigned link of the 302).
s, e = block('rpi5.fritz.box {')
if not any(l.strip() == 'resp_headers>Location delete' for l in lines[s:e]):
    anchor = [i for i in range(s, e) if l_strip(lines[i]) == 'request>headers>X-Auth-Token delete']
    if len(anchor) != 1: sys.exit('Log filter of the main site not found exactly once')
    indent = lines[anchor[0]][:len(lines[anchor[0]]) - len(lines[anchor[0]].lstrip())]
    lines[anchor[0] + 1:anchor[0] + 1] = [indent + 'resp_headers>Location delete']
    changed = True

# 2) S3 site: before its catch-all 403.
s, e = block('rpi5.fritz.box:%s, 192.168.178.63:%s {' % (port, port))
if any(l.strip() == '@wayline_download {' for l in lines[s:e]):
    if not changed: sys.exit('Already applied')
    print('\n'.join(lines), end=''); sys.exit(0)
catch = [i for i in range(s, e) if lines[i] == '\thandle {']
if len(catch) != 1: sys.exit('Catch-all handle of the S3 site not found exactly once')
dl = ['\t' + marker + ' (download)', '\t# Managed by SkyHub-Next/scripts/pi-caddy-pilot-wayline.sh',
      '\t@wayline_download {', '\t\tremote_ip 192.168.178.0/24', '\t\tmethod GET HEAD',
      '\t\tpath /skyhub-wpml/missions/*', '\t}',
      '\thandle @wayline_download {', '\t\treverse_proxy 127.0.0.1:4002', '\t}']
lines[catch[0]:catch[0]] = dl
print('\n'.join(lines), end='')
PY
}

caddy() { docker exec "$CONTAINER" caddy "$@" --config /etc/caddy/Caddyfile --adapter caddyfile; }
# Write in place (cat >) so the single-file bind mount keeps its inode.
restore() { cat "$1" > "$CADDYFILE"; }

check() {
  local ws out code type
  ws=00000000-0000-4000-8000-000000000000
  out=$(curl -sk -o /dev/null -w '%{http_code} %{content_type}' --resolve "${SITE}:443:127.0.0.1" \
    "https://${SITE}/wayline/api/v1/workspaces/${ws}/waylines" || true)
  code=${out%% *}; type=${out#* }
  if [[ "$type" == application/json* ]]; then
    echo "Wayline-API über Caddy: HTTP ${code}, JSON vom SkyHub-Backend (erwartet 404/403; 404 auch solange die Bibliothek aus ist)"
  else
    echo "Wayline-API über Caddy: HTTP ${code} (${type:-?}) – NICHT vom SkyHub-Backend (Route fehlt?)"
  fi
  code=$(curl -sk -o /dev/null -w '%{http_code}' --resolve "${SITE}:${S3_PORT}:127.0.0.1" \
    "https://${SITE}:${S3_PORT}/skyhub-wpml/missions/00000000-0000-8000-8000-000000000000.kmz" || true)
  echo "Download-Endpunkt :${S3_PORT} von Loopback: HTTP ${code} (erwartet 403: nur Heimnetz)"
}

case "${1:-}" in
  print) transform "$CADDYFILE" ;;
  apply)
    [ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo ausführen."; exit 2; }
    new=$(mktemp); trap 'rm -f "$new"' EXIT
    if ! out=$(transform "$CADDYFILE" 2>&1 > "$new"); then
      if [[ "$out" == *"Already applied"* ]]; then echo "Bereits vollständig eingerichtet."; check; exit 0; fi
      echo "Abbruch: $out"; exit 1
    fi
    backup="${CADDYFILE}.before-skyhub-wayline-$(date +%Y%m%d-%H%M%S)"
    cp -p "$CADDYFILE" "$backup"
    echo "Sicherung: $backup"
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
    backup=$(ls -1t "${CADDYFILE}".before-skyhub-wayline-* 2>/dev/null | head -1 || true)
    [ -n "$backup" ] || { echo "Keine Sicherung gefunden."; exit 1; }
    restore "$backup"
    caddy reload
    echo "Wiederhergestellt aus $backup und neu geladen."
    ;;
  check) check ;;
  *) echo "Verwendung: sudo bash $0 apply|rollback   oder   bash $0 check|print"; exit 2 ;;
esac
