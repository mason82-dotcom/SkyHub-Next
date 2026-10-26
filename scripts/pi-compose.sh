#!/usr/bin/env bash
# docker compose fuer SkyHub Next auf dem Pi, IMMER mit den richtigen Dateien.
#   bash scripts/pi-compose.sh ps
#   bash scripts/pi-compose.sh config --quiet
#   bash scripts/pi-compose.sh up -d --no-build backend        (einzelne Dienste nennen!)
#
# Warum: Auf dem Pi laeuft Postgres mit dem arm64-Overlay (Image skyhub-next-postgis:pg15-arm64, Volume skyhub-next_pgdata_arm64).
# Ein einfaches `docker compose up -d` nimmt dagegen docker-compose.yml allein (x86-Image postgis/postgis:15-3.3, leeres Volume
# skyhub-next_pgdata): Postgres stuerzt dann in einer Dauerschleife ab und das Backend startet nicht (passiert am 26.10.2026).
# Diese Huelle gibt darum immer docker-compose.yml + docker-compose.arm64.yml (+ docker-compose.override.yml, falls vorhanden) mit.
# `up`, `down`, `restart`, `rm`, `stop` ohne Dienstnamen werden abgelehnt: ein ganzer Stack soll nur bewusst neu angelegt werden
# (--all-services ans Ende setzen, wenn genau das gewollt ist; sonst scripts/pi-update-backend.sh benutzen).
set -Eeuo pipefail
cd "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
command -v docker >/dev/null || { echo "docker fehlt" >&2; exit 2; }
[[ -f .env ]] || { echo "ERROR: .env fehlt im Projektordner" >&2; exit 2; }
[[ -f docker-compose.arm64.yml ]] || { echo "ERROR: docker-compose.arm64.yml fehlt" >&2; exit 2; }
files=(-f docker-compose.yml -f docker-compose.arm64.yml)
[[ -f docker-compose.override.yml ]] && files+=(-f docker-compose.override.yml)
compose=(docker compose -p skyhub-next --env-file .env "${files[@]}")

[[ $# -ge 1 ]] || { echo "Verwendung: bash scripts/pi-compose.sh <docker compose Befehl> [Argumente]" >&2; exit 2; }
cmd="$1"; shift
all=0; args=()
for a in "$@"; do [[ "$a" == --all-services ]] && all=1 || args+=("$a"); done
case "$cmd" in
  up|down|restart|rm|stop|start|recreate)
    # Ein Dienstname ist ein Argument ohne fuehrendes '-', das nicht Wert einer Option ist (Optionen mit Wert hier nicht verwendet).
    named=0; for a in "${args[@]:-}"; do [[ -n "$a" && "$a" != -* ]] && named=1; done
    if [[ $named == 0 && $all == 0 && "$cmd" != down ]] || [[ "$cmd" == down && $all == 0 ]]; then
      echo "ABGELEHNT: '$cmd' ohne Dienstnamen wuerde den ganzen Stack betreffen (postgres, redis, backend)." >&2
      echo "Dienste nennen, z. B.: bash scripts/pi-compose.sh $cmd ${args[*]:-} backend    oder --all-services anhaengen." >&2
      exit 2
    fi ;;
esac
echo "+ ${compose[*]} $cmd ${args[*]:-}" >&2
exec "${compose[@]}" "$cmd" ${args[@]+"${args[@]}"}   # leere Argumentliste nicht als "" weitergeben
