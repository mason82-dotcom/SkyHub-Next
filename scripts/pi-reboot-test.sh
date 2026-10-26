#!/usr/bin/env bash
# Reboot-Test fuer den Pi: Zustand VOR dem Reboot festhalten, NACH dem Reboot vergleichen.
#   bash scripts/pi-reboot-test.sh pre            # lesend: speichert den Zustand in ~/.local/state/skyhub/
#   (Pi selbst neu starten: sudo reboot -- das Skript tut das NICHT)
#   bash scripts/pi-reboot-test.sh post           # lesend: vergleicht mit dem Zustand vor dem Reboot
#   bash scripts/pi-reboot-test.sh start-minio    # fragt nach START, startet den MinIO NACH der Mount-Pruefung
# Erwartet nach dem Reboot: Container mit Restart-Policy always/unless-stopped laufen wieder; der gemeinsame MinIO
# (restart "no") bleibt bewusst aus und wird mit start-minio erst nach der Mount-Pruefung gestartet.
# Container mit on-failure (z. B. die Cloud-API-Demo) werden nur gemeldet, nicht erwartet.
# Gibt keine Zugangsdaten aus.
set -Eeuo pipefail
umask 077
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/skyhub"
snap="$state_dir/reboot-test-before.tsv"
MINIO="${SKYHUB_MINIO_CONTAINER:-skyhub-shared-minio}"
WAIT="${SKYHUB_REBOOT_WAIT_SECONDS:-240}"
mode="${1:-}"
[[ $# -eq 1 && "$mode" =~ ^(pre|post|start-minio)$ ]] || {
  echo "Verwendung: bash scripts/pi-reboot-test.sh pre|post|start-minio" >&2; exit 2; }
for tool in docker curl findmnt ss systemctl; do command -v "$tool" >/dev/null || { echo "Fehlt: $tool" >&2; exit 2; }; done

bad=0
ok()   { printf '  ok   %s\n' "$*"; }
fail() { printf '  FEHL %s\n' "$*"; bad=1; }
note() { printf '  Hinweis %s\n' "$*"; }
boot_id() { cat /proc/sys/kernel/random/boot_id; }
mounts_of_interest=(/mnt/data /mnt/hc4backup /mnt/benz)
listening_ports() { ss -ltnH | awk '{n=split($4,a,":"); p=a[n]+0; if (p>0 && p<=20000) print p}' | sort -un; }
containers() {
  docker ps -a --format '{{.Names}}' | sort | while read -r n; do
    printf '%s\t%s\t%s\n' "$n" "$(docker inspect -f '{{.State.Status}}' "$n")" "$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$n")"
  done
}
api_health() { curl -fs -m 3 -o /dev/null http://127.0.0.1:4001/api/health; }

if [[ "$mode" == pre ]]; then
  echo "=== Reboot-Test: Zustand vor dem Reboot festhalten (nur lesend) ==="
  mkdir -p "$state_dir"
  [[ "$(docker inspect -f '{{.State.Status}}' "$MINIO" 2>/dev/null || true)" == running ]] \
    && ok "$MINIO laeuft (wird nach dem Reboot bewusst NICHT automatisch erwartet)" || note "$MINIO laeuft schon vorher nicht"
  api_health && ok "Backend /api/health antwortet" || fail "Backend /api/health antwortet nicht"
  failed="$(systemctl --failed --no-legend | wc -l)"
  [[ "$failed" == 0 ]] && ok "keine fehlgeschlagenen systemd-Units" || note "$failed fehlgeschlagene systemd-Units schon vor dem Reboot"
  for m in "${mounts_of_interest[@]}"; do
    findmnt -nr --mountpoint "$m" >/dev/null && ok "gemountet: $m" || note "nicht gemountet: $m"
  done
  [[ $bad -eq 0 ]] || { echo "Abbruch: erst die FEHL-Punkte klaeren, kein Zustand gespeichert." >&2; exit 2; }
  {
    printf 'B\t%s\n' "$(boot_id)"
    printf 'T\t%s\n' "$(date -Is)"
    containers | sed 's/^/C\t/'
    for m in "${mounts_of_interest[@]}"; do findmnt -nr --mountpoint "$m" >/dev/null && printf 'M\t%s\n' "$m"; done
    listening_ports | sed 's/^/P\t/'
  } >"$snap"
  echo "  Zustand gespeichert: $snap ($(grep -c '^C' "$snap") Container, $(grep -c '^P' "$snap") Ports <= 20000)"
  echo
  echo "Naechste Schritte: laufende Flugzeuge/Einsaetze beenden, dann selbst 'sudo reboot'. Danach: bash scripts/pi-reboot-test.sh post"
  exit 0
fi

if [[ "$mode" == post ]]; then
  echo "=== Reboot-Test: Vergleich mit dem Zustand vor dem Reboot (nur lesend) ==="
  [[ -f "$snap" ]] || { echo "Kein gespeicherter Zustand: $snap (zuerst 'pre' vor dem Reboot)" >&2; exit 2; }
  before_boot="$(awk -F'\t' '$1=="B"{print $2}' "$snap")"
  [[ "$(boot_id)" != "$before_boot" ]] && ok "neuer Boot (boot_id geaendert), Betriebszeit: $(uptime -p)" \
    || { fail "kein Reboot seit 'pre' erkannt"; echo "Abbruch: erst neu starten." >&2; exit 2; }
  while IFS=$'\t' read -r _ m; do
    findmnt -nr --mountpoint "$m" >/dev/null && ok "gemountet: $m" || fail "NICHT gemountet: $m (MinIO nicht starten!)"
  done < <(awk -F'\t' '$1=="M"' "$snap")

  echo "Container (bis zu ${WAIT}s warten):"
  deadline=$((SECONDS + WAIT))
  while :; do
    missing=()
    while IFS=$'\t' read -r _ name state policy; do
      [[ "$state" == running && ( "$policy" == always || "$policy" == unless-stopped ) ]] || continue
      [[ "$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null || true)" == running ]] || missing+=("$name")
    done < <(awk -F'\t' '$1=="C"' "$snap")
    (( ${#missing[@]} == 0 || SECONDS >= deadline )) && break
    sleep 5
  done
  if (( ${#missing[@]} == 0 )); then ok "alle Container mit always/unless-stopped, die vorher liefen, laufen wieder"
  else fail "laufen nicht wieder: ${missing[*]}"; fi
  while IFS=$'\t' read -r _ name state policy; do
    [[ "$state" == running && ( "$policy" == no || "$policy" == on-failure ) ]] || continue
    now="$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null || echo fehlt)"
    if [[ "$name" == "$MINIO" ]]; then
      [[ "$now" == running ]] && note "$name laeuft schon (unerwartet bei Policy no)" || ok "$name steht wie erwartet (Policy no): mit start-minio starten"
    else
      [[ "$now" == running ]] && ok "$name laeuft ($policy)" || note "$name ($policy) lief vorher, jetzt: $now"
    fi
  done < <(awk -F'\t' '$1=="C"' "$snap")

  now_ports="$(listening_ports)"
  gone=()
  while IFS=$'\t' read -r _ p; do grep -qx "$p" <<<"$now_ports" || gone+=("$p"); done < <(awk -F'\t' '$1=="P"' "$snap")
  (( ${#gone[@]} == 0 )) && ok "alle vorher lauschenden Ports <= 20000 lauschen wieder" || fail "Ports lauschen nicht mehr: ${gone[*]}"
  api_health && ok "Backend /api/health antwortet" || fail "Backend /api/health antwortet nicht"
  failed="$(systemctl --failed --no-legend | wc -l)"
  [[ "$failed" == 0 ]] && ok "keine fehlgeschlagenen systemd-Units" || { fail "$failed fehlgeschlagene Units:"; systemctl --failed --no-legend | cut -c1-120; }
  systemctl is-active --quiet skyhub-mosquitto.service && ok "skyhub-mosquitto.service aktiv" || fail "skyhub-mosquitto.service nicht aktiv"
  backend="$(docker ps --filter label=com.docker.compose.project=skyhub-next --filter label=com.docker.compose.service=backend --format '{{.Names}}' | head -1)"
  if [[ -n "$backend" ]]; then
    trusted="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$backend" | sed -n 's/^SKYHUB_TRUSTED_PROXY_IPS=//p' | head -1)"
    if SKYHUB_TRUSTED_PROXY_IPS="$trusted" bash "$root/scripts/pi-proxy-peer-check.sh" --enforce >/dev/null 2>&1
    then ok "Proxy-Peer stimmt mit SKYHUB_TRUSTED_PROXY_IPS ueberein (Docker-Gateway nach dem Reboot unveraendert)"
    else fail "Proxy-Peer-Pruefung schlaegt fehl: bash scripts/pi-proxy-peer-check.sh ausfuehren"; fi
  else fail "kein Backend-Container"; fi
  echo
  (( bad == 0 )) && echo "ERGEBNIS: Reboot-Pruefung bestanden. Danach den MinIO gezielt starten: bash scripts/pi-reboot-test.sh start-minio" \
                 || echo "ERGEBNIS: NICHT bestanden. Details oben."
  exit "$bad"
fi

echo "=== Gemeinsamen MinIO nach dem Reboot starten ($MINIO) ==="
work="$(mktemp -d)"; trap 'rm -rf -- "$work"' EXIT
[[ "$(docker inspect -f '{{.State.Status}}' "$MINIO" 2>/dev/null || echo fehlt)" == exited ]] \
  && ok "$MINIO steht (exited), wie nach dem Reboot erwartet" || { fail "$MINIO ist nicht im Zustand exited"; exit 2; }
(cd "$root" && bash scripts/pi-minio-shared-mount-check.sh) >"$work/mount.out" 2>&1 \
  && ok "Datenverzeichnis liegt auf dem erwarteten Mount" || { fail "Mount-Pruefung fehlgeschlagen, MinIO wird NICHT gestartet"; tail -5 "$work/mount.out"; exit 2; }
read -r -p "Zum Starten START tippen: " answer </dev/tty
[[ "$answer" == START ]] || { echo "Abgebrochen. Nichts geaendert."; exit 2; }
docker start "$MINIO" >/dev/null
net=skyhub-storage-net
for _ in $(seq 1 60); do
  ip="$(docker inspect -f "{{(index .NetworkSettings.Networks \"$net\").IPAddress}}" "$MINIO" 2>/dev/null || true)"
  [[ -n "$ip" ]] && curl -fs --noproxy '*' -m 2 -o /dev/null "http://$ip:9000/minio/health/ready" && break; sleep 1
done
[[ -n "${ip:-}" ]] && curl -fs --noproxy '*' -m 2 -o /dev/null "http://$ip:9000/minio/health/ready" && ok "MinIO ready" || fail "MinIO nach 60 s nicht ready"
(cd "$root" && bash scripts/pi-minio-backend-access.sh check) >"$work/access.out" 2>&1 \
  && ok "Backend-Zugang, alle fuenf Buckets lesbar" || { fail "backend-access check schlaegt fehl"; tail -8 "$work/access.out"; }
echo
(( bad == 0 )) && echo "ERGEBNIS: MinIO nach dem Reboot gestartet und lesbar." || echo "ERGEBNIS: NICHT bestanden. Details oben."
exit "$bad"
