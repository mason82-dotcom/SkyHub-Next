#!/usr/bin/env bash
# PREPARED ONLY. Writes exclusively to a new test image and temporary test runtime.
set +x
set -Eeuo pipefail
umask 077
[[ "${1:-}" == --execute-restore && $# == 2 ]] || {
  echo 'NOT EXECUTED. Usage after separate approval: sudo bash restore.sh --execute-restore /mnt/benz/skyhub-backup-...'
  exit 2
}
[[ $EUID == 0 ]] || { echo 'ERROR: root required'; exit 2; }
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKUP="$2"
[[ "$BACKUP" == /mnt/benz/skyhub-backup-* && -d "$BACKUP" && ! -L "$BACKUP" ]]
[[ "$(findmnt -nr --mountpoint /mnt/benz -o SOURCE)" == /dev/nvme1n1p1 ]]
[[ "$(findmnt -nr -T /run -o FSTYPE)" == tmpfs ]]
for tool in python3 docker tar zstd gpg cryptsetup mkfs.ext4 fallocate mount umount; do command -v "$tool" >/dev/null; done
[[ -x /home/mason/.local/bin/mc ]]
[[ -f "$BACKUP/ARCHIVE-COMPLETE.txt" ]]
python3 - "$BACKUP" <<'PY'
from pathlib import Path
import hashlib, shutil, sys
p = Path(sys.argv[1])
if p.resolve() != p or p.parent != Path('/mnt/benz'):
    raise SystemExit('ERROR: unexpected or symlinked backup path')
if shutil.disk_usage(p).free < 58*1024**3:
    raise SystemExit('ERROR: need 48 GiB restore image plus 10 GiB reserve')
rows = (p/'SHA256SUMS').read_text().splitlines()
expected_names = {'data.tar.zst.gpg', 'image.tar.zst.gpg'}
seen = set()
for row in rows:
    expected, name = row.split(maxsplit=1)
    name = name.lstrip('*')
    if name not in expected_names or name in seen or (p/name).is_symlink():
        raise SystemExit('ERROR: invalid checksum manifest')
    seen.add(name)
    h = hashlib.sha256()
    with (p/name).open('rb') as f:
        for chunk in iter(lambda: f.read(4*1024*1024), b''): h.update(chunk)
    if h.hexdigest() != expected:
        raise SystemExit('ERROR: encrypted archive checksum mismatch')
if seen != expected_names:
    raise SystemExit('ERROR: incomplete checksum manifest')
print('PASS: encrypted archive checksums.')
PY
read -r -p 'Create encrypted 48 GiB test image and isolated test container? Type RESTORE: ' answer </dev/tty
[[ "$answer" == RESTORE ]] || exit 2
read -r -s -p 'Archive passphrase: ' PASS </dev/tty; echo
read -r -s -p 'New test-image passphrase (store separately): ' KEY </dev/tty; echo
read -r -s -p 'Repeat test-image passphrase: ' REPEAT </dev/tty; echo
[[ -n "$PASS" && -n "$KEY" && "$KEY" == "$REPEAT" ]] || exit 2
unset REPEAT
STAGE="$(mktemp -d /run/skyhub-restore.XXXXXXXX)"
TOKEN="$(basename "$STAGE" | tr '.' '-')"
MAP="$TOKEN"
NET="$TOKEN-net"
TEST="$TOKEN-minio"
IMAGE_FILE="$(mktemp /mnt/benz/skyhub-restore-XXXXXXXX.luks)"
MOUNT="$STAGE/fs"
MAPPED=0; MOUNTED=0; NETWORKED=0; CONTAINER=0
finish() {
  local result=$?
  trap - EXIT
  unset PASS KEY
  if (( CONTAINER )); then
    docker stop --time 60 "$TEST" >/dev/null 2>&1 || true
    if ! docker rm -f "$TEST" >/dev/null; then
      echo 'CRITICAL: test container could not be removed; keep mount and mapper intact.' >&2
      echo "Test=$TEST Mount=$MOUNT Mapper=$MAP Image=$IMAGE_FILE" >&2
      exit 1
    fi
  fi
  if (( NETWORKED )); then docker network rm "$NET" >/dev/null || result=1; fi
  if (( MOUNTED )); then
    if ! umount "$MOUNT"; then
      echo "CRITICAL: unmount failed; do not close mapper or remove $STAGE" >&2
      exit 1
    fi
  fi
  if (( MAPPED )); then
    if ! cryptsetup close "$MAP"; then
      echo "CRITICAL: mapper still open: $MAP; test image: $IMAGE_FILE" >&2
      exit 1
    fi
  fi
  rm -rf -- "$STAGE"
  echo "Encrypted test image retained: $IMAGE_FILE"
  exit "$result"
}
trap finish EXIT
mkdir -m 700 "$STAGE/gnupg" "$MOUNT" "$STAGE/mc"
fallocate -l 48G "$IMAGE_FILE"
# Only the brand-new file above is formatted, never a physical device.
cryptsetup luksFormat --batch-mode --type luks2 --pbkdf pbkdf2 \
  --iter-time 2000 --key-file /proc/self/fd/3 "$IMAGE_FILE" 3<<<"$KEY"
cryptsetup open --type luks2 --key-file /proc/self/fd/3 "$IMAGE_FILE" "$MAP" 3<<<"$KEY"
MAPPED=1
mkfs.ext4 -q -m 0 "/dev/mapper/$MAP"
mount -t ext4 -o nodev,nosuid,noexec "/dev/mapper/$MAP" "$MOUNT"
MOUNTED=1
[[ "$(findmnt -nr --mountpoint "$MOUNT" -o FSTYPE)" == ext4 ]]
gpg --homedir "$STAGE/gnupg" --batch --pinentry-mode loopback \
  --no-symkey-cache --passphrase-fd 3 --decrypt "$BACKUP/data.tar.zst.gpg" 3<<<"$PASS" \
  | zstd -d | tar --numeric-owner --same-owner --same-permissions --acls \
      --xattrs --xattrs-include='*' -xpf - -C "$MOUNT"
python3 "$HERE/manifest.py" verify "$MOUNT/minio" "$MOUNT/evidence/files.jsonl"
IMAGE="$(cat "$MOUNT/evidence/image-id")"
[[ "$IMAGE" == sha256:117cf7edd050e6acd4a2d06be79b15eaecd5af76ad73e8927a4bf67528f19d10 ]]
docker image inspect "$IMAGE" >/dev/null || {
  echo 'ERROR: expected local image missing; image load needs separate review'; exit 2;
}
docker network create --internal --driver bridge "$NET" >/dev/null
NETWORKED=1
CONTAINER=1
docker run -d --pull=never --restart=no --name "$TEST" --network "$NET" \
  --env-file "$MOUNT/evidence/minio.env" \
  --mount "type=bind,source=$MOUNT/minio,target=/data" \
  --entrypoint /usr/bin/minio "$IMAGE" server /data --console-address :9001 >/dev/null
# Existing production containers, networks and data paths are never attached.
python3 - "$TEST" <<'PY'
import json, subprocess, sys, time, urllib.request
obj = json.loads(subprocess.check_output(['docker', 'inspect', sys.argv[1]]))[0]
net = next(iter(obj['NetworkSettings']['Networks'].values()))
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for attempt in range(20):
    try:
        with opener.open('http://'+net['IPAddress']+':9000/minio/health/ready', timeout=2) as r:
            if r.status == 200: break
    except Exception: pass
    time.sleep(1)
else: raise SystemExit('ERROR: isolated restored MinIO not ready')
print('PASS: isolated restore readiness HTTP 200.')
PY
python3 "$HERE/restore_probe.py" "$MOUNT" "$TEST" "$STAGE/mc"
echo 'Restore checks completed. Test container/network are removed and encrypted image is closed on exit.'
echo 'Production restart safety and persistence remain separate open acceptance items.'
