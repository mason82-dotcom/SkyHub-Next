#!/usr/bin/env bash
# Explicit opt-in command wrapper; never starts/changes the Raspberry Pi production stack.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$HERE/../.." && pwd)"
ENV_FILE="$HERE/lab.env"
PROJECT="skyhub-hivemind-lab"

usage() {
  echo "Usage: bash simulators/hivemind/lab.sh init-env|prepare|config|up|smoke|dock-up|dock-smoke|ps|logs|down"
  echo "Only 'up' starts containers. 'down' preserves all named volumes."
}
if [[ $# -ne 1 ]]; then usage; exit 2; fi

case "$1" in
  init-env)
    command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 2; }
    if [[ -e "$ENV_FILE" ]]; then
      echo "Local lab.env already exists; refusing overwrite" >&2
      exit 2
    fi
    umask 077
    ( set -C
      cat > "$ENV_FILE" <<EOF
# Disposable lab only; do NOT copy real DJI or broker credentials.
SKYHUB_VIEW_TOKEN=$(openssl rand -hex 32)
SKYHUB_DB_PASSWORD=$(openssl rand -hex 32)
SKYHUB_MINIO_USER=lab_minio
SKYHUB_MINIO_PASSWORD=$(openssl rand -hex 32)
MQTT_BROKER_URL=mqtt://hivemind-broker:1884
MQTT_USER=
MQTT_PASSWORD=
SKYHUB_HTTP_PORT=14001
SKYHUB_BIND_ADDRESS=127.0.0.1
SKYHUB_PILOT_ENABLED=false
SKYHUB_TOPOLOGY_ACK_ENABLED=false
SKYHUB_TRACK_RECORDING_ENABLED=false
SKYHUB_LAN_VIEW_CIDR=
EOF
    )
    echo "Created private lab.env (credentials not shown)."
    exit 0
    ;;
  prepare)
    exec bash "$HERE/prepare.sh"
    ;;
  config|up|smoke|dock-up|dock-smoke|ps|logs|down)
    ;;
  *)
    usage
    exit 2
    ;;
esac

command -v docker >/dev/null || { echo "docker is required" >&2; exit 2; }
if [[ ! -f "$ENV_FILE" || -L "$ENV_FILE" ]]; then
  echo "No lab.env found. Run: bash simulators/hivemind/lab.sh init-env" >&2
  exit 2
fi
# Only a private, generated lab.env with exactly these keys is accepted.
# Never source it or echo values: a copied production env must fail closed.
[[ $(stat -c %u "$ENV_FILE") == "$(id -u)" ]] || { echo "Lab env owner mismatch" >&2; exit 2; }
mode=$(stat -c %a "$ENV_FILE")
(( (8#$mode & 077) == 0 )) || { echo "Lab env permissions too broad" >&2; exit 2; }
declare -A seen=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  [[ "$line" == *=* ]] || { echo "Invalid lab env entry" >&2; exit 2; }
  key=${line%%=*}; value=${line#*=}
  case "$key" in
    SKYHUB_VIEW_TOKEN|SKYHUB_DB_PASSWORD|SKYHUB_MINIO_PASSWORD)
      [[ "$value" =~ ^[0-9a-f]{64}$ ]] || { echo "Invalid lab secret format" >&2; exit 2; } ;;
    SKYHUB_MINIO_USER) [[ "$value" == lab_minio ]] || exit 2 ;;
    MQTT_BROKER_URL) [[ "$value" == mqtt://hivemind-broker:1884 ]] || exit 2 ;;
    MQTT_USER|MQTT_PASSWORD|SKYHUB_LAN_VIEW_CIDR) [[ -z "$value" ]] || exit 2 ;;
    SKYHUB_HTTP_PORT) [[ "$value" == 14001 ]] || exit 2 ;;
    SKYHUB_BIND_ADDRESS) [[ "$value" == 127.0.0.1 ]] || exit 2 ;;
    SKYHUB_PILOT_ENABLED|SKYHUB_TOPOLOGY_ACK_ENABLED|SKYHUB_TRACK_RECORDING_ENABLED)
      [[ "$value" == false ]] || exit 2 ;;
    *) echo "Unexpected lab env key" >&2; exit 2 ;;
  esac
  [[ ! -v seen[$key] ]] || { echo "Duplicate lab env key" >&2; exit 2; }
  seen[$key]=1
done < "$ENV_FILE"
[[ ${#seen[@]} -eq 13 ]] || { echo "Incomplete lab env" >&2; exit 2; }

# Ignore ambient Compose/DJI/S3 credentials and force a local Docker socket.
# The only interpolation inputs are the validated lab.env entries.

cd "$ROOT"
compose=(env -i PATH="$PATH" HOME="$HOME" docker --host unix:///var/run/docker.sock \
  compose --project-name "$PROJECT" --env-file "$ENV_FILE" \
  -f docker-compose.yml -f simulators/hivemind/compose.lab.yml)
case "$1" in
  config)
    "${compose[@]}" config --quiet
    echo "Lab Compose syntax OK (no containers started)."
    ;;
  up)
    if [[ ! -s "$HERE/.upstream/target/dji-dock-simulator-1.4.10.jar" ]]; then
      echo "Prepare pinned upstream first: bash simulators/hivemind/lab.sh prepare" >&2
      exit 2
    fi
    "${compose[@]}" config --quiet
    "${compose[@]}" up -d --build
    echo "Lab: simulator http://127.0.0.1:19090 and SkyHub http://127.0.0.1:14001"
    ;;
  smoke)
    command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 2; }
    "${compose[@]}" config --quiet
    exec python3 "$HERE/smoke.py"
    ;;
  dock-up)
    if [[ ! -s "$HERE/.upstream/target/dji-dock-simulator-1.4.10.jar" ]]; then
      echo "Prepare pinned upstream first: bash simulators/hivemind/lab.sh prepare" >&2
      exit 2
    fi
    "${compose[@]}" --profile dock-rpc config --quiet
    "${compose[@]}" --profile dock-rpc up -d --build
    echo "Dock lab running: simulator localhost:19090, SkyHub localhost:14001; RPC mock is opt-in."
    ;;
  dock-smoke)
    command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 2; }
    "${compose[@]}" --profile dock-rpc config --quiet
    if ! "${compose[@]}" --profile dock-rpc ps --status running --services dock-mock |
        grep -Fxq dock-mock; then
      echo "Dock mock is not running; first run: bash simulators/hivemind/lab.sh dock-up" >&2
      exit 2
    fi
    exec python3 "$HERE/dock-smoke.py"
    ;;
  ps) "${compose[@]}" --profile dock-rpc ps --all ;;
  logs) "${compose[@]}" logs --tail=80 ;;
  down)
    "${compose[@]}" --profile dock-rpc down
    echo "Lab stopped; named volumes retained (no -v)."
    ;;
esac
