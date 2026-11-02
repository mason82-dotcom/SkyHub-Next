#!/usr/bin/env bash
# Dedicated MinIO account for the DJI Pilot 2 media synchronisation (RC Plus 2 / RC Pro).
#   bash scripts/pi-minio-pilot-uploader.sh plan    what exists and what apply would do (no changes)
#   bash scripts/pi-minio-pilot-uploader.sh apply   create/rotate the account, attach the upload-only policy,
#                                                   store the secret privately and write it into .env (backup first)
# The account may only upload below dji-cloud/<workspace>/media/. The backend never hands this secret to
# the RC: it requests 15-minute AssumeRole credentials with an even narrower per-session policy.
# Root credentials are read from the private credentials file and passed to the container via stdin only.
set -Eeuo pipefail
umask 077
mode="${1:-plan}"
[[ $# -le 1 && "$mode" =~ ^(plan|apply)$ ]] || { echo "Verwendung: bash scripts/pi-minio-pilot-uploader.sh plan|apply" >&2; exit 2; }
[[ $EUID != 0 ]] || { echo "Bitte ohne sudo ausführen." >&2; exit 2; }
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER=skyhub-shared-minio
USER_NAME=skyhub-pilot-uploader
POLICY=skyhub-pilot-upload
CREDENTIALS="${SKYHUB_SHARED_MINIO_CREDENTIALS_FILE:-$HOME/.config/skyhub/minio-shared.env}"
OUT="$HOME/.config/skyhub/minio-pilot-uploader.env"
ENV_FILE="$root/.env"

value() { # KEY FILE -> value of KEY=... (no sourcing of shell code)
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
workspace="$(value SKYHUB_PILOT_WORKSPACE_ID "$ENV_FILE")"
[[ "$workspace" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] ||
  { echo "FEHLT: gültige SKYHUB_PILOT_WORKSPACE_ID in .env" >&2; exit 1; }

policy=$(cat <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
 "Action":["s3:PutObject","s3:AbortMultipartUpload","s3:ListMultipartUploadParts"],
 "Resource":["arn:aws:s3:::dji-cloud/${workspace}/media/*"]}]}
JSON
)

mc_in_container() { # stdin: root user, root password, then the script's own input
  docker exec -i "$CONTAINER" sh -c 'IFS= read -r RU; IFS= read -r RP;
    export MC_CONFIG_DIR=/tmp/.mc-skyhub; export MC_HOST_sky="http://${RU}:${RP}@127.0.0.1:9000"; '"$1"'
    rc=$?; rm -rf /tmp/.mc-skyhub /tmp/skyhub-pilot-upload.json; exit $rc'
}
root_user="$(value MINIO_ROOT_USER "$CREDENTIALS")"
root_pass="$(value MINIO_ROOT_PASSWORD "$CREDENTIALS")"
[[ -n "$root_user" && -n "$root_pass" ]] || { echo "FEHLT: MINIO_ROOT_USER/PASSWORD in $CREDENTIALS" >&2; exit 1; }

exists="nein"
if printf '%s\n%s\n' "$root_user" "$root_pass" | mc_in_container "mc admin user info sky $USER_NAME >/dev/null 2>&1"; then exists="ja"; fi
echo "Workspace:          $workspace"
echo "Upload-Konto:       $USER_NAME (vorhanden: $exists)"
echo "Richtlinie:         $POLICY -> PutObject/Multipart nur unter dji-cloud/$workspace/media/*"
echo "Private Ablage:     $OUT"
if [[ "$mode" == plan ]]; then
  echo "apply würde: Richtlinie anlegen/aktualisieren, Konto anlegen bzw. Schlüssel erneuern, .env ergänzen (mit Sicherung)."
  exit 0
fi

secret="$(openssl rand -hex 24)"
{ printf '%s\n%s\n%s\n' "$root_user" "$root_pass" "$secret"; printf '%s\n' "$policy"; } |
  mc_in_container "IFS= read -r NS; cat > /tmp/skyhub-pilot-upload.json &&
    mc admin policy create sky $POLICY /tmp/skyhub-pilot-upload.json >/dev/null &&
    mc admin user add sky $USER_NAME \"\$NS\" >/dev/null &&
    { mc admin policy attach sky $POLICY --user $USER_NAME >/dev/null 2>&1 || true; } &&
    mc admin user info sky $USER_NAME | grep -q $POLICY"
printf 'SKYHUB_PILOT_UPLOAD_S3_ACCESS_KEY=%s\nSKYHUB_PILOT_UPLOAD_S3_SECRET_KEY=%s\n' "$USER_NAME" "$secret" > "$OUT"
chmod 600 "$OUT"

backup="$ENV_FILE.before-pilot-uploader-$(date +%Y%m%d-%H%M%S)"
cp -p "$ENV_FILE" "$backup"
python3 - "$ENV_FILE" "$USER_NAME" "$secret" <<'PY'
import sys
path, user, secret = sys.argv[1:4]
wanted = {'SKYHUB_PILOT_UPLOAD_S3_ACCESS_KEY': user, 'SKYHUB_PILOT_UPLOAD_S3_SECRET_KEY': secret}
lines = open(path).read().split('\n')
out = []
for line in lines:
    key = line.split('=', 1)[0]
    if key in wanted:
        out.append(key + '=' + wanted.pop(key))
    else:
        out.append(line)
while out and out[-1] == '':
    out.pop()
out += [k + '=' + v for k, v in wanted.items()]
open(path, 'w').write('\n'.join(out) + '\n')
PY
chmod 600 "$ENV_FILE"
echo "OK: Konto eingerichtet, Richtlinie zugeordnet."
echo "Schlüssel privat gespeichert in $OUT und in .env eingetragen (Sicherung: $backup)."
echo "Der Schlüssel wurde nicht ausgegeben."
