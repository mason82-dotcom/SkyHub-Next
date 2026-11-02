#!/usr/bin/env bash
# Caddy routes for the DJI Pilot 2 media synchronisation (manual upload from the Pilot 2 album).
#   sudo bash scripts/pi-caddy-pilot-media.sh apply      add routes + S3 site, validate, reload
#   sudo bash scripts/pi-caddy-pilot-media.sh rollback   restore the Caddyfile from before apply
#   bash scripts/pi-caddy-pilot-media.sh check           test reachability (no changes)
#   bash scripts/pi-caddy-pilot-media.sh print           show the resulting Caddyfile (no changes)
# 1. Site rpi5.fritz.box: /storage/api/v1/* (STS) and /media/api/v1/* (fingerprints, callbacks) -> backend 127.0.0.1:4001.
#    The X-Auth-Token header is already removed from that site's access log.
# 2. New site rpi5.fritz.box:9446 (home LAN only): S3 upload endpoint -> narrow upload proxy 127.0.0.1:4002,
#    which forwards only PUT/POST/HEAD below dji-cloud/<workspace>/media/<session>/ to MinIO.
#    Host header and SigV4 signature pass through unchanged; S3 auth headers are not logged.
set -euo pipefail

CADDYFILE=/opt/caddy/Caddyfile
CONTAINER=caddy
SITE='rpi5.fritz.box'
S3_PORT=9446
MARKER='# SKYHUB-NEXT PILOT MEDIA ROUTES'

transform() {
python3 - "$1" "$MARKER" "$S3_PORT" <<'PY'
import sys
path, marker, port = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()
if marker in text: sys.exit('Already applied')
lines = text.split('\n')
start = [i for i, l in enumerate(lines) if l.strip() == 'rpi5.fritz.box {']
if len(start) != 1: sys.exit('Site "rpi5.fritz.box {" not found exactly once')
end = next((i for i in range(start[0] + 1, len(lines)) if lines[i] == '}'), None)
if end is None: sys.exit('End of site block not found')
site = lines[start[0]:end + 1]
handle = [i for i, l in enumerate(site) if l.strip() == 'handle @skyhub_pilot {']
if len(handle) != 1: sys.exit('Existing "handle @skyhub_pilot" block not found exactly once')
close = next(i for i in range(handle[0] + 1, len(site)) if site[i].strip() == '}')
routes = ['', '    ' + marker, '    # Managed by SkyHub-Next/scripts/pi-caddy-pilot-media.sh',
  '    @skyhub_pilot_media {', '        path /storage/api/v1/workspaces/* /media/api/v1/workspaces/*', '    }',
  '    handle @skyhub_pilot_media {', '        reverse_proxy 127.0.0.1:4001', '    }']
site = site[:close + 1] + routes + site[close + 1:]
s3 = ['', marker + ' (S3 upload endpoint)', '# Managed by SkyHub-Next/scripts/pi-caddy-pilot-media.sh',
  'rpi5.fritz.box:' + port + ', 192.168.178.63:' + port + ' {',
  '\ttls internal',
  '\tlog {',
  '\t\toutput file /data/logs/access.json {',
  '\t\t\troll_size 10mb', '\t\t\troll_keep 5', '\t\t\troll_keep_for 168h', '\t\t}',
  '\t\tformat filter {', '\t\t\twrap json', '\t\t\tfields {',
  '\t\t\t\trequest>headers>Authorization delete',
  '\t\t\t\trequest>headers>X-Amz-Security-Token delete',
  '\t\t\t\trequest>uri query {', '\t\t\t\t\tdelete X-Amz-Signature', '\t\t\t\t\tdelete X-Amz-Security-Token',
  '\t\t\t\t\tdelete X-Amz-Credential', '\t\t\t\t}',
  '\t\t\t}', '\t\t}', '\t}',
  '\t@upload {', '\t\tremote_ip 192.168.178.0/24', '\t\tmethod PUT POST HEAD', '\t\tpath /dji-cloud/*', '\t}',
  '\thandle @upload {',
  '\t\trequest_body {', '\t\t\tmax_size 20GB', '\t\t}',
  '\t\treverse_proxy 127.0.0.1:4002 {', '\t\t\tflush_interval -1',
  '\t\t\ttransport http {', '\t\t\t\tread_timeout 0', '\t\t\t\twrite_timeout 0', '\t\t\t}', '\t\t}',
  '\t}',
  '\thandle {', '\t\trespond "Forbidden" 403', '\t}',
  '}']
out = lines[:start[0]] + site + lines[end + 1:]
while out and out[-1] == '': out.pop()
print('\n'.join(out + s3) + '\n', end='')
PY
}

caddy() { docker exec "$CONTAINER" caddy "$@" --config /etc/caddy/Caddyfile --adapter caddyfile; }
# Write in place (cat >) so the single-file bind mount keeps its inode.
restore() { cat "$1" > "$CADDYFILE"; }

check() {
  local ws code
  ws=00000000-0000-4000-8000-000000000000
  code=$(curl -sk -o /dev/null -w '%{http_code}' --resolve "${SITE}:443:127.0.0.1" -X POST \
    -H 'Content-Type: application/json' -d '{}' "https://${SITE}/storage/api/v1/workspaces/${ws}/sts" || true)
  echo "STS ohne Token: HTTP ${code} (erwartet 404 fremder Workspace bzw. 401; 404 auch bei Sync aus)"
  code=$(curl -sk -o /dev/null -w '%{http_code}' --resolve "${SITE}:${S3_PORT}:127.0.0.1" -X PUT \
    --data-binary x "https://${SITE}:${S3_PORT}/dji-cloud/${ws}/media/00000000000000000000000000000000/probe.txt" || true)
  echo "S3-Endpunkt :${S3_PORT} von Loopback: HTTP ${code} (erwartet 403: nur Heimnetz)"
}

case "${1:-}" in
  print) transform "$CADDYFILE" ;;
  apply)
    [ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo ausführen."; exit 2; }
    if grep -qF "$MARKER" "$CADDYFILE"; then echo "Bereits eingerichtet."; check; exit 0; fi
    backup="${CADDYFILE}.before-skyhub-media-$(date +%Y%m%d-%H%M%S)"
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
    backup=$(ls -1t "${CADDYFILE}".before-skyhub-media-* 2>/dev/null | head -1 || true)
    [ -n "$backup" ] || { echo "Keine Sicherung gefunden."; exit 1; }
    restore "$backup"
    caddy reload
    echo "Wiederhergestellt aus $backup und neu geladen."
    ;;
  check) check ;;
  *) echo "Verwendung: sudo bash $0 apply|rollback   oder   bash $0 check|print"; exit 2 ;;
esac
