#!/usr/bin/env bash
# Dedicated MinIO bucket + account for the SkyHub WPML mission library (KMZ files only).
#   bash scripts/pi-minio-wpml-store.sh plan    show state and what apply would do (no changes)
#   bash scripts/pi-minio-wpml-store.sh apply   create bucket skyhub-wpml (versioned), the policy
#                                               storage/policies/skyhub-wpml-writer.json and the account
#                                               skyhub-wpml-writer; store the secret privately and write
#                                               it into .env (backup first, restored on failure)
# The account can only list skyhub-wpml/missions/ and read/write objects there: no delete, no other
# bucket. The backend stores validated, write-once KMZ files; it never dispatches DJI flight tasks.
# Root credentials are read from the private credentials file and passed to the container via stdin only.
set -Eeuo pipefail
umask 077
mode="${1:-plan}"
[[ $# -le 1 && "$mode" =~ ^(plan|apply)$ ]] || { echo "Verwendung: bash scripts/pi-minio-wpml-store.sh plan|apply" >&2; exit 2; }
[[ $EUID != 0 ]] || { echo "Bitte ohne sudo ausführen." >&2; exit 2; }
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER=skyhub-shared-minio
BUCKET=skyhub-wpml
USER_NAME=skyhub-wpml-writer
POLICY=skyhub-wpml-writer
POLICY_FILE="$root/storage/policies/skyhub-wpml-writer.json"
CREDENTIALS="${SKYHUB_SHARED_MINIO_CREDENTIALS_FILE:-$HOME/.config/skyhub/minio-shared.env}"
OUT="$HOME/.config/skyhub/minio-wpml-writer.env"
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
[[ -r "$POLICY_FILE" ]] || { echo "FEHLT: $POLICY_FILE" >&2; exit 1; }
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$POLICY_FILE" ||
  { echo "FEHLER: Richtlinie ist kein gültiges JSON" >&2; exit 1; }
if grep -q 'DeleteObject\|"s3:\*"' "$POLICY_FILE"; then echo "FEHLER: Richtlinie zu weit" >&2; exit 1; fi
docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -qx true || { echo "FEHLT: $CONTAINER läuft nicht" >&2; exit 1; }

mc_in_container() { # stdin: root user, root password, then the script's own input
  docker exec -i "$CONTAINER" sh -c 'IFS= read -r RU; IFS= read -r RP;
    export MC_CONFIG_DIR=/tmp/.mc-skyhub-wpml; export MC_HOST_sky="http://${RU}:${RP}@127.0.0.1:9000"; '"$1"'
    rc=$?; rm -rf /tmp/.mc-skyhub-wpml /tmp/skyhub-wpml-writer.json; exit $rc'
}
root_user="$(value MINIO_ROOT_USER "$CREDENTIALS")"
root_pass="$(value MINIO_ROOT_PASSWORD "$CREDENTIALS")"
[[ -n "$root_user" && -n "$root_pass" ]] || { echo "FEHLT: MINIO_ROOT_USER/PASSWORD in $CREDENTIALS" >&2; exit 1; }
as_root() { printf '%s\n%s\n' "$root_user" "$root_pass" | mc_in_container "$1"; }

bucket="nein"; user="nein"
if as_root "mc stat sky/$BUCKET >/dev/null 2>&1"; then bucket="ja"; fi
if as_root "mc admin user info sky $USER_NAME >/dev/null 2>&1"; then user="ja"; fi
enabled="$(value SKYHUB_WPML_STORE_ENABLED "$ENV_FILE")"
echo "MinIO-Container:    $CONTAINER"
echo "Bucket:             $BUCKET (vorhanden: $bucket)"
echo "Konto:              $USER_NAME (vorhanden: $user)"
echo "Richtlinie:         $POLICY -> ListBucket(missions/*), GetObject+PutObject nur $BUCKET/missions/*, kein Löschen"
echo "Private Ablage:     $OUT"
echo ".env WPML-Speicher: SKYHUB_WPML_STORE_ENABLED=${enabled:-<nicht gesetzt>}"
if [[ "$mode" == plan ]]; then
  echo "apply würde: Bucket anlegen + Versionierung aktivieren, Richtlinie anlegen/aktualisieren,"
  echo "             Konto anlegen bzw. Schlüssel erneuern, Rechte prüfen, .env ergänzen (mit Sicherung)."
  exit 0
fi

secret="$(openssl rand -hex 24)"
{ printf '%s\n%s\n%s\n' "$root_user" "$root_pass" "$secret"; cat "$POLICY_FILE"; } |
  mc_in_container "IFS= read -r NS; cat > /tmp/skyhub-wpml-writer.json &&
    mc mb --ignore-existing sky/$BUCKET >/dev/null &&
    mc version enable sky/$BUCKET >/dev/null &&
    mc admin policy create sky $POLICY /tmp/skyhub-wpml-writer.json >/dev/null &&
    mc admin user add sky $USER_NAME \"\$NS\" >/dev/null &&
    { mc admin policy attach sky $POLICY --user $USER_NAME >/dev/null 2>&1 || true; } &&
    mc admin user info sky $USER_NAME | grep -q $POLICY &&
    export MC_HOST_w=\"http://$USER_NAME:\${NS}@127.0.0.1:9000\" &&
    mc ls w/$BUCKET/missions/ >/dev/null &&
    ! mc ls w/dji-cloud/ >/dev/null 2>&1"
echo "OK: Bucket, Richtlinie und Konto eingerichtet; Konto kann missions/ lesen, aber keinen fremden Bucket."

printf 'SKYHUB_WPML_S3_ACCESS_KEY=%s\nSKYHUB_WPML_S3_SECRET_KEY=%s\n' "$USER_NAME" "$secret" > "$OUT"
chmod 600 "$OUT"
backup="$ENV_FILE.before-wpml-store-$(date +%Y%m%d-%H%M%S)"
cp -p "$ENV_FILE" "$backup"
trap 'cp -p "$backup" "$ENV_FILE"; echo "FEHLER: .env aus $backup wiederhergestellt" >&2' ERR
python3 - "$ENV_FILE" "$USER_NAME" "$secret" "$BUCKET" <<'PY'
import sys
path, user, secret, bucket = sys.argv[1:5]
wanted = {'SKYHUB_WPML_STORE_ENABLED': 'true', 'SKYHUB_WPML_S3_BUCKET': bucket,
          'SKYHUB_WPML_S3_ACCESS_KEY': user, 'SKYHUB_WPML_S3_SECRET_KEY': secret}
out, seen = [], set()
for line in open(path).read().split('\n'):
    key = line.split('=', 1)[0]
    if key in wanted:
        if key not in seen:  # replace the first assignment, drop duplicates
            out.append(key + '=' + wanted[key])
            seen.add(key)
    else:
        out.append(line)
while out and out[-1] == '':
    out.pop()
out += [k + '=' + v for k, v in wanted.items() if k not in seen]
open(path, 'w').write('\n'.join(out) + '\n')
PY
chmod 600 "$ENV_FILE"
for key in SKYHUB_WPML_STORE_ENABLED SKYHUB_WPML_S3_ACCESS_KEY SKYHUB_WPML_S3_SECRET_KEY; do
  [[ "$(grep -c "^$key=" "$ENV_FILE")" == 1 ]] || { echo "FEHLER: $key nicht genau einmal in .env" >&2; false; }
done
trap - ERR
echo "Schlüssel privat gespeichert in $OUT und in .env eingetragen (Sicherung: $backup)."
echo "Der Schlüssel wurde nicht ausgegeben."
echo "Aktivieren: bash scripts/pi-update-backend.sh --apply   (Rückweg: SKYHUB_WPML_STORE_ENABLED=false + gleicher Weg)"
