#!/usr/bin/env bash
# WPML mission library on the EXISTING backend MinIO account (no new user, no new secret).
#   bash scripts/pi-minio-wpml-store.sh plan       show state and what apply would do (no changes)
#   bash scripts/pi-minio-wpml-store.sh apply      create bucket skyhub-wpml (versioned), back up the current
#                                                  policy of the backend access key (SKYHUB_S3_ACCESS_KEY),
#                                                  extend it by storage/policies/skyhub-wpml-writer.json,
#                                                  verify, and set SKYHUB_WPML_STORE_ENABLED=true in .env
#   bash scripts/pi-minio-wpml-store.sh rollback   restore the backed-up policy and SKYHUB_WPML_STORE_ENABLED=false
# Added rights: list skyhub-wpml/missions/, read/write objects there. No delete, no other new bucket.
# Every existing read right of the account is kept unchanged. On any failure the old policy is restored.
# Root credentials are read from the private credentials file and passed to the container via stdin only.
set -Eeuo pipefail
umask 077
mode="${1:-plan}"
[[ $# -le 1 && "$mode" =~ ^(plan|apply|rollback)$ ]] ||
  { echo "Verwendung: bash scripts/pi-minio-wpml-store.sh plan|apply|rollback" >&2; exit 2; }
[[ $EUID != 0 ]] || { echo "Bitte ohne sudo ausführen." >&2; exit 2; }
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${SKYHUB_WPML_MINIO_CONTAINER:-skyhub-shared-minio}"
BUCKET=skyhub-wpml
POLICY_FILE="$root/storage/policies/skyhub-wpml-writer.json"
CREDENTIALS="${SKYHUB_SHARED_MINIO_CREDENTIALS_FILE:-$HOME/.config/skyhub/minio-shared.env}"
ENV_FILE="${SKYHUB_WPML_ENV_FILE:-$root/.env}"
BACKUP_DIR="${SKYHUB_WPML_BACKUP_DIR:-$HOME/.config/skyhub}"
LAST="$BACKUP_DIR/minio-backend-policy.before-wpml.json"

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
set_env() { # KEY VALUE: replace the first assignment, drop duplicates, append if missing
  python3 - "$ENV_FILE" "$1" "$2" <<'PY'
import sys
path, key, val = sys.argv[1:4]
out, seen = [], False
for line in open(path).read().split('\n'):
    if line.split('=', 1)[0] == key:
        if not seen:
            out.append(key + '=' + val); seen = True
    else:
        out.append(line)
while out and out[-1] == '':
    out.pop()
if not seen:
    out.append(key + '=' + val)
open(path, 'w').write('\n'.join(out) + '\n')
PY
  chmod 600 "$ENV_FILE"
}

[[ -r "$CREDENTIALS" ]] || { echo "FEHLT: MinIO-Zugangsdatei $CREDENTIALS" >&2; exit 1; }
[[ -r "$ENV_FILE" ]] || { echo "FEHLT: $ENV_FILE" >&2; exit 1; }
[[ -r "$POLICY_FILE" ]] || { echo "FEHLT: $POLICY_FILE" >&2; exit 1; }
if grep -qE 'Delete|"s3:\*"' "$POLICY_FILE"; then echo "FEHLER: Zusatzrichtlinie zu weit" >&2; exit 1; fi
docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -qx true || { echo "FEHLT: $CONTAINER läuft nicht" >&2; exit 1; }
root_user="$(value MINIO_ROOT_USER "$CREDENTIALS")"
root_pass="$(value MINIO_ROOT_PASSWORD "$CREDENTIALS")"
[[ -n "$root_user" && -n "$root_pass" ]] || { echo "FEHLT: MINIO_ROOT_USER/PASSWORD in $CREDENTIALS" >&2; exit 1; }
key="$(value SKYHUB_S3_ACCESS_KEY "$ENV_FILE")"
secret="$(value SKYHUB_S3_SECRET_KEY "$ENV_FILE")"
[[ -n "$key" && -n "$secret" ]] || { echo "FEHLT: SKYHUB_S3_ACCESS_KEY/SECRET_KEY (bestehendes Backend-Konto) in .env" >&2; exit 1; }
[[ "$key" != "$root_user" ]] || { echo "FEHLER: Backend nutzt den MinIO-Root – abgebrochen." >&2; exit 1; }

# stdin to the container: root user, root password, backend key, backend secret, then optional payload.
mc_in_container() {
  docker exec -i "$CONTAINER" sh -c 'IFS= read -r RU; IFS= read -r RP; IFS= read -r K; IFS= read -r S;
    export MC_CONFIG_DIR=/tmp/.mc-skyhub-wpml MC_HOST_sky="http://${RU}:${RP}@127.0.0.1:9000";
    export MC_HOST_be="http://${K}:${S}@127.0.0.1:9000"; '"$1"'
    rc=$?; rm -rf /tmp/.mc-skyhub-wpml /tmp/skyhub-wpml-policy.json; exit $rc'
}
run() { { printf '%s\n%s\n%s\n%s\n' "$root_user" "$root_pass" "$key" "$secret"; cat; } | mc_in_container "$1"; }

current_policy() { # prints the inline policy JSON of the backend access key
  run 'mc admin accesskey info sky "$K" --json' </dev/null | python3 -c '
import json, sys
info = json.load(sys.stdin)
pol = info.get("policy")
if info.get("impliedPolicy") or not pol:
    sys.exit("FEHLER: Konto hat keine eigene Inline-Policy (erbt vom Elternkonto) – abgebrochen.")
pol = json.loads(pol) if isinstance(pol, str) else pol
print(json.dumps(pol, indent=1))'
}
combined_policy() { # stdin: current policy -> current + WPML statements (idempotent)
  python3 -c '
import json, sys
cur = json.load(sys.stdin); add = json.load(open(sys.argv[1]))
have = [json.dumps(s, sort_keys=True) for s in cur["Statement"]]
for st in add["Statement"]:
    st = {k: v for k, v in st.items() if k != "Sid"}
    if json.dumps(st, sort_keys=True) not in have:
        cur["Statement"].append(st)
print(json.dumps(cur, indent=1))' "$POLICY_FILE"
}
set_policy() { # stdin: policy JSON
  run 'cat > /tmp/skyhub-wpml-policy.json && mc admin accesskey edit sky "$K" --policy /tmp/skyhub-wpml-policy.json >/dev/null'
}

bucket="nein"
if run "mc stat sky/$BUCKET >/dev/null 2>&1" </dev/null; then bucket="ja"; fi
before="$(current_policy)"
has_wpml="nein"; grep -q "arn:aws:s3:::$BUCKET/missions/\*" <<<"$before" && has_wpml="ja"
echo "MinIO-Container:      $CONTAINER"
echo "Backend-Konto:        bestehender Access Key aus SKYHUB_S3_ACCESS_KEY (kein neues Konto, kein neues Secret)"
echo "Bucket $BUCKET:   vorhanden: $bucket"
echo "WPML-Rechte am Konto: $has_wpml"
echo ".env:                 SKYHUB_WPML_STORE_ENABLED=$(value SKYHUB_WPML_STORE_ENABLED "$ENV_FILE" || true)"

if [[ "$mode" == plan ]]; then
  echo "apply würde: Bucket anlegen + versionieren, bisherige Policy sichern ($LAST),"
  echo "             Zusatzrechte aus $(basename "$POLICY_FILE") ergänzen, prüfen, .env-Schalter setzen."
  exit 0
fi

if [[ "$mode" == rollback ]]; then
  [[ -r "$LAST" ]] || { echo "FEHLT: gesicherte Policy $LAST" >&2; exit 1; }
  set_policy < "$LAST"
  cp -p "$ENV_FILE" "$ENV_FILE.before-wpml-rollback-$(date +%Y%m%d-%H%M%S)"
  set_env SKYHUB_WPML_STORE_ENABLED false
  echo "OK: bisherige Policy wiederhergestellt, SKYHUB_WPML_STORE_ENABLED=false. Bucket und Objekte bleiben erhalten."
  echo "Backend neu erzeugen: bash scripts/pi-update-backend.sh --apply"
  exit 0
fi

mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
if [[ "$has_wpml" == nein ]]; then
  printf '%s\n' "$before" > "$BACKUP_DIR/minio-backend-policy.before-wpml-$stamp.json"
  printf '%s\n' "$before" > "$LAST"
fi
restore() {
  echo "FEHLER – stelle bisherige Policy wieder her ..." >&2
  printf '%s\n' "$before" | set_policy && echo "Policy wiederhergestellt." >&2
}
trap restore ERR

run "mc mb --ignore-existing sky/$BUCKET >/dev/null && mc version enable sky/$BUCKET >/dev/null" </dev/null
printf '%s\n' "$before" | combined_policy | set_policy
# Verify with the backend's own key: new prefix usable, old read rights intact, delete denied.
run "mc ls be/$BUCKET/missions/ >/dev/null &&
  mc ls be/dji-cloud/ >/dev/null &&
  printf probe | mc pipe be/$BUCKET/missions/.skyhub-write-probe >/dev/null &&
  ! mc rm be/$BUCKET/missions/.skyhub-write-probe >/dev/null 2>&1 &&
  mc rm --versions --force sky/$BUCKET/missions/.skyhub-write-probe >/dev/null" </dev/null
trap - ERR
echo "OK: Bucket bereit; Backend-Konto kann missions/ lesen/schreiben, nicht löschen; bisherige Leserechte intakt."

cp -p "$ENV_FILE" "$ENV_FILE.before-wpml-store-$stamp"
set_env SKYHUB_WPML_STORE_ENABLED true
[[ "$(grep -c '^SKYHUB_WPML_STORE_ENABLED=' "$ENV_FILE")" == 1 ]] || { echo "FEHLER: Schalter nicht eindeutig" >&2; exit 1; }
echo ".env: SKYHUB_WPML_STORE_ENABLED=true (Sicherung: $ENV_FILE.before-wpml-store-$stamp). Kein Secret geändert."
echo "Aktivieren: bash scripts/pi-update-backend.sh --apply   (Rückweg: bash scripts/pi-minio-wpml-store.sh rollback)"
