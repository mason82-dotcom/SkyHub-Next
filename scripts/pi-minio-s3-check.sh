#!/usr/bin/env bash
# Authenticated S3 health test in an ephemeral instance of the existing backend
# image. No host port is published; no existing service is restarted.
set -Eeuo pipefail
umask 077
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:---read}"
[[ $# -le 1 && ( "$mode" == --read || "$mode" == --write ) ]] || {
  echo "Usage: bash scripts/pi-minio-s3-check.sh [--read|--write]" >&2
  exit 2
}
for command in docker stat; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "ERROR: required command missing: $command" >&2; exit 2;
  }
done
private="$HOME/.config/skyhub/minio-s3-probe.env"
[[ -f "$private" && ! -L "$private" ]] || {
  echo "ERROR: private MinIO S3 client env missing or symbolic link" >&2
  echo "Expected: ~/.config/skyhub/minio-s3-probe.env" >&2;exit 2
}
perm="$(stat -c %a "$private")"
[[ "$perm" == 600 || "$perm" == 400 ]] || {
  echo "ERROR: private S3 credentials must be chmod 600 or chmod 400" >&2;exit 2
}
owner="$(stat -c %u "$private")"
[[ "$owner" == "$(id -u)" ]] || {
  echo "ERROR: private S3 credentials must be owned by the current user" >&2;exit 2
}
docker network inspect skyhub-storage-net >/dev/null 2>&1 || {
  echo "ERROR: shared MinIO network is not present" >&2;exit 2
}
# Use the *already built* backend image as a generic trusted Node 22 runtime.
# This is a new, temporary container (docker run --rm), not a service recreation.
mapfile -t ids < <(docker ps --filter label=com.docker.compose.project=skyhub-next \
  --filter label=com.docker.compose.service=backend --format '{{.ID}}')
(( ${#ids[@]} == 1 )) || {
  echo "ERROR: exactly one running SkyHub Next backend required" >&2;exit 2
}
image="$(docker inspect --format '{{.Image}}' "${ids[0]}")"
args=(--rm --network skyhub-storage-net --read-only --cap-drop ALL
  --security-opt no-new-privileges
  --tmpfs /tmp:rw,noexec,nosuid,size=16m
  --env-file "$private"
  --mount "type=bind,source=$root/scripts/minio-s3-probe.js,target=/opt/minio-s3-probe.js,readonly"
  --entrypoint node
)
if [[ "$mode" == --write ]]; then
  echo "WRITE PROBE: temporary key in the dedicated test bucket; deletion attempted."
  args+=(--env SKYHUB_S3_WRITE_PROBE=1)
fi
docker run "${args[@]}" "$image" /opt/minio-s3-probe.js "$mode"
