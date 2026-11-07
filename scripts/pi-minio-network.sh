#!/usr/bin/env bash
# Opt-in Raspberry Pi MinIO network integration.
# Default is read-only. No docker compose down, volumes rm, or container restart.
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
NETWORK="skyhub-storage-net"
PROJECT="skyhub-next"
COMPOSE=(
  docker compose --project-name "$PROJECT"
  --env-file "$ROOT/.env"
  -f "$ROOT/docker-compose.yml"
  -f "$ROOT/docker-compose.storage.yml"
  --profile media
)

usage() {
  cat <<'USAGE'
Usage: bash scripts/pi-minio-network.sh [plan|apply [--allow-legacy-image]|adopt EXISTING_MINIO|attach CONTAINER...|verify]
  plan      Read-only inventory; does not create a network or run a container.
  apply     Create the shared network, start ONLY SkyHub MinIO, connect a running
            SkyHub Next backend if present. Does NOT recreate the backend.
  adopt     Reuse an existing RUNNING MinIO from a different Compose stack.
            Attach the server and the SkyHub backend; do not create MinIO.
  attach    Explicitly join named existing application containers to the shared
            bridge. Does not restart them or pass credentials.
  verify    Read-only inspect + MinIO HTTP readiness check through SkyHub backend.
            Works with a SkyHub-owned or explicitly adopted MinIO.
  --allow-legacy-image: FOR ISOLATED TESTS ONLY; 2023 MinIO is not supported.
Never pass secrets as command-line arguments. Do not paste .env into logs.
USAGE
}

require_docker() {
  command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not found" >&2; exit 2; }
  docker info >/dev/null 2>&1 || { echo "ERROR: Docker daemon inaccessible" >&2; exit 2; }
}

network_exists() { docker network inspect "$NETWORK" >/dev/null 2>&1; }

ensure_network() {
  if ! network_exists; then
    docker network create --driver bridge "$NETWORK" >/dev/null
    echo "Created shared Docker bridge: $NETWORK"
  fi
}

check_network() {
  if network_exists; then
    local driver
    driver="$(docker network inspect --format '{{.Driver}}' "$NETWORK")"
    [[ "$driver" == "bridge" ]] || {
      echo "ERROR: $NETWORK exists but is not a bridge (driver: $driver)" >&2
      exit 2
    }
  fi
}

is_connected() {
  [[ "$(docker inspect --format '{{if index .NetworkSettings.Networks "skyhub-storage-net"}}yes{{else}}no{{end}}' "$1")" == yes ]]
}

# Look up the exact network-scoped DNS alias. A name alone is not trustworthy:
# two containers sharing an alias would make S3 routing nondeterministic.
alias_owners() {
  network_exists || return 0
  local -a ids=()
  local id
  mapfile -t ids < <(docker ps --no-trunc --filter "network=$NETWORK" --format '{{.ID}}')
  for id in "${ids[@]}"; do
    if docker inspect --format '{{with index .NetworkSettings.Networks "skyhub-storage-net"}}{{range .Aliases}}{{println .}}{{end}}{{end}}' "$id" |
      grep -Fxq skyhub-minio; then
      printf '%s\n' "$id"
    fi
  done
}

