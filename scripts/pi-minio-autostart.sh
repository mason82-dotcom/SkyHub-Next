#!/usr/bin/env bash
# Mountabhaengiger Autostart fuer den gemeinsamen MinIO (skyhub-shared-minio) ueber eine systemd-Unit.
#   bash scripts/pi-minio-autostart.sh plan       # lesend: zeigt die Unit, prueft sie mit systemd-analyze (Standard)
#   sudo bash scripts/pi-minio-autostart.sh install   # schreibt die Unit, daemon-reload, enable (startet NICHT jetzt)
#   sudo bash scripts/pi-minio-autostart.sh remove    # disable, Unit loeschen, daemon-reload
#   bash scripts/pi-minio-autostart.sh check      # lesend: installiert/enabled/Zustand
# Warum eine Unit statt "restart: unless-stopped": Der Container hat bewusst restart "no". Docker wuerde ihn sonst auch
# starten, wenn /mnt/hc4backup beim Boot fehlt (nofail-Mount). Die Unit startet ihn nur, wenn der Mount da ist
# (RequiresMountsFor) UND scripts/pi-minio-shared-mount-check.sh besteht. Fehlt der Mount, bleibt MinIO aus und die
# Unit steht auf failed; die Medien-API meldet dann Fehler, alles andere laeuft.
# Die Unit startet/stoppt nur den vorhandenen Container (docker start/stop), sie erstellt keinen neuen. Backup und
# Restore-Skripte stoppen und starten den Container weiter selbst; der Unit-Zustand "active (exited)" bleibt davon unberuehrt.
set -Eeuo pipefail
umask 022
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:-plan}"
[[ $# -le 1 && "$mode" =~ ^(plan|install|remove|check)$ ]] || {
  echo "Verwendung: bash scripts/pi-minio-autostart.sh [plan|install|remove|check]" >&2; exit 2; }
NAME="${SKYHUB_MINIO_CONTAINER:-skyhub-shared-minio}"
UNIT="skyhub-shared-minio.service"
TARGET="/etc/systemd/system/$UNIT"
MOUNT="${SKYHUB_MINIO_MOUNT:-/mnt/hc4backup}"
[[ "$root" =~ ^/[A-Za-z0-9_./-]+$ && "$MOUNT" =~ ^/[A-Za-z0-9_./-]+$ && "$NAME" =~ ^[A-Za-z0-9_.-]+$ ]] || {
  echo "ERROR: Pfad oder Name enthaelt unerwartete Zeichen" >&2; exit 2; }
[[ -f "$root/scripts/pi-minio-shared-mount-check.sh" ]] || { echo "ERROR: scripts/pi-minio-shared-mount-check.sh fehlt" >&2; exit 2; }
docker="$(command -v docker || true)"; bash_bin="$(command -v bash)"
[[ -n "$docker" ]] || { echo "ERROR: docker fehlt" >&2; exit 2; }

render() {
  cat <<EOF
# Verwaltet von scripts/pi-minio-autostart.sh (Repo: $root). Nicht von Hand aendern; mit 'remove' entfernen.
[Unit]
Description=SkyHub shared MinIO (Start nur bei vorhandenem Mount)
Documentation=file://$root/pi-minio-acceptance/README.md
After=docker.service network-online.target local-fs.target
Requires=docker.service
RequiresMountsFor=$MOUNT
ConditionPathIsMountPoint=$MOUNT

[Service]
Type=oneshot
RemainAfterExit=yes
TimeoutStartSec=180
TimeoutStopSec=90
ExecStartPre=$bash_bin $root/scripts/pi-minio-shared-mount-check.sh
ExecStart=$docker start $NAME
ExecStop=$docker stop --time 60 $NAME

[Install]
WantedBy=multi-user.target
EOF
}

if [[ "$mode" == check ]]; then
  echo "=== MinIO-Autostart-Unit (nur lesend) ==="
  if [[ -f "$TARGET" ]]; then echo "  ok   Unit installiert: $TARGET"; else echo "  Hinweis Unit nicht installiert"; fi
  echo "  enabled: $(systemctl is-enabled "$UNIT" 2>&1 || true)"
  echo "  aktiv:   $(systemctl is-active "$UNIT" 2>&1 || true)"
  echo "  Container: $(docker inspect -f '{{.State.Status}}, Restart-Policy {{.HostConfig.RestartPolicy.Name}}' "$NAME" 2>&1)"
  exit 0
fi

if [[ "$mode" == plan ]]; then
  echo "=== Geplante Unit $UNIT (nur lesend, nichts installiert) ==="
  render
  echo
  tmp="$(mktemp -d)"; trap 'rm -rf -- "$tmp"' EXIT
  render >"$tmp/$UNIT"
  if command -v systemd-analyze >/dev/null; then
    if systemd-analyze verify "$tmp/$UNIT" 2>"$tmp/verify.err"; then echo "  ok   systemd-analyze verify"
    else echo "  Hinweis systemd-analyze:"; sed 's/^/    /' "$tmp/verify.err" | head -8; fi
  fi
  [[ "$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$NAME" 2>/dev/null)" == no ]] \
    && echo "  ok   Container hat Restart-Policy 'no' (der Start laeuft ausschliesslich ueber die Unit)" \
    || echo "  FEHL Container hat nicht Restart-Policy 'no'"
  findmnt -nr --mountpoint "$MOUNT" >/dev/null && echo "  ok   $MOUNT ist gemountet" || echo "  FEHL $MOUNT nicht gemountet"
  [[ -e "$TARGET" ]] && echo "  Hinweis $TARGET existiert bereits und wird bei 'install' ersetzt" || true
  echo
  echo "Installieren: sudo bash scripts/pi-minio-autostart.sh install   (aktiviert nur den Start beim Boot)"
  exit 0
fi

[[ $EUID == 0 ]] || { echo "ERROR: root erforderlich (sudo)" >&2; exit 2; }
if [[ "$mode" == install ]]; then
  tmp="$(mktemp -d)"; trap 'rm -rf -- "$tmp"' EXIT
  render >"$tmp/$UNIT"
  systemd-analyze verify "$tmp/$UNIT" || { echo "ERROR: Unit besteht systemd-analyze nicht, nichts installiert" >&2; exit 2; }
  [[ "$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$NAME")" == no ]] || { echo "ERROR: Container hat nicht Restart-Policy 'no'" >&2; exit 2; }
  install -m 644 "$tmp/$UNIT" "$TARGET"
  systemctl daemon-reload
  systemctl enable "$UNIT"
  echo "Installiert und fuer den Boot aktiviert. Der laufende Container wurde NICHT angefasst."
  echo "Rueckbau: sudo bash scripts/pi-minio-autostart.sh remove"
else
  systemctl disable "$UNIT" 2>/dev/null || true
  rm -f -- "$TARGET"
  systemctl daemon-reload
  echo "Entfernt. Der laufende Container wurde NICHT angefasst."
fi
