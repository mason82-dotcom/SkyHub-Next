#!/usr/bin/env bash
# Read-only on the Pi. Does not create files or contact S3.
set -Eeuo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
for tool in python3 docker tar zstd gpg sha256sum findmnt cryptsetup mkfs.ext4 mount umount fallocate systemd-run flock; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf '%s: available\n' "$tool"
  else
    printf '%s: MISSING (review required before execution)\n' "$tool"
  fi
done
findmnt --raw --noheadings --mountpoint /mnt/hc4backup -o SOURCE,TARGET,FSTYPE,OPTIONS
findmnt --raw --noheadings --mountpoint /mnt/benz -o SOURCE,TARGET,FSTYPE,OPTIONS
df -B1 --output=source,avail,target /mnt/benz
losetup --list
docker inspect --format 'State={{.State.Status}} Image={{.Image}} Restart={{.HostConfig.RestartPolicy.Name}}' skyhub-next-minio-1
python3 "$HERE/legacy_guard.py"
docker ps --filter network=skyhub-next_default --format '{{.Names}} {{.Status}}'
printf '%s\n' 'Read-only preflight complete. Client inventory and maintenance approval still required.'
