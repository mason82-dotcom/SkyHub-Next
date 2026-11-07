#!/usr/bin/env bash
# Eigenes MinIO-Konto fuer die originalen DJI-Dateinamen (backend/pilot-media-rename.js): darf NUR Objekte unter
# dji-cloud/<Pilot-Arbeitsbereich>/media/ lesen, kopieren und loeschen. Keine Liste des Buckets, keine anderen Pfade.
# Vom Betreiber auf brix-node auszufuehren (ohne sudo):
#   bash scripts/minio-pilot-media-renamer.sh plan|apply|remove
# apply legt Richtlinie und Konto an (bzw. erneuert den Schluessel) und traegt die Schluessel in .env ein
# (SKYHUB_PILOT_MEDIA_RENAME_S3_ACCESS_KEY/_SECRET_KEY, nie ausgegeben). Danach Backend neu erzeugen.
set -Eeuo pipefail
umask 077
mode="${1:-plan}"
[[ $# -le 1 && "$mode" =~ ^(plan|apply|remove)$ ]] || { echo "Verwendung: $0 plan|apply|remove" >&2; exit 2; }
[[ $EUID != 0 ]] || { echo "Bitte ohne sudo ausführen." >&2; exit 2; }
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER=skyhub-shared-minio
USER_NAME=skyhub-pilot-media-renamer
POLICY=skyhub-pilot-media-rename
CREDENTIALS="${SKYHUB_SHARED_MINIO_CREDENTIALS_FILE:-$HOME/.config/skyhub/minio-shared.env}"
ENV_FILE="${SKYHUB_ENV_FILE:-$root/.env}"
value() { # KEY FILE -> Wert (ohne die Datei als Shell-Code auszufuehren)
  python3 - "$1" "$2" <<'PY'
import sys
key, path = sys.argv[1], sys.argv[2]
for line in open(path):
    line = line.rstrip('\n')
    if line.startswith(key + '='):
        print(line[len(key) + 1:].strip().strip('"').strip("'")); break
PY
}
[[ -r "$CREDENTIALS" ]] || { echo "FEHLT: MinIO-Zugangsdatei $CREDENTIALS" >&2; exit 1; }
[[ -r "$ENV_FILE" ]] || { echo "FEHLT: $ENV_FILE" >&2; exit 1; }
docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -qx true || { echo "FEHLT: $CONTAINER läuft nicht" >&2; exit 1; }
ws="$(value SKYHUB_PILOT_WORKSPACE_ID "$ENV_FILE")"
[[ "$ws" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "FEHLT: SKYHUB_PILOT_WORKSPACE_ID in $ENV_FILE" >&2; exit 1; }
policy='{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject"],"Resource":["arn:aws:s3:::dji-cloud/'"$ws"'/media/*"]}]}'
mc_in_container() { # stdin: Root-Benutzer, Root-Passwort, danach die eigene Eingabe des Befehls
  docker exec -i "$CONTAINER" sh -c 'IFS= read -r RU; IFS= read -r RP;
    export MC_CONFIG_DIR=/tmp/.mc-ren; export MC_HOST_sky="http://${RU}:${RP}@127.0.0.1:9000"; '"$1"'
    rc=$?; rm -rf /tmp/.mc-ren /tmp/pilot-media-rename.json; exit $rc'
}
root_user="$(value MINIO_ROOT_USER "$CREDENTIALS")"
root_pass="$(value MINIO_ROOT_PASSWORD "$CREDENTIALS")"
[[ -n "$root_user" && -n "$root_pass" ]] || { echo "FEHLT: MINIO_ROOT_USER/PASSWORD in $CREDENTIALS" >&2; exit 1; }
exists="nein"
if printf '%s\n%s\n' "$root_user" "$root_pass" | mc_in_container "mc admin user info sky $USER_NAME >/dev/null 2>&1"; then exists="ja"; fi
echo "Konto:        $USER_NAME (vorhanden: $exists)"
echo "Richtlinie:   $POLICY -> Get/Put/Delete nur dji-cloud/$ws/media/*"
echo "Ziel-.env:    $ENV_FILE"
case "$mode" in
  plan) echo "apply würde: Richtlinie anlegen/aktualisieren, Konto anlegen bzw. Schlüssel erneuern, .env ergänzen."; exit 0 ;;
  remove)
    printf '%s\n%s\n' "$root_user" "$root_pass" | mc_in_container \
      "mc admin user remove sky $USER_NAME >/dev/null 2>&1; mc admin policy remove sky $POLICY >/dev/null 2>&1; true"
    sed -i '/^SKYHUB_PILOT_MEDIA_RENAME_S3_/d' "$ENV_FILE"
    echo "OK: Konto und Richtlinie entfernt, Schlüssel aus .env gelöscht (SKYHUB_PILOT_MEDIA_DJI_NAMES auf false setzen)."
    exit 0 ;;
esac
secret="$(openssl rand -hex 24)"
{ printf '%s\n%s\n%s\n' "$root_user" "$root_pass" "$secret"; printf '%s\n' "$policy"; } |
  mc_in_container "IFS= read -r NS; cat > /tmp/pilot-media-rename.json &&
    mc admin policy create sky $POLICY /tmp/pilot-media-rename.json >/dev/null &&
    mc admin user add sky $USER_NAME \"\$NS\" >/dev/null &&
    { mc admin policy attach sky $POLICY --user $USER_NAME >/dev/null 2>&1 || true; } &&
    mc admin user info sky $USER_NAME | grep -q $POLICY"
cp -p "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d-%H%M%S)"
sed -i '/^SKYHUB_PILOT_MEDIA_RENAME_S3_/d' "$ENV_FILE"
printf 'SKYHUB_PILOT_MEDIA_RENAME_S3_ACCESS_KEY=%s\nSKYHUB_PILOT_MEDIA_RENAME_S3_SECRET_KEY=%s\n' "$USER_NAME" "$secret" >> "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "OK: Konto eingerichtet, Schlüssel in $ENV_FILE eingetragen (nicht ausgegeben)."
