#!/usr/bin/env bash
# Den geteilten MinIO (skyhub-shared-minio) aus docker-compose.minio-shared.yml NEU ANLEGEN, z. B. damit ein neues Label
# (Watchtower-Ausnahme, 27.10.2026) greift. Daten, Image, Netz und Zugangsdaten bleiben; nur der Container wird ersetzt.
#   bash scripts/pi-minio-recreate.sh plan    lesend (Standard): Voraussetzungen, was sich aendert, Ablauf
#   bash scripts/pi-minio-recreate.sh run     stoppt ueber die Unit, legt neu an (ohne Start), startet ueber die Unit, prueft
#
# Warum nicht pi-minio-migrate-from-aeronexus.sh start: das legt nur an, wenn es noch keinen Container gibt.
# Ablauf von run (ohne sudo aufrufen; sudo wird nur fuer systemctl abgefragt):
#   1. dieselben Pruefungen wie plan; kein Backup/Restore darf laufen
#   2. sudo systemctl stop skyhub-shared-minio.service      (docker stop --time 60)
#   3. docker compose -f docker-compose.minio-shared.yml up --no-start --no-build --no-deps --force-recreate minio
#   4. sudo systemctl start skyhub-shared-minio.service     (Mount-Pruefung, dann docker start)
#   5. Nachpruefung: laeuft, Image, restart "no", Datenpfad, Netz-Alias, Label; danach pi-minio-network.sh verify
# Die Medien-API ist waehrend der Schritte 2 bis 4 (einige Sekunden) nicht erreichbar, Telemetrie laeuft weiter.
# Scheitert Schritt 3, gibt es eventuell keinen Container mehr: run einfach erneut aufrufen (Daten liegen im Bind-Mount).
set -Eeuo pipefail
mode="${1:-plan}"
[[ $# -le 1 && "$mode" =~ ^(plan|run)$ ]] || { echo "Verwendung: bash scripts/pi-minio-recreate.sh plan|run" >&2; exit 2; }
[[ $EUID != 0 ]] || { echo "ERROR: nicht mit sudo aufrufen (die Zugangsdatei gehoert dir; sudo wird nur fuer systemctl abgefragt)" >&2; exit 2; }

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.minio-shared.yml"
NAME="skyhub-shared-minio"
UNIT="skyhub-shared-minio.service"
IMAGE="skyhub/minio:RELEASE.2025-10-15T17-29-55Z-an1"
EXPECTED_IMAGE_ID="sha256:117cf7edd050e6acd4a2d06be79b15eaecd5af76ad73e8927a4bf67528f19d10"
DATA="/mnt/hc4backup/skyhub-next/minio"
NETWORK="skyhub-storage-net"
LABEL="com.centurylinklabs.watchtower.enable"
CREDENTIALS="${SKYHUB_SHARED_MINIO_CREDENTIALS_FILE:-$HOME/.config/skyhub/minio-shared.env}"
export SKYHUB_SHARED_MINIO_CREDENTIALS_FILE="$CREDENTIALS"
compose=(docker compose -f "$COMPOSE_FILE")

bad=0
ok()   { printf '  ok   %s\n' "$*"; }
fail() { printf '  FEHL %s\n' "$*"; bad=1; }
note() { printf '  Hinweis %s\n' "$*"; }

field() { docker inspect -f "$1" "$NAME" 2>/dev/null || true; }

checks() {
  echo "=== Voraussetzungen (lesend) ==="
  [[ -f "$COMPOSE_FILE" ]] && ok "Compose-Datei $COMPOSE_FILE" || fail "Compose-Datei fehlt"
  if [[ -f "$CREDENTIALS" && ! -L "$CREDENTIALS" && "$(stat -c %a "$CREDENTIALS")" == 600 && "$(stat -c %u "$CREDENTIALS")" == "$(id -u)" ]]; then
    ok "Zugangsdatei privat (0600, dir), Werte nicht gelesen"
  else fail "Zugangsdatei $CREDENTIALS fehlt oder ist nicht 0600/dir"; fi
  if bash "$ROOT/scripts/pi-minio-shared-mount-check.sh" >/dev/null 2>&1; then ok "Datenpfad $DATA gemountet und plausibel (pi-minio-shared-mount-check.sh)"
  else fail "Mount-Pruefung scheitert: bash scripts/pi-minio-shared-mount-check.sh"; fi
  [[ "$(docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null)" == "$EXPECTED_IMAGE_ID" ]] && ok "Image $IMAGE vorhanden (erwartete ID)" \
    || fail "Image $IMAGE fehlt oder hat eine andere ID"
  [[ "$(docker network inspect -f '{{.Driver}}' "$NETWORK" 2>/dev/null)" == bridge ]] && ok "Netz $NETWORK vorhanden" || fail "Netz $NETWORK fehlt"
  if "${compose[@]}" config --quiet 2>/dev/null; then ok "docker compose config"; else fail "docker compose config scheitert"; fi
  if systemctl cat "$UNIT" >/dev/null 2>&1; then ok "Unit $UNIT installiert ($(systemctl is-active "$UNIT" 2>/dev/null || true))"
  else fail "Unit $UNIT fehlt (bash scripts/pi-minio-autostart.sh plan)"; fi
  if pgrep -af 'pi-minio-acceptance/(backup|restore)\.sh|launch_backup\.py|recover_backup\.py|restore_probe\.py' >/dev/null; then
    fail "ein MinIO-Backup oder -Restore laeuft gerade: erst abwarten"
  else ok "kein Backup oder Restore aktiv"; fi
  echo; echo "=== Container heute ==="
  if [[ -n "$(field '{{.Id}}')" ]]; then
    echo "  Zustand $(field '{{.State.Status}}'), Image-ID $(field '{{.Image}}' | cut -c1-19), restart $(field '{{.HostConfig.RestartPolicy.Name}}')"
    echo "  Daten $(field '{{range .Mounts}}{{.Source}}{{end}}'), Netze $(field '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}')"
    local now want
    now="$(field "{{index .Config.Labels \"$LABEL\"}}")"; [[ -n "$now" ]] || now="(nicht gesetzt)"
    want="$("${compose[@]}" config --format json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['services']['minio'].get('labels',{}).get('$LABEL','(nicht gesetzt)'))" 2>/dev/null || echo '?')"
    echo "  Label $LABEL: heute $now, nach dem Neuanlegen $want"
    [[ "$now" == "$want" ]] && note "Label stimmt schon; Neuanlegen aendert daran nichts" || true
  else
    note "kein Container $NAME: run legt ihn an"
  fi
}

verify() {
  echo; echo "=== Nachpruefung ==="
  [[ "$(field '{{.State.Status}}')" == running ]] && ok "laeuft" || fail "laeuft nicht (journalctl -u $UNIT -n 20)"
  [[ "$(field '{{.Image}}')" == "$EXPECTED_IMAGE_ID" ]] && ok "Image-ID wie erwartet" || fail "andere Image-ID"
  [[ "$(field '{{.HostConfig.RestartPolicy.Name}}')" == no ]] && ok "restart \"no\" (Start nur ueber die Unit)" || fail "Restart-Policy nicht \"no\""
  [[ "$(field '{{range .Mounts}}{{.Source}}{{end}}')" == "$DATA" ]] && ok "Daten aus $DATA" || fail "anderer Datenpfad"
  [[ -z "$(field '{{range .HostConfig.PortBindings}}x{{end}}')" ]] && ok "keine Host-Ports" || fail "Host-Ports veroeffentlicht"
  field "{{range \$k, \$v := .NetworkSettings.Networks}}{{if eq \$k \"$NETWORK\"}}{{range \$v.Aliases}}{{.}} {{end}}{{end}}{{end}}" | grep -qw skyhub-minio \
    && ok "Alias skyhub-minio im Netz $NETWORK" || fail "Alias skyhub-minio fehlt"
  [[ "$(field "{{index .Config.Labels \"$LABEL\"}}")" == false ]] && ok "Label $LABEL=false (Watchtower laesst ihn aus)" || note "Label $LABEL nicht false"
  [[ "$(systemctl is-active "$UNIT" 2>/dev/null || true)" =~ ^(active|activating)$ ]] && ok "Unit $UNIT aktiv" || fail "Unit $UNIT nicht aktiv"
  if bash "$ROOT/scripts/pi-minio-network.sh" verify >/dev/null 2>&1; then ok "pi-minio-network.sh verify (Backend erreicht skyhub-minio)"
  else fail "pi-minio-network.sh verify scheitert: bash scripts/pi-minio-network.sh verify"; fi
}

case "$mode" in
  plan)
    checks
    echo; echo "Ablauf von run: Unit stoppen -> compose up --no-start --force-recreate -> Unit starten (Mount-Pruefung) -> Nachpruefung."
    echo "Medien-API einige Sekunden nicht erreichbar, Telemetrie unberuehrt. Daten, Image, Netz und Zugangsdaten bleiben."
    ((bad)) && { echo; echo "Nicht bereit: erst die FEHL-Punkte beheben."; exit 1; }
    echo; echo "Ausfuehren: bash scripts/pi-minio-recreate.sh run"
    ;;
  run)
    checks
    ((bad)) && { echo; echo "Abbruch vor jeder Aenderung: FEHL-Punkte oben." >&2; exit 1; }
    echo; echo "=== Neu anlegen ==="
    echo "1/3 sudo systemctl stop $UNIT"; sudo systemctl stop "$UNIT"
    echo "2/3 docker compose up --no-start --force-recreate minio"
    "${compose[@]}" up --no-start --no-build --no-deps --force-recreate minio
    echo "3/3 sudo systemctl start $UNIT"; sudo systemctl start "$UNIT"
    sleep "${SKYHUB_MINIO_RECREATE_WAIT:-3}"
    bad=0; verify
    ((bad)) && { echo; echo "Nachpruefung mit Fehlern (siehe oben). Erneut versuchen: bash scripts/pi-minio-recreate.sh run" >&2; exit 1; }
    echo; echo "Fertig. Optional, authentifiziert: bash scripts/pi-minio-s3-check.sh"
    ;;
esac
