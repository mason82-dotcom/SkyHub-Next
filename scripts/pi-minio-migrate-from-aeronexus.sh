#!/usr/bin/env bash
# Copy-free retirement of a historic AeroNexus MinIO into SkyHub ownership.
# PLAN only by default; split MOVE (atomic same-NVMe rename) and UP (new
# lightweight Compose container, reusing local image layers and data).
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="/mnt/hc4backup/aeronexus-data/minio"
TARGET="/mnt/hc4backup/skyhub-next/minio"
TARGET_PARENT="${TARGET%/*}"
MOUNT="/mnt/hc4backup"
PROJECT_DIR="${SKYHUB_PROJECT_DIR:-$ROOT}"
# Verify the active checkout, not a directory that happens to contain
# "storage/". A new SkyHub checkout need not have storage/ before migration.
[[ "$PROJECT_DIR" = /* && -d "$PROJECT_DIR" &&
   -f "$PROJECT_DIR/docker-compose.yml" && -d "$PROJECT_DIR/backend" ]] || {
  echo "ERROR: SKYHUB_PROJECT_DIR must point to an absolute SkyHub checkout (docker-compose.yml and backend/ required)" >&2
  exit 2
}
STORAGE_DIR="$PROJECT_DIR/storage"
[[ ! -L "$STORAGE_DIR" ]] ||
  { echo "ERROR: SkyHub storage/ directory may not be a symlink" >&2; exit 2; }
[[ ! -e "$STORAGE_DIR" || -d "$STORAGE_DIR" ]] ||
  { echo "ERROR: SkyHub storage/ path is not a directory" >&2; exit 2; }
LINK="$STORAGE_DIR/minio-data"
OLD_IMAGE="aeronexus/minio:RELEASE.2025-10-15T17-29-55Z-an1"
NEW_IMAGE="skyhub/minio:RELEASE.2025-10-15T17-29-55Z-an1"
EXPECTED_IMAGE_ID="sha256:117cf7edd050e6acd4a2d06be79b15eaecd5af76ad73e8927a4bf67528f19d10"
CREDENTIALS="$HOME/.config/skyhub/minio-shared.env"
COMPOSE_FILE="$ROOT/docker-compose.minio-shared.yml"
NETWORK="skyhub-storage-net"
LEGACY=(aeronexusadvanced-cloud-minio-1 aeronexus-edge-minio-1)

die() { echo "ERROR: $*" >&2; exit 2; }

usage() {
  cat <<'EOF'
Usage: bash scripts/pi-minio-migrate-from-aeronexus.sh [plan|move|up|start-plan|start|status]
  plan    READ ONLY: validate stopped old containers, NVMe, source, image,
          secret env keys, target vacancy and Docker state.
  move    OPT IN: export old MinIO env to local 0600 file; atomically RENAME
          data directory on the SAME NVMe, add Symlink in SkyHub checkout.
          Does not start Docker containers. No recursive copy.
  up      OPT IN: tag existing ARM64 image as skyhub/minio (zero layer copy),
          bring up ONE new skyhub-shared-minio service with NO host ports,
          attach running SkyHub backend to shared storage bridge.
  start-plan  READ ONLY: for the state AFTER a completed move (data already at the
          target, legacy containers and the AeroNexusAdvanced project gone). Checks data,
          credentials file (names only), image, mount, network and Compose; nothing changes.
  start   OPT IN: same checks as start-plan, then the same launch as 'up' (tag image,
          bridge network, ONE new skyhub-shared-minio without host ports, attach backend).
          Does not compare credentials with the AeroNexusAdvanced project (it no longer exists).
  status  READ ONLY: show source/destination mount status and container states.
NEVER use 'docker start' on historic AeroNexus containers: they expose port 9000.
Do not run with sudo; private credentials must belong to the invoking user.
EOF
}

require() {
  command -v "$1" >/dev/null 2>&1 || die "$1 command missing"
}

check_mount() {
  [[ -d "$MOUNT" && ! -L "$MOUNT" ]] || die "NVMe mountpoint unavailable"
  local mounted source fstype
  mounted="$(findmnt --target "$MOUNT" --noheadings --output TARGET)"
  source="$(findmnt --target "$MOUNT" --noheadings --output SOURCE)"
  fstype="$(findmnt --target "$MOUNT" --noheadings --output FSTYPE)"
  [[ "$mounted" == "$MOUNT" && "$fstype" == ext4 &&
     "$source" == /dev/nvme0n1p1 ]] ||
    die "Expected ext4 NVMe mounted on $MOUNT; got $source $mounted $fstype"
}

verify_old_stopped() {
  local name status image mount
  for name in "${LEGACY[@]}"; do
    status="$(docker inspect --format '{{.State.Running}}' "$name" 2>/dev/null)" ||
      die "Old container missing: $name"
    [[ "$status" == false ]] || die "Old MinIO still RUNNING: $name"
    image="$(docker inspect --format '{{.Config.Image}}' "$name")"
    mount="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$name")"
    [[ "$image" == "$OLD_IMAGE" && "$mount" == "$SOURCE" ]] ||
      die "Unexpected original image or /data source for $name"
  done
}

verify_image() {
  local id arch
  id="$(docker image inspect --format '{{.Id}}' "$OLD_IMAGE" 2>/dev/null)" ||
    die "Existing local ARM64 MinIO image missing; refuse remote pull"
  arch="$(docker image inspect --format '{{.Architecture}}' "$OLD_IMAGE")"
  [[ "$id" == "$EXPECTED_IMAGE_ID" && "$arch" == arm64 ]] ||
    die "Image does not match audited SHA256/arm64; manual review required"
}

verify_no_other_running() {
  local other
  other="$(docker ps --format '{{.Names}} {{.Image}}' |
    awk 'tolower($0) ~ /minio|aistor/ {print}')"
  [[ -z "$other" ]] || die "A MinIO-like container is running: $other"
}

verify_clean_destination() {
  [[ -d "$SOURCE" && ! -L "$SOURCE" ]] || die "Original data source missing"
  [[ -d "$SOURCE/.minio.sys" ]] || die "Original MinIO system metadata missing"
  [[ ! -e "$TARGET" && ! -L "$TARGET" ]] ||
    die "New destination already exists; refusing overwrite"
  [[ ! -e "$LINK" && ! -L "$LINK" ]] ||
    die "Project data link exists; refusing overwrite"
  if [[ -e "$TARGET_PARENT" ]]; then
    [[ -d "$TARGET_PARENT" && ! -L "$TARGET_PARENT" ]] ||
      die "Destination parent not a normal directory"
    [[ "$(stat -c %d "$SOURCE")" == "$(stat -c %d "$TARGET_PARENT")" ]] ||
      die "Destination is on different filesystem; cross-device copying forbidden"
  else
    [[ "$(stat -c %d "$SOURCE")" == "$(stat -c %d "$MOUNT")" ]] ||
      die "Storage source unexpectedly on a different filesystem"
  fi
}

verify_new_state() {
  [[ ! -e "$SOURCE" && ! -L "$SOURCE" ]] ||
    die "Legacy /data directory still exists; move not verified"
  [[ -d "$TARGET" && ! -L "$TARGET" && -d "$TARGET/.minio.sys" ]] ||
    die "Renamed MinIO directory or metadata is missing"
  [[ -L "$LINK" && "$(readlink -- "$LINK")" == "$TARGET" ]] ||
    die "SkyHub project storage symlink not pointing to expected target"
  [[ -f "$CREDENTIALS" && ! -L "$CREDENTIALS" ]] ||
    die "Private MinIO env file missing"
  [[ "$(stat -c %a "$CREDENTIALS")" == "600" ]] ||
    die "MinIO env file must have mode 0600"
}

verify_compose_version() {
  local ver
  ver="$(docker compose version --short 2>/dev/null)" ||
    die "Docker Compose plugin missing"
  python3 - "$ver" <<'PY'
import sys
parts = sys.argv[1].lstrip("v").split("-")[0].split(".")
if not len(parts) >= 2 or not all(part.isdigit() for part in parts[:2]):
    raise SystemExit("ERROR: cannot parse Docker Compose version.")
version = tuple(int(p) for p in (parts + ["0"])[:3])
if version < (2, 30, 0):
    raise SystemExit("ERROR: Compose 2.30+ required for raw env_file format.")
PY
}

preflight() {
  require docker;require findmnt;require python3;require stat
  verify_compose_version
  check_mount
  verify_old_stopped
  verify_image
}

status() {
  require docker;require findmnt
  echo "=== Copy-free SkyHub storage status ==="
  findmnt -T "$MOUNT" -o SOURCE,TARGET,FSTYPE
  for p in "$SOURCE" "$TARGET" "$LINK"; do
    if [[ -L "$p" ]]; then echo "Link: $p -> $(readlink -- "$p")"
    elif [[ -d "$p" ]]; then echo "Directory: $p"
    else echo "Absent: $p"; fi
  done
  for name in "${LEGACY[@]}" skyhub-shared-minio; do
    state="$(docker inspect --format '{{.State.Status}}' "$name" 2>/dev/null || true)"
    echo "Container: $name ${state:-not-created}"
  done
}

plan() {
  preflight;verify_no_other_running;verify_clean_destination
  python3 "$ROOT/scripts/pi-minio-credentials.py" check
  docker container inspect skyhub-shared-minio >/dev/null 2>&1 &&
    die "skyhub-shared-minio already exists; check its identity first"
  echo "READY: source and target reside on one NVMe; only atomic directory rename needed."
  echo "READY: image ID is the original audited ARM64 image; no layers copied."
  echo "READY: no legacy MinIO running; data source preserved until 'move'."
  if [[ -d "$STORAGE_DIR" ]]; then
    echo "SkyHub storage/ directory: present"
  else
    echo "SkyHub storage/ directory: absent (will be created by move only)"
  fi
  echo "Project link: $LINK -> $TARGET"
}

move() {
  plan
  [[ ! -e "$CREDENTIALS" && ! -L "$CREDENTIALS" ]] ||
    die "Credentials file already exists; refuse overwrite"
  python3 "$ROOT/scripts/pi-minio-credentials.py" export
  # Create only parent directories, never the MinIO data destination.
  # This is the FIRST step allowed to create storage/ in the active checkout.
  mkdir -p -- "$STORAGE_DIR"
  mkdir -p -- "$TARGET_PARENT"
  [[ "$(stat -c %d "$SOURCE")" == "$(stat -c %d "$TARGET_PARENT")" ]] ||
    die "Cross-filesystem move would copy data; abort"
  python3 - "$SOURCE" "$TARGET" <<'PY'
import os, pathlib, sys
src, dst = map(pathlib.Path, sys.argv[1:])
if os.stat(src).st_dev != os.stat(dst.parent).st_dev:
    raise SystemExit("ERROR: EXDEV would copy. No data moved.")
if os.path.lexists(dst):
    raise SystemExit("ERROR: destination already exists")
os.rename(src, dst)  # Metadata-only move within the same ext4 filesystem
PY
  ln -s -- "$TARGET" "$LINK"
  echo "MOVED WITHOUT COPY: $SOURCE -> $TARGET"
  echo "SkyHub project link created: $LINK"
  echo "Both historical Docker containers were left untouched and stopped."
  echo "NEXT: review status; only then run 'up'."
}

up() {
  preflight
  verify_no_other_running
  verify_new_state
  # Compare with the original AeroNexusAdvanced project dotenv before
  # any new MinIO instance can be launched. When more than one source
  # exists, select its PATH with SKYHUB_AERONEXUSADVANCED_ENV_FILE.
  local -a credential_check=(
    python3 "$ROOT/scripts/pi-minio-env-from-aeronexusadvanced.py"
    check --require-match
  )
  if [[ -n "${SKYHUB_AERONEXUSADVANCED_ENV_FILE:-}" ]]; then
    credential_check+=(--source "$SKYHUB_AERONEXUSADVANCED_ENV_FILE")
  fi
  "${credential_check[@]}" ||
    die "SkyHub credentials do not match AeroNexusAdvanced project's env; run safe check/import first"
  launch
}

launch() {
  docker container inspect skyhub-shared-minio >/dev/null 2>&1 &&
    die "skyhub-shared-minio exists; will not recreate it"
  [[ -f "$COMPOSE_FILE" ]] || die "SkyHub standalone Compose file missing"
  require readlink
  # Tag only when the SkyHub tag is not already present (idempotent, zero layer copy).
  docker image inspect "$NEW_IMAGE" >/dev/null 2>&1 || docker image tag "$OLD_IMAGE" "$NEW_IMAGE"
  [[ "$(docker image inspect --format '{{.Id}}' "$NEW_IMAGE")" == "$EXPECTED_IMAGE_ID" ]] ||
    die "SkyHub image tag references unexpected image"
  if docker network inspect "$NETWORK" >/dev/null 2>&1; then
    [[ "$(docker network inspect --format '{{.Driver}}' "$NETWORK")" == bridge ]] ||
      die "Storage Docker network exists with non-bridge driver"
  else
    docker network create --driver bridge "$NETWORK" >/dev/null
  fi
  export SKYHUB_SHARED_MINIO_CREDENTIALS_FILE="$CREDENTIALS"
  # Aborts if Compose version does not support raw env_file or syntax.
  docker compose -f "$COMPOSE_FILE" config --quiet
  docker compose -f "$COMPOSE_FILE" up -d --no-build --no-deps minio
  # The existing backend is network-attached without restart.
  SKYHUB_MINIO_EXPECTED_DATA_SOURCE="$TARGET" \
    bash "$ROOT/scripts/pi-minio-network.sh" adopt skyhub-shared-minio
  echo "Storage endpoint: http://skyhub-minio:9000 (Docker network only)."
  echo "NEXT (read-only): bash scripts/pi-minio-network.sh verify"
  echo "No data, images/layers or secrets copied to the project directory."
}

# State after a completed 'move': data already at TARGET, legacy containers and project removed.
verify_resume_state() {
  [[ -d "$TARGET" && ! -L "$TARGET" && -d "$TARGET/.minio.sys" ]] ||
    die "Migrated MinIO data or its metadata is missing: $TARGET"
  [[ ! -e "$SOURCE" && ! -L "$SOURCE" ]] ||
    die "Legacy data directory still exists: this is not a completed move; use plan/move"
  [[ "$(stat -c %d "$TARGET")" == "$(stat -c %d "$MOUNT")" ]] ||
    die "Target is not on the NVMe mount"
  [[ -f "$CREDENTIALS" && ! -L "$CREDENTIALS" ]] || die "Private MinIO env file missing: $CREDENTIALS"
  [[ "$(stat -c %a "$CREDENTIALS")" == "600" && "$(stat -c %u "$CREDENTIALS")" == "$(id -u)" ]] ||
    die "MinIO env file must be mode 0600 and owned by the current user"
  python3 - "$CREDENTIALS" <<'PY' || die "MinIO env file lacks the root credential keys"
import sys
keys = {}
for line in open(sys.argv[1], encoding="utf-8"):
    if "=" in line and not line.lstrip().startswith("#"):
        key, value = line.rstrip("\n").split("=", 1)
        keys[key] = value
missing = [k for k in ("MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD") if not keys.get(k)]
if missing:
    raise SystemExit("missing: " + ", ".join(missing))
PY
  local found=0 tag id arch
  for tag in "$NEW_IMAGE" "$OLD_IMAGE"; do
    id="$(docker image inspect --format '{{.Id}}' "$tag" 2>/dev/null)" || continue
    arch="$(docker image inspect --format '{{.Architecture}}' "$tag")"
    [[ "$id" == "$EXPECTED_IMAGE_ID" && "$arch" == arm64 ]] ||
      die "Image $tag does not match the audited SHA256/arm64"
    found=1
  done
  [[ "$found" == 1 ]] || die "No local audited MinIO image; refuse remote pull"
  local name running
  for name in "${LEGACY[@]}"; do
    running="$(docker inspect --format '{{.State.Running}}' "$name" 2>/dev/null || true)"
    [[ "$running" != true ]] || die "Legacy MinIO still RUNNING: $name"
  done
}

start_plan() {
  require docker;require findmnt;require python3;require stat
  verify_compose_version
  check_mount
  verify_resume_state
  verify_no_other_running
  docker container inspect skyhub-shared-minio >/dev/null 2>&1 &&
    die "skyhub-shared-minio already exists; check its identity first"
  [[ -f "$COMPOSE_FILE" ]] || die "SkyHub standalone Compose file missing"
  SKYHUB_SHARED_MINIO_CREDENTIALS_FILE="$CREDENTIALS" \
    docker compose -f "$COMPOSE_FILE" config --quiet || die "Standalone Compose configuration invalid"
  echo "READY: migrated data present at the target on the NVMe (.minio.sys found); legacy source gone."
  echo "READY: credentials file private (0600) with root keys present (values not read out)."
  echo "READY: audited ARM64 image available locally; no pull."
  echo "READY: no MinIO-like container running; skyhub-shared-minio does not exist yet."
  if docker network inspect "$NETWORK" >/dev/null 2>&1; then
    echo "Network $NETWORK: exists (will be reused)"
  else
    echo "Network $NETWORK: absent (start creates a bridge network)"
  fi
  if [[ -L "$LINK" ]]; then echo "Project link $LINK: present"
  else echo "Project link $LINK: absent (not required for start)"; fi
  echo "start would: tag the image if needed, create the network, start ONE skyhub-shared-minio"
  echo "without host ports, and attach a running SkyHub backend via 'pi-minio-network.sh adopt'."
}

start() {
  start_plan
  launch
}

mode="${1:-plan}"
[[ $# -le 1 ]] || { usage;exit 2; }
case "$mode" in
  plan) plan ;;
  move) move ;;
  up) up ;;
  start-plan) start_plan ;;
  start) start ;;
  status) status ;;
  help|-h|--help) usage ;;
  *) usage >&2;exit 2;;
esac
