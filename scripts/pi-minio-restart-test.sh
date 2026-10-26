#!/usr/bin/env bash
# Stop/Start-Persistenztest fuer den gemeinsamen MinIO (skyhub-shared-minio) auf dem Pi.
#   bash scripts/pi-minio-restart-test.sh            # plan: nur lesen, nichts wird angehalten
#   bash scripts/pi-minio-restart-test.sh --execute-restart-test
# Wirkung: haelt DENSELBEN Container sauber an und startet ihn wieder (kein Recreate, kein Pull, kein Compose).
# Davor und danach muss scripts/pi-minio-backend-access.sh check bestehen (alle fuenf Buckets per Reader-Konto).
# Waehrend des Tests (etwa eine Minute) liefert /api/media/* Fehler; Backend und andere Dienste laufen weiter.
# Ein Pi-Reboot ist NICHT Teil dieses Skripts: der Container hat restart "no" und bleibt danach bewusst aus.
# Gibt keine Zugangsdaten aus. Faellt der Start nach dem Stop aus, versucht ein Handler genau einmal denselben
# Container wieder zu starten.
set -Eeuo pipefail
umask 077
NAME="${SKYHUB_MINIO_CONTAINER:-skyhub-shared-minio}"
NET="skyhub-storage-net"
ALIAS="skyhub-minio"
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:-plan}"
[[ $# -le 1 && ( "$mode" == plan || "$mode" == --execute-restart-test ) ]] || {
  echo "Verwendung: bash scripts/pi-minio-restart-test.sh [--execute-restart-test]" >&2; exit 2; }
for tool in docker curl; do command -v "$tool" >/dev/null || { echo "Fehlt: $tool" >&2; exit 2; }; done

bad=0
ok()   { printf '  ok   %s\n' "$*"; }
fail() { printf '  FEHL %s\n' "$*"; bad=1; }
field() { docker inspect -f "$1" "$2" 2>/dev/null; }
access_check() { (cd "$root" && bash scripts/pi-minio-backend-access.sh check) >"$work/access.out" 2>&1; }
ready() {
  local ip
  ip="$(field "{{(index .NetworkSettings.Networks \"$NET\").IPAddress}}" "$NAME")" || return 1
  [[ -n "$ip" ]] && curl -fsS --noproxy '*' -m 2 -o /dev/null "http://$ip:9000/minio/health/ready"
}

work="$(mktemp -d)"
stopped_by_us=0
cleanup() {
  local result=$?
  trap - EXIT
  if (( stopped_by_us )) && [[ "$(field '{{.State.Status}}' "$NAME" || true)" != running ]]; then
    echo "WARNUNG: $NAME steht nach dem Test noch; genau ein Startversuch fuer denselben Container." >&2
    docker start "$NAME" >/dev/null 2>&1 || echo "FEHLER: manueller Start noetig: docker start $NAME" >&2
  fi
  rm -rf -- "$work"
  exit "$result"
}
trap cleanup EXIT

echo "=== MinIO Stop/Start-Persistenztest ($NAME) ==="
echo "Voraussetzungen (nur lesend):"
docker inspect "$NAME" >/dev/null 2>&1 || { fail "Container $NAME fehlt"; exit 2; }
[[ "$(field '{{.State.Status}}' "$NAME")" == running ]] && ok "Container laeuft" || fail "Container laeuft nicht"
policy="$(field '{{.HostConfig.RestartPolicy.Name}}' "$NAME")"
[[ "$policy" == no ]] && ok "Restart-Policy 'no' (Autostart nach Reboot ist bewusst aus)" || fail "Restart-Policy ist '$policy', erwartet 'no'"
field "{{range \$k,\$v := .NetworkSettings.Networks}}{{\$k}} {{end}}" "$NAME" | grep -qw "$NET" \
  && ok "am Netz $NET" || fail "nicht am Netz $NET"
field "{{(index .NetworkSettings.Networks \"$NET\").Aliases}}" "$NAME" | grep -qw "$ALIAS" \
  && ok "Netzwerk-Alias $ALIAS" || fail "Alias $ALIAS fehlt"
(cd "$root" && bash scripts/pi-minio-shared-mount-check.sh) >"$work/mount.out" 2>&1 \
  && ok "Datenverzeichnis liegt auf dem erwarteten Mount" || { fail "Mount-Pruefung fehlgeschlagen"; tail -5 "$work/mount.out"; }
ready && ok "MinIO meldet ready" || fail "MinIO nicht ready"
access_check && ok "Vorher: Backend-Zugang, alle fuenf Buckets lesbar" || { fail "Vorher: scripts/pi-minio-backend-access.sh check schlaegt fehl"; tail -8 "$work/access.out"; }

backend="$(docker ps --filter label=com.docker.compose.project=skyhub-next --filter label=com.docker.compose.service=backend --format '{{.ID}}')"
[[ -n "$backend" && "$(wc -w <<<"$backend")" == 1 ]] && ok "genau ein Backend-Container (wird nicht angefasst)" || fail "Backend-Container nicht eindeutig"

if [[ "$mode" == plan ]]; then
  echo
  echo "Plan (nichts geaendert): stop --time 60, Exit 0 pruefen, start desselben Containers, ready (max 60 s),"
  echo "gleiche ID/Image/Netz/Alias, danach erneut backend-access check. Mit --execute-restart-test ausfuehren."
  exit "$bad"
fi

(( bad == 0 )) || { echo "Abbruch: Voraussetzungen zuerst schliessen. Nichts wurde angehalten." >&2; exit 2; }
echo
echo "ACHTUNG: $NAME wird jetzt angehalten und wieder gestartet. /api/media/* ist etwa eine Minute nicht erreichbar."
read -r -p "Zum Fortfahren RESTART tippen: " answer </dev/tty
[[ "$answer" == RESTART ]] || { echo "Abgebrochen. Nichts geaendert."; exit 2; }

id0="$(field '{{.Id}}' "$NAME")"; img0="$(field '{{.Image}}' "$NAME")"
started0="$(field '{{.State.StartedAt}}' "$NAME")"; backend_started0="$(field '{{.State.StartedAt}}' "$backend")"
echo "Stop..."
stopped_by_us=1
docker stop --time 60 "$NAME" >/dev/null
code="$(field '{{.State.ExitCode}}' "$NAME")"
[[ "$code" == 0 ]] && ok "sauberer Stop, Exit-Code 0" || fail "Exit-Code $code beim Stop (kein sauberes Herunterfahren)"
echo "Start (derselbe Container)..."
docker start "$NAME" >/dev/null
for _ in $(seq 1 60); do ready && break; sleep 1; done
ready && ok "nach dem Start ready" || fail "nach 60 s nicht ready"
stopped_by_us=0
[[ "$(field '{{.Id}}' "$NAME")" == "$id0" ]] && ok "gleiche Container-ID (kein Recreate)" || fail "Container-ID hat sich geaendert"
[[ "$(field '{{.Image}}' "$NAME")" == "$img0" ]] && ok "gleiches Image" || fail "Image hat sich geaendert"
[[ "$(field '{{.State.StartedAt}}' "$NAME")" != "$started0" ]] && ok "StartedAt hat sich geaendert (Neustart belegt)" || fail "StartedAt unveraendert"
field "{{(index .NetworkSettings.Networks \"$NET\").Aliases}}" "$NAME" | grep -qw "$ALIAS" \
  && ok "Netz $NET und Alias $ALIAS nach Neustart erhalten" || fail "Netz oder Alias nach Neustart verloren"
[[ "$(field '{{.State.StartedAt}}' "$backend")" == "$backend_started0" ]] \
  && ok "Backend wurde nicht neu gestartet und findet MinIO ohne Eingriff" || fail "Backend wurde waehrenddessen neu gestartet"
access_check && ok "Nachher: Backend-Zugang, alle fuenf Buckets lesbar" || { fail "Nachher: backend-access check schlaegt fehl"; tail -8 "$work/access.out"; }

echo
if (( bad == 0 )); then
  echo "ERGEBNIS: Stop/Start-Persistenz bestanden. Reboot bleibt separat (Container startet danach bewusst nicht selbst)."
else
  echo "ERGEBNIS: NICHT bestanden. Details oben; der Container wurde nicht neu erstellt."
fi
exit "$bad"
