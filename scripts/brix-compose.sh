#!/usr/bin/env bash
# Compose wrapper for brix-node (x86-64): same guard as scripts/pi-compose.sh, but with
# docker-compose.brix.yml instead of docker-compose.arm64.yml and the thermal-sdk profile.
set -Eeuo pipefail
cd "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
command -v docker >/dev/null || { echo "docker fehlt" >&2; exit 2; }
[[ -f .env ]] || { echo "ERROR: .env fehlt im Projektordner" >&2; exit 2; }
[[ "$(uname -m)" == x86_64 ]] || { echo "ERROR: nur fuer brix-node (x86_64); auf dem Pi scripts/pi-compose.sh" >&2; exit 2; }
files=(-f docker-compose.yml -f docker-compose.brix.yml)
[[ -f docker-compose.override.yml ]] && files+=(-f docker-compose.override.yml)
if grep -qx 'SKYHUB_LIVE_ENABLED=true' .env && [[ -f docker-compose.live.yml ]]; then files+=(-f docker-compose.live.yml); fi
# ADR-001 operator login + central route library: only with the explicit switch in .env.
if grep -qx 'SKYHUB_WPML_CENTRAL=1' .env && [[ -f docker-compose.wpml-central.brix.yml ]]; then files+=(-f docker-compose.wpml-central.brix.yml); fi
compose=(docker compose -p skyhub-next --env-file .env "${files[@]}" --profile thermal-sdk)
grep -q "^SKYHUB_TERRAIN_URL=." .env && compose+=(--profile terrain)
grep -q "^SKYHUB_PPK_URL=." .env && compose+=(--profile ppk)

[[ $# -ge 1 ]] || { echo "Verwendung: bash scripts/brix-compose.sh <docker compose Befehl> [Argumente]" >&2; exit 2; }
cmd="$1"; shift
all=0; args=()
for a in "$@"; do [[ "$a" == --all-services ]] && all=1 || args+=("$a"); done
case "$cmd" in
  up|down|restart|rm|stop|start|recreate)
    named=0; for a in "${args[@]:-}"; do [[ -n "$a" && "$a" != -* ]] && named=1; done
    if [[ $named == 0 && $all == 0 && "$cmd" != down ]] || [[ "$cmd" == down && $all == 0 ]]; then
      echo "ABGELEHNT: '$cmd' ohne Dienstnamen wuerde den ganzen Stack betreffen." >&2
      echo "Dienste nennen oder --all-services anhaengen." >&2
      exit 2
    fi ;;
esac
{ printf "+"; printf " %q" "${compose[@]}" "$cmd" ${args[@]+"${args[@]}"}; printf "\n"; } >&2   # one line, also for multi-line SQL arguments
exec "${compose[@]}" "$cmd" ${args[@]+"${args[@]}"}