assert_alias_available() {
  local target="${1:-}"
  local -a owners=()
  mapfile -t owners < <(alias_owners)
  if (( ${#owners[@]} > 1 )); then
    echo "ERROR: duplicate skyhub-minio DNS aliases; refusing ambiguous routing" >&2
    exit 2
  fi
  if (( ${#owners[@]} == 1 )) && [[ "${owners[0]}" != "$target" ]]; then
    echo "ERROR: skyhub-minio alias already owned by a different container" >&2
    exit 2
  fi
}

single_running_service() {
  local service="$1"
  local -a ids=()
  mapfile -t ids < <(
    docker ps --filter "label=com.docker.compose.project=$PROJECT" \
      --filter "label=com.docker.compose.service=$service" --format '{{.ID}}'
  )
  if (( ${#ids[@]} > 1 )); then
    echo "ERROR: multiple running containers for $PROJECT/$service; refusing ambiguous operation" >&2
    exit 2
  fi
  if (( ${#ids[@]} == 1 )); then printf '%s\n' "${ids[0]}"; fi
}

connect_existing() {
  local target="$1"
  if is_connected "$target"; then
    echo "OK: container already attached to $NETWORK"
  else
    docker network connect "$NETWORK" "$target"
    echo "OK: attached container to $NETWORK (connection may be lost on recreation)"
  fi
}

plan() {
  printf '=== Shared MinIO preflight (read-only) ===\n'
  if network_exists; then
    check_network
    echo "Network: $NETWORK (exists)"
  else
    echo "Network: $NETWORK (not created)"
  fi
  echo "MinIO-like containers (name / image, including stopped):"
  docker ps -a --format '{{.Names}} {{.Image}}' |
    awk '{ line=tolower($0); if (line ~ /minio|aistor/) print }'
  if docker volume inspect "${PROJECT}_minio_data" >/dev/null 2>&1; then
    echo "Existing SkyHub MinIO volume: present (will be preserved)"
  else
    echo "Existing SkyHub MinIO volume: absent (first start creates it)"
  fi
  if [[ -f "$ROOT/.env" ]]; then
    if "${COMPOSE[@]}" config --quiet >/dev/null; then
      echo "Combined Compose configuration: valid (credentials not printed)"
    else
      echo "ERROR: combined Compose configuration invalid" >&2
      return 2
    fi
  else
    echo "WARNING: .env missing; cannot validate deployment configuration"
  fi
  echo "No containers, networks or volumes were modified."
}

apply() {
  [[ "${1:-}" == "" || "${1:-}" == "--allow-legacy-image" ]] || { usage; exit 2; }
  [[ -f "$ROOT/.env" ]] || { echo "ERROR: private .env missing" >&2; exit 2; }
  command -v python3 >/dev/null || { echo "ERROR: python3 required" >&2; exit 2; }
  "${COMPOSE[@]}" config --quiet >/dev/null
  check_network

  # Multiple MinIO installations could mean existing data must be reused,
  # not silently replaced with a second empty instance.
  local other
  other="$(docker ps -a --format '{{.Names}} {{.Image}}' |
    awk '{ line=tolower($0); if (line ~ /minio|aistor/ && $1 !~ /^skyhub-next-minio-[0-9]+$/) print $1 }')"
  [[ -z "$other" ]] || {
    echo "ERROR: other MinIO-like containers found; audit/reuse them before deploying another:" >&2
    printf '%s\n' "$other" >&2
    exit 2
  }

  local image
  image="$("${COMPOSE[@]}" config --format json |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["minio"]["image"])')"
  if [[ "$image" == "minio/minio:RELEASE.2023-09-04T19-57-37Z" &&
        "${1:-}" != "--allow-legacy-image" ]]; then
    echo "ERROR: 2023 MinIO image is obsolete; choose a reviewed, ARM64-capable" >&2
    echo "SKYHUB_MINIO_IMAGE in private .env, or use --allow-legacy-image for isolated tests." >&2
    exit 2
  fi
  # Adopt a running SkyHub MinIO without recreating it (and without
  # changing root credentials or rewriting its existing data mount).
  local -a existing=()
  mapfile -t existing < <(docker ps -a \
    --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=minio" --format '{{.ID}}')
  if (( ${#existing[@]} > 1 )); then
    echo "ERROR: multiple SkyHub MinIO containers; manual audit required" >&2
    exit 2
  fi
  if (( ${#existing[@]} == 1 )); then
    local current_image data_volume running
    current_image="$(docker inspect --format '{{.Config.Image}}' "${existing[0]}")"
    data_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "${existing[0]}")"
    running="$(docker inspect --format '{{.State.Running}}' "${existing[0]}")"
    [[ "$current_image" == "$image" && "$data_volume" == "${PROJECT}_minio_data" ]] || {
      echo "ERROR: existing MinIO image or /data mount differs from this Compose configuration." >&2
      echo "Do not replace storage silently; audit image and mount privately." >&2
      exit 2
    }
    assert_alias_available "$(docker inspect --format '{{.Id}}' "${existing[0]}")"
    ensure_network
    if [[ "$running" == true ]]; then
      if is_connected "${existing[0]}"; then
        local -a owners=()
        mapfile -t owners < <(alias_owners)
        [[ ${#owners[@]} == 1 ]] || {
          echo "ERROR: SkyHub MinIO joined without skyhub-minio alias; manual correction required" >&2
          exit 2
        }
        echo "OK: running SkyHub MinIO already on the shared bridge"
      else
        docker network connect --alias skyhub-minio "$NETWORK" "${existing[0]}"
        echo "OK: running SkyHub MinIO joined without recreation"
      fi
    else
      echo "ERROR: stopped MinIO must be audited and restarted manually; no automatic recreation" >&2
      exit 2
    fi
  else
    # First installation only. Never create a fresh container against an
    # unknown pre-existing /data volume without a backup/restore audit.
    if docker volume inspect "${PROJECT}_minio_data" >/dev/null 2>&1; then
      echo "ERROR: MinIO data volume exists but container is missing; audit data first" >&2
      exit 2
    fi
    assert_alias_available ""
    ensure_network
    "${COMPOSE[@]}" up -d --no-deps minio
  fi

  local backend
  backend="$(single_running_service backend)"
  if [[ -n "$backend" ]]; then
    connect_existing "$backend"
  else
    echo "INFO: SkyHub backend not running; it can be attached later."
  fi
  echo "Storage endpoint for joined containers: http://skyhub-minio:9000"
  echo "No buckets, IAM users or application media APIs were created."
}

adopt() {
  [[ $# == 1 ]] || { echo "ERROR: adopt requires exactly one container name" >&2; exit 2; }
  local name="$1" image running mount mode backend
  [[ "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || {
    echo "ERROR: invalid container name" >&2; exit 2;
  }
  # The operator explicitly selects the existing MinIO container. It is
  # never stopped or recreated, and no volumes or secrets are touched.
  image="$(docker inspect --format '{{.Config.Image}}' "$name" 2>/dev/null)" || {
    echo "ERROR: MinIO container not found" >&2; exit 2;
  }
  [[ "${image,,}" == *minio* || "${image,,}" == *aistor* ]] || {
    echo "ERROR: container image does not identify a MinIO server" >&2
    exit 2
  }
  running="$(docker inspect --format '{{.State.Running}}' "$name")"
  [[ "$running" == true ]] || {
    echo "ERROR: existing MinIO is not running; do not start it automatically" >&2
    exit 2
  }
  # SkyHub talks S3 through skyhub-storage-net; a published Docker HostPort
  # 9000 is unnecessary and may expose an authenticated but sensitive service
  # to the LAN or upstream networks. Reject even loopback published bindings
  # so a later network-mode/compose change cannot widen access unnoticed.
  local s3_host_bindings
  s3_host_bindings="$(docker inspect --format '{{with index .HostConfig.PortBindings "9000/tcp"}}{{range .}}{{println .HostIp ":" .HostPort}}{{end}}{{end}}' "$name")"
  [[ -z "$s3_host_bindings" ]] || {
    echo "ERROR: MinIO publishes S3/tcp 9000 to the Docker host." >&2
    echo "Recreate the chosen container from reviewed Compose with NO S3 host port" >&2
    echo "before using adopt; never start both servers on their shared /data." >&2
    exit 2
  }
  mode="$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$name")"
  [[ "$mode" != host && "$mode" != none ]] || {
    echo "ERROR: MinIO uses network_mode=$mode; cannot join shared bridge" >&2
    exit 2
  }
  # Require a verified /data mount and explicit operator confirmation of
  # the EXACT host source. A random script/config mount is not S3 persistence.
  # Never trust a missing external mount: Docker bind mounts can fall back
  # to a newly created empty directory on the root filesystem.
  local mount_type expected mount_target
  mount="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$name")"
  mount_type="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}{{end}}{{end}}' "$name")"
  expected="${SKYHUB_MINIO_EXPECTED_DATA_SOURCE:-}"
  [[ -n "$mount" && -n "$expected" && "$mount" == "$expected" ]] || {
    echo "ERROR: /data mount missing or does not match explicitly expected source." >&2
    echo "Set SKYHUB_MINIO_EXPECTED_DATA_SOURCE to the audited Docker mount Source." >&2
    exit 2
  }
  [[ "$mount_type" == bind || "$mount_type" == volume ]] || {
    echo "ERROR: /data must be persistent bind/volume storage" >&2
    exit 2
  }
  if [[ "$mount_type" == bind ]]; then
    [[ -d "$mount" && ! -L "$mount" ]] || {
      echo "ERROR: expected bind directory is missing or a symlink." >&2
      exit 2
    }
    command -v findmnt >/dev/null 2>&1 || {
      echo "ERROR: findmnt required to verify external storage" >&2
      exit 2
    }
    mount_target="$(findmnt --target "$mount" --noheadings --output TARGET)" || {
      echo "ERROR: cannot resolve MinIO backing filesystem" >&2
      exit 2
    }
    [[ -n "$mount_target" && "$mount_target" != "/" ]] || {
      echo "ERROR: MinIO /data resolves onto root filesystem; verify backup disk mount." >&2
      exit 2
    }
  fi
  local -a managed=()
  mapfile -t managed < <(docker ps -a \
    --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=minio" --format '{{.ID}}')
  if (( ${#managed[@]} > 0 )); then
    echo "ERROR: SkyHub-owned MinIO already exists; do not adopt a second server" >&2
    exit 2
  fi
  local chosen
  chosen="$(docker inspect --format '{{.Id}}' "$name")"
  # Only ONE MinIO storage SERVER may RUN globally. A historical,
  # stopped AeroNexus stack and its exited minio-init sidecar are retained
  # without preventing adoption of the single explicitly selected server.
  local -a other=()
  mapfile -t other < <(docker ps --no-trunc --format '{{.ID}} {{.Names}} {{.Image}}' |
    awk 'tolower($0) ~ /minio|aistor/ && tolower($2) !~ /minio-init/ { print $1 }')
  if (( ${#other[@]} != 1 )) || [[ "${other[0]}" != "$chosen" ]]; then
    echo "ERROR: expected exactly one running MinIO server (the chosen one)" >&2
    echo "Stopped historical containers remain untouched; audit storage mounts first." >&2
    exit 2
  fi
  assert_alias_available "$chosen"
  if is_connected "$name"; then
    local -a owners=()
    mapfile -t owners < <(alias_owners)
    [[ ${#owners[@]} == 1 && "${owners[0]}" == "$chosen" ]] || {
      echo "ERROR: existing network membership lacks the skyhub-minio alias" >&2
      echo "Do not disconnect a production MinIO container automatically." >&2
      exit 2
    }
    echo "OK: existing MinIO already attached with DNS alias"
  else
    ensure_network
    docker network connect --alias skyhub-minio "$NETWORK" "$name"
    echo "OK: reused existing MinIO without recreation"
  fi
  backend="$(single_running_service backend)"
  if [[ -n "$backend" ]]; then
    connect_existing "$backend"
  else
    echo "INFO: SkyHub backend not running; attach it later."
  fi
  echo "Existing MinIO now reachable from joined containers at http://skyhub-minio:9000"
  echo "IMPORTANT: do not launch the SkyHub-owned 'media' MinIO profile in this mode."
}

attach() {
  (( $# > 0 )) || { echo "ERROR: supply at least one container name" >&2; exit 2; }
  network_exists || { echo "ERROR: $NETWORK missing; run plan then apply" >&2; exit 2; }
  check_network
  local name running
  for name in "$@"; do
    [[ "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || {
      echo "ERROR: invalid container name" >&2; exit 2;
    }
    case "${name,,}" in
      *minio*|*aistor*|*postgres*|*redis*|*emqx*|*mosquitto*|*caddy*)
        echo "ERROR: infrastructure container '$name' is not an S3 client" >&2
        exit 2 ;;
    esac
    running="$(docker inspect --format '{{.State.Running}}' "$name" 2>/dev/null)" || {
      echo "ERROR: container '$name' not found" >&2; exit 2;
    }
    [[ "$running" == true ]] || {
      echo "ERROR: '$name' is not running" >&2; exit 2;
    }
  done
  # Complete validation of every target before the first network mutation.
  for name in "$@"; do
    connect_existing "$name"
  done
}

verify() {
  network_exists || { echo "ERROR: shared network missing" >&2; exit 1; }
  check_network
  local minio backend
  local -a owners=()
  mapfile -t owners < <(alias_owners)
  [[ ${#owners[@]} == 1 ]] || {
    echo "ERROR: expected exactly one running skyhub-minio DNS alias" >&2
    exit 1
  }
  minio="${owners[0]}"
  is_connected "$minio" || { echo "ERROR: storage container not on shared network" >&2; exit 1; }
  backend="$(single_running_service backend)"
  [[ -n "$backend" ]] || { echo "ERROR: no running SkyHub backend available for S3 readiness probe" >&2; exit 1; }
  is_connected "$backend" || { echo "ERROR: backend not on shared network" >&2; exit 1; }
  docker exec "$backend" node -e '
    fetch("http://skyhub-minio:9000/minio/health/ready",
      {signal: AbortSignal.timeout(5000)})
    .then(r => { console.log("MinIO readiness HTTP: " + r.status);
      process.exit(r.ok ? 0 : 1); })
    .catch(() => { console.error("MinIO readiness unreachable"); process.exit(1); });
  '
}

mode="${1:-plan}"
shift "$(( $# > 0 ? 1 : 0 ))"
case "$mode" in
  -h|--help|help) usage ;;
  plan) (( $# == 0 )) || { usage; exit 2; }; require_docker; plan ;;
  apply) require_docker; apply "$@" ;;
  adopt) require_docker; adopt "$@" ;;
  attach) require_docker; attach "$@" ;;
  verify) (( $# == 0 )) || { usage; exit 2; }; require_docker; verify ;;
  *) usage >&2; exit 2 ;;
esac
