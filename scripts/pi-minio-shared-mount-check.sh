#!/usr/bin/env bash
# Read-only preflight for the shared SkyHub MinIO data directory on the Pi.
# Does NOT start containers, mount disks, list buckets, or access S3 credentials.
# The data was moved from /mnt/hc4backup/aeronexus-data/minio to the path below (same filesystem, no copy);
# SKYHUB_MINIO_DATA overrides it for other layouts.
set -Eeuo pipefail
data="${SKYHUB_MINIO_DATA:-/mnt/hc4backup/skyhub-next/minio}"
parent="/mnt/hc4backup"
printf '%s\n' '=== Shared SkyHub MinIO storage check (read-only) ==='
if [[ ! -d "$data" ]]; then
  echo "ERROR: expected MinIO data directory is missing: $data" >&2
  echo "Do NOT start MinIO: Docker may silently create a new empty bind directory." >&2
  exit 2
fi
if [[ -L "$parent" || -L "$data" ]]; then
  echo "ERROR: expected mount/data path is a symbolic link; audit before startup." >&2
  exit 2
fi
command -v findmnt >/dev/null 2>&1 || {
  echo "ERROR: findmnt required" >&2;exit 2
}
printf '%s\n' 'Storage filesystem:'
findmnt --target "$data" --noheadings --output SOURCE,TARGET,FSTYPE || {
  echo "ERROR: underlying filesystem not found" >&2; exit 2;
}
mount_target="$(findmnt --target "$data" --noheadings --output TARGET | head -n 1 | xargs)"
[[ -n "$mount_target" && "$mount_target" != "/" ]] || {
  echo "ERROR: MinIO data currently resolves onto the root filesystem." >&2
  echo "Expected external storage must be mounted before any MinIO start." >&2
  exit 2
}
# A non-root mount may be at /mnt/hc4backup, /mnt, or an actual nested mount.
# Do not claim that a specific physical disk exists merely from a path name.
case "$data/" in
  "$mount_target/"*) ;;
  *) echo "ERROR: unexpected filesystem target for MinIO source" >&2; exit 2 ;;
esac
printf '%s\n' 'Data directory metadata (no bucket names):'
stat -c 'Owner=%U:%G Mode=%a Type=%F' "$data"
printf '%s\n' 'Filesystem capacity:'
df -hP "$data" | tail -n 1
if [[ -d "$data/.minio.sys" ]]; then
  echo "Existing .minio.sys metadata directory: present"
else
  echo "Existing .minio.sys metadata directory: not observed (does not prove empty storage)"
fi
command -v docker >/dev/null 2>&1 || {
  echo "ERROR: Docker client required for container collision check" >&2; exit 2;
}
printf '%s\n' 'Containers referencing the same /data source:'
docker ps -a --format '{{.Names}}' | while IFS= read -r name; do
  line="$(docker inspect --format '{{.State.Status}}|{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}|{{.Source}}{{end}}{{end}}' "$name")"
  case "$line" in
    *"|bind|$data")
      printf '%s\n' "$name: ${line%%|*}" ;;
  esac
done
printf '%s\n' 'This check did not change any container, volume, network, or file.'
printf '%s\n' 'Do NOT start two MinIO servers on this shared directory.'
