#!/usr/bin/env bash
# Read-only helper for connecting the SkyHub Next backend to the shared MinIO with a READ-ONLY S3 account.
#   bash scripts/pi-minio-backend-access.sh plan       what is in place and what is missing (names only, no values)
#   bash scripts/pi-minio-backend-access.sh check      HEAD each bucket with the reader account in a temporary container
#   bash scripts/pi-minio-backend-access.sh override   print the local docker-compose.override.yml that keeps the backend on the storage network
# Nothing here changes Docker, MinIO, .env or any file. Secrets are never printed or passed as arguments.
set -Eeuo pipefail
umask 077
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
reader="${SKYHUB_S3_READER_ENV:-$HOME/.config/skyhub/minio-media-reader.env}"
network=skyhub-storage-net
buckets=(basemaps dji-cloud farming mapping-results pv-inspections)
mode="${1:-plan}"
[[ $# -le 1 && "$mode" =~ ^(plan|check|override)$ ]] || {
  echo "Usage: bash scripts/pi-minio-backend-access.sh [plan|check|override]" >&2; exit 2; }

ok()   { printf '  ok   %s\n' "$*"; }
miss() { printf '  FEHL %s\n' "$*"; bad=1; }
# Voraussetzungen, ohne die 'check' nichts pruefen kann (die Verdrahtung in .env/Override gehoert nicht dazu).
need() { printf '  FEHL %s\n' "$*"; bad=1; crit=1; }
note() { printf '  Hinweis %s\n' "$*"; }
bad=0; crit=0

if [[ "$mode" == override ]]; then
  cat <<'YAML'
# Lokal als docker-compose.override.yml im SkyHub-Next-Ordner ablegen (per .gitignore ausgeschlossen).
# Compose laedt die Datei automatisch, auch bei scripts/pi-update-backend.sh: so bleibt das Backend nach einem
# Recreate im Speichernetz (ohne sie geht die mit `adopt` gesetzte Netzzuordnung verloren).
services:
  backend:
    networks:
      - default
      - shared_storage
networks:
  shared_storage:
    name: skyhub-storage-net
    external: true
YAML
  exit 0
fi

keys_of() { sed -nE 's/^([A-Z0-9_]+)=.*/\1/p' "$1"; }
value_of() { sed -nE "s/^$2=(.*)$/\1/p" "$1" | head -1; }

echo "=== Backend-Zugang zum gemeinsamen MinIO (nur lesend) ==="
if docker inspect --format '{{.State.Running}}' skyhub-shared-minio 2>/dev/null | grep -qx true; then ok "skyhub-shared-minio laeuft"; else need "skyhub-shared-minio laeuft nicht (zuerst: pi-minio-migrate-from-aeronexus.sh start)"; fi
if docker network inspect "$network" >/dev/null 2>&1; then ok "Netz $network vorhanden"; else need "Netz $network fehlt"; fi
if [[ -f "$reader" && ! -L "$reader" && "$(stat -c %a "$reader")" == 600 && "$(stat -c %u "$reader")" == "$(id -u)" ]]; then
  ok "Reader-Datei privat (0600, eigener Benutzer)"
  for key in SKYHUB_S3_ACCESS_KEY SKYHUB_S3_SECRET_KEY SKYHUB_S3_ENDPOINT; do
    keys_of "$reader" | grep -qx "$key" && [[ -n "$(value_of "$reader" "$key")" ]] && ok "$key gesetzt (Wert nicht gelesen)" || need "$key fehlt oder ist leer"
  done
  endpoint="$(value_of "$reader" SKYHUB_S3_ENDPOINT)"
  host="$(python3 -c 'import sys,urllib.parse as u;print(u.urlsplit(sys.argv[1]).hostname or "")' "$endpoint" 2>/dev/null || true)"
  if [[ "$host" == skyhub-minio ]]; then ok "Endpunkt-Host in der Reader-Datei ist skyhub-minio"
  else note "Reader-Datei nennt den Host '${host:-?}' (alter Dienstname); im Netz heisst der Server skyhub-minio. check und .env verwenden http://skyhub-minio:9000"; fi
else
  need "Reader-Datei fehlt oder ist nicht privat: $reader (0600, eigener Benutzer, kein Symlink)"
fi
# Backend-Konfiguration (nur Namen), Netzzuordnung, Override
envfile="$root/.env"
if [[ -f "$envfile" ]]; then
  for key in SKYHUB_MEDIA_ENABLED SKYHUB_S3_ENDPOINT SKYHUB_S3_ACCESS_KEY SKYHUB_S3_SECRET_KEY; do
    keys_of "$envfile" | grep -qx "$key" && ok ".env enthaelt $key" || miss ".env enthaelt $key noch nicht"
  done
  [[ "$(value_of "$envfile" SKYHUB_MEDIA_ENABLED)" == true ]] && ok "SKYHUB_MEDIA_ENABLED=true" || miss "SKYHUB_MEDIA_ENABLED ist nicht true"
  # Root-Zugangsdaten duerfen nie als S3-Konto des Backends dienen.
  if [[ -f "$HOME/.config/skyhub/minio-shared.env" ]]; then
    rootuser="$(value_of "$HOME/.config/skyhub/minio-shared.env" MINIO_ROOT_USER)"
    [[ -n "$rootuser" && "$(value_of "$envfile" SKYHUB_S3_ACCESS_KEY)" == "$rootuser" ]] && miss "SKYHUB_S3_ACCESS_KEY ist der MinIO-Root-Benutzer: nie verwenden" || ok "S3-Konto des Backends ist nicht der MinIO-Root-Benutzer"
  fi
else
  miss ".env fehlt im Projektordner"
fi
backend="$(docker ps --filter label=com.docker.compose.project=skyhub-next --filter label=com.docker.compose.service=backend --format '{{.ID}}' | head -1)"
if [[ -n "$backend" ]]; then
  docker inspect --format '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' "$backend" | grep -qx "$network" \
    && ok "laufendes Backend ist im Netz $network" || miss "laufendes Backend ist nicht im Netz $network (adopt oder Recreate mit Override)"
else
  need "kein laufendes SkyHub-Next-Backend gefunden"
fi
[[ -f "$root/docker-compose.override.yml" ]] && ok "docker-compose.override.yml vorhanden (haelt die Netzzuordnung beim Recreate)" || miss "docker-compose.override.yml fehlt: ohne sie geht die Netzzuordnung beim naechsten Backend-Update verloren (override zeigt den Inhalt)"
# Policy-Vorlage im Repo gegen die tatsaechlich genutzten Buckets
python3 - "$root" <<'PY' && ok "Repo-Policy skyhub-backend-reader.json: nur ListBucket/GetObject auf die fuenf Buckets" || miss "Repo-Policy passt nicht zu den Buckets des Backends"
import json, re, sys
root = sys.argv[1]
policy = json.load(open(f"{root}/storage/policies/skyhub-backend-reader.json"))
actions = {a for s in policy["Statement"] for a in s["Action"]}
resources = {r.removeprefix("arn:aws:s3:::").removesuffix("/*") for s in policy["Statement"] for r in s["Resource"]}
used = set(re.findall(r"'([a-z-]+)'", re.search(r"BUCKETS=Object\.freeze\(\[(.*?)\]\)", open(f"{root}/backend/s3-storage.js").read(), re.S).group(1)))
raise SystemExit(0 if actions == {"s3:ListBucket", "s3:GetObject"} and resources == used else 1)
PY

if [[ "$mode" == plan ]]; then
  echo "Ergebnis: $([[ $bad == 0 ]] && echo 'alles vorhanden' || echo 'Luecken (FEHL oben)')"
  exit "$bad"
fi

# check: temporaerer, gehaerteter Container mit dem Reader-Konto, nur HEAD je Bucket (kein Schreiben, keine Objekte)
[[ $crit == 0 ]] || { echo "Abbruch: erst die Voraussetzungen aus 'plan' schliessen." >&2; exit 2; }
image="$(docker inspect --format '{{.Image}}' "$backend")"
echo "=== HEAD je Bucket mit dem Reader-Konto ==="
fail=0
for bucket in "${buckets[@]}"; do
  if out="$(docker run --rm --network "$network" --read-only --cap-drop ALL --security-opt no-new-privileges \
      --tmpfs /tmp:rw,noexec,nosuid,size=16m --env-file "$reader" -e "SKYHUB_S3_BUCKET=$bucket" \
      -e SKYHUB_S3_ENDPOINT=http://skyhub-minio:9000 \
      --mount "type=bind,source=$root/scripts/minio-s3-probe.js,target=/opt/minio-s3-probe.js,readonly" \
      --entrypoint node "$image" /opt/minio-s3-probe.js --read 2>&1)"; then
    printf '  ok   %-16s %s\n' "$bucket" "$out"
  else
    printf '  FEHL %-16s %s\n' "$bucket" "$out"; fail=1
  fi
done
exit "$fail"
