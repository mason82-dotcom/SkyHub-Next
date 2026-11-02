#!/usr/bin/env bash
# Read-only check that SKYHUB_TRUSTED_PROXY_IPS names the REAL socket peer of Caddy.
#   bash scripts/pi-proxy-peer-check.sh             plan: print findings and the line to set; always exit 0
#   bash scripts/pi-proxy-peer-check.sh --enforce   exit 3 when the setting cannot work (used by pi-update-backend.sh)
# Why: Caddy runs on the host network and reaches the backend through the published loopback port. Docker's userland
# proxy then presents the BRIDGE GATEWAY of the backend's default network as the peer (measured: 172.25.0.1 on the Pi),
# not 127.0.0.1. With the exact-peer allowlist that gateway must be listed, or Caddy's forwarded headers are ignored
# (tokenless LAN dashboard and the HTTPS check of the Pilot 2 page stop working). The gateway is assigned by Docker
# and can change when the network is recreated, so this check compares the setting with the current network.
# Never changes Docker, files or the environment; prints no secrets.
set -Eeuo pipefail
mode="${1:-plan}"
[[ $# -le 1 && ( "$mode" == plan || "$mode" == --enforce ) ]] || {
  echo "Usage: bash scripts/pi-proxy-peer-check.sh [--enforce]" >&2; exit 2; }
network="${SKYHUB_PROXY_NETWORK:-skyhub-next_default}"
caddyfile="${SKYHUB_CADDYFILE:-/opt/caddy/Caddyfile}"
configured="${SKYHUB_TRUSTED_PROXY_IPS:-}"
bad=0
fail() { printf '  FEHL %s\n' "$*"; bad=1; }
ok()   { printf '  ok   %s\n' "$*"; }
note() { printf '  Hinweis %s\n' "$*"; }

gateways="$(docker network inspect "$network" --format '{{range .IPAM.Config}}{{println .Gateway}}{{end}}' 2>/dev/null | grep -E '^[0-9]+(\.[0-9]+){3}$' || true)"
echo "=== Proxy-Peer des Backends (nur lesend) ==="
if [[ -z "$gateways" ]]; then
  echo "  FEHL Docker-Netz $network nicht gefunden oder ohne IPv4-Gateway" >&2
  exit 2
fi
gateway_list="$(printf '%s' "$gateways" | paste -sd, -)"
ok "Gateway von $network: $gateway_list"

proxied=unknown
if [[ -r "$caddyfile" ]]; then
  if grep -qF '127.0.0.1:4001' "$caddyfile"; then proxied=yes; ok "Caddy leitet an 127.0.0.1:4001 weiter ($caddyfile)"
  else proxied=no; ok "Caddyfile verweist nicht auf 127.0.0.1:4001"; fi
else
  note "Caddyfile nicht lesbar ($caddyfile): ob Caddy das Backend bedient, ist nicht pruefbar"
fi

entries=()
if [[ -n "${configured//[[:space:]]/}" ]]; then
  IFS=',' read -r -a raw <<<"$configured"
  for e in "${raw[@]}"; do e="${e//[[:space:]]/}"; [[ -n "$e" ]] && entries+=("$e"); done
fi
if (( ${#entries[@]} == 0 )); then
  note "SKYHUB_TRUSTED_PROXY_IPS ist leer: nur 127.0.0.1 und ::1 duerfen X-Forwarded-* setzen"
else
  ok "SKYHUB_TRUSTED_PROXY_IPS hat ${#entries[@]} Eintrag/Eintraege"
fi

in_gateways() { grep -qxF "$1" <<<"$gateways"; }
for e in "${entries[@]}"; do
  case "$e" in 127.0.0.1|::1) continue ;; esac
  in_gateways "$e" || fail "Eintrag $e ist kein Gateway von $network (Gateway ist jetzt: $gateway_list). Netz neu erzeugt? .env anpassen"
done

if [[ "$proxied" == yes ]]; then
  has_gateway=0
  for e in "${entries[@]}"; do in_gateways "$e" && has_gateway=1; done
  if (( has_gateway == 0 )); then
    fail "Caddy bedient das Backend, aber kein Eintrag nennt den Caddy-Peer. Ohne ihn werden X-Forwarded-For/-Proto ignoriert (LAN-Dashboard, Pilot-HTTPS)"
    echo "       Zu setzen in .env: SKYHUB_TRUSTED_PROXY_IPS=${gateway_list%%,*}"
  fi
fi
(( bad == 0 )) && echo "Ergebnis: passt" || echo "Ergebnis: Luecken (FEHL oben)"
if [[ "$mode" == --enforce && $bad -ne 0 ]]; then exit 3; fi
exit 0
