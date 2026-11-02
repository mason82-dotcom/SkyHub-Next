#!/usr/bin/env bash
# Run one DJI Thermal SDK (dji_irp, x86-64 only) command in an isolated, emulated container on the Pi.
#
#   bash scripts/dji-tsdk-run.sh [--timeout SEC] [--image IMG] [--platform P] \
#        --sdk DIR --input FILE [--output DIR] -- dji_irp ARGS...
#
# Why: a `timeout` running INSIDE a qemu-emulated amd64 container is not reliable – on 02.11.2026 two
# containers stayed up for hours with `timeout 60s` hanging under qemu after dji_irp had already exited.
# This wrapper enforces the deadline from the HOST (native `timeout` around `docker wait`), kills the
# container on expiry and always removes it (EXIT/INT/TERM trap). `--init` runs the native docker-init as
# PID 1 so signals reach the emulated process.
# Isolation as in the manual tests: no network, read-only root, no capabilities, no new privileges,
# no core dumps, own UID, 1 CPU, 1 GiB RAM, 64 PIDs, SDK and input mounted read-only.
# Exit code: that of the SDK command, 124 on timeout (like coreutils timeout), 2 on usage errors.
set -Eeuo pipefail

timeout_s=60
image=skyhub-dji-tsdk-runner:bookworm
platform=linux/amd64
sdk="" input="" output=""
usage() { sed -n '2,6p' "$0" >&2; exit 2; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout) timeout_s="${2:-}"; shift 2 ;;
    --image) image="${2:-}"; shift 2 ;;
    --platform) platform="${2:-}"; shift 2 ;;
    --sdk) sdk="${2:-}"; shift 2 ;;
    --input) input="${2:-}"; shift 2 ;;
    --output) output="${2:-}"; shift 2 ;;
    --) shift; break ;;
    *) usage ;;
  esac
done
[[ $# -gt 0 ]] || usage
[[ "$timeout_s" =~ ^[0-9]+$ && "$timeout_s" -ge 1 && "$timeout_s" -le 3600 ]] ||
  { echo "FEHLER: --timeout muss 1–3600 Sekunden sein." >&2; exit 2; }
[[ -d "$sdk" ]] || { echo "FEHLER: SDK-Verzeichnis fehlt: $sdk" >&2; exit 2; }
[[ -f "$input" ]] || { echo "FEHLER: Eingabedatei fehlt: $input" >&2; exit 2; }
[[ -z "$output" || -d "$output" ]] || { echo "FEHLER: Ausgabeverzeichnis fehlt: $output" >&2; exit 2; }

name="skyhub-tsdk-$$-$(od -An -N4 -tx4 /dev/urandom | tr -d ' ')"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

mounts=(--mount "type=bind,src=$(realpath "$sdk"),dst=/sdk,readonly"
        --mount "type=bind,src=$(realpath "$input"),dst=/input.JPG,readonly")
[[ -n "$output" ]] && mounts+=(--mount "type=bind,src=$(realpath "$output"),dst=/output")

docker run -d --name "$name" --init --platform "$platform" \
  --network none --read-only --cap-drop ALL --security-opt no-new-privileges=true \
  --ulimit core=0:0 --user "$(id -u):$(id -g)" \
  --cpus 1 --memory 1g --pids-limit 64 \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m,mode=1777 \
  "${mounts[@]}" --env LD_LIBRARY_PATH=/sdk/bin:/sdk --workdir /sdk/bin \
  --label skyhub.purpose=dji-tsdk --label "skyhub.deadline-seconds=$timeout_s" \
  "$image" "$@" >/dev/null

# Host-side deadline: native timeout, independent of the emulated process inside the container.
if status=$(timeout "$timeout_s" docker wait "$name"); then
  docker logs "$name" 2>&1 | tail -n 200 || true
  exit "$status"
fi
echo "ZEITÜBERSCHREITUNG: $timeout_s s überschritten – Container wird beendet." >&2
docker kill "$name" >/dev/null 2>&1 || true
docker logs "$name" 2>&1 | tail -n 50 >&2 || true
exit 124
