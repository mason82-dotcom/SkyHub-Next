#!/usr/bin/env bash
# Read-only Raspberry Pi topology preflight. No .env sourcing, MQTT publish,
# broker reconfiguration, DJI contact, container changes or secret output.
set -u

broker_kind=emqx
broker_port=1884
if [[ "$#" -eq 4 && "${1:-}" == "--broker-kind" && "${3:-}" == "--broker-port" ]]; then
  broker_kind="$2"
  broker_port="$4"
elif [[ "$#" -ne 0 ]]; then
  echo 'Usage: pi-preflight.sh [--broker-kind emqx --broker-port 1884 | --broker-kind mosquitto --broker-port 1883 | --broker-kind mosquitto-dedicated --broker-port 1884]' >&2
  exit 2
fi
case "$broker_kind/$broker_port" in
  emqx/1884|mosquitto/1883|mosquitto-dedicated/1884) ;;
  *) echo 'REFUSED: broker kind and port must be emqx/1884, mosquitto/1883 or mosquitto-dedicated/1884.' >&2; exit 2 ;;
esac
for executable in ss docker; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    printf 'ERROR: required preflight command not found: %s\n' "$executable" >&2
    exit 2
  fi
done

listening() {
  local port="$1"
  ss -ltnH | awk -v suffix=":$port" '$4 ~ suffix "$" { found=1 } END { exit !found }'
}
# A loopback-only host listener is not reachable via host.docker.internal from
# a bridge-mode backend container. A non-loopback listener is only a prerequisite:
# it is NOT evidence of valid MQTT credentials, ACLs, firewall or connectivity.
listening_non_loopback() {
  local port="$1"
  ss -ltnH | awk -v suffix=":$port" '
    $4 ~ suffix "$" {
      addr=$4
      sub(suffix "$", "", addr)
      gsub(/^\[/, "", addr); gsub(/\]$/, "", addr)
      if (addr!="127.0.0.1" && addr!="::1" && addr!="localhost") found=1
    }
    END { exit !found }'
}

result=0
next_port_ok=0
printf '%s\n' '=== SkyHub Next Raspberry Pi preflight (read-only) ==='
printf 'Configured broker profile: %s / TCP %s\n' "$broker_kind" "$broker_port"

if command -v timedatectl >/dev/null 2>&1; then
  synced="$(timedatectl show -p NTPSynchronized --value 2>/dev/null || true)"
  if [[ "$synced" == yes ]]; then
    echo 'OK: Raspberry Pi clock reports NTP synchronized.'
  elif [[ "$synced" == no ]]; then
    echo 'ERROR: NTP is not synchronized; DJI timestamp validation may fail.' >&2
    result=1
  else
    echo 'WARNING: NTP synchronization could not be determined.'
  fi
else
  echo 'WARNING: timedatectl unavailable; verify host clock.'
fi

if listening "$broker_port"; then
  printf 'OK: Broker TCP %s is listening.\n' "$broker_port"
else
  printf 'ERROR: Configured broker TCP %s is not listening.\n' "$broker_port" >&2
  result=1
fi
if [[ "$broker_kind" == mosquitto || "$broker_kind" == mosquitto-dedicated ]]; then
  mosquitto_unit=mosquitto
  [[ "$broker_kind" == mosquitto-dedicated ]] && mosquitto_unit=skyhub-mosquitto
  if ! command -v systemctl >/dev/null 2>&1 || ! systemctl is-active --quiet "$mosquitto_unit"; then
    printf 'ERROR: Host Mosquitto service %s is not confirmed active.\n' "$mosquitto_unit" >&2
    result=1
  else
    printf 'OK: systemd Mosquitto service %s is active.\n' "$mosquitto_unit"
  fi
  if listening_non_loopback "$broker_port"; then
    echo 'OK: MQTT has a non-loopback listener (Docker access still unverified).'
  else
    echo 'ERROR: MQTT has no non-loopback listener for Docker host-gateway access.' >&2
    result=1
  fi
fi

if docker info >/dev/null 2>&1; then
  if [[ "$broker_kind" == emqx ]]; then
    mapping="$(docker port skyhub_emqx 1883/tcp 2>/dev/null || true)"
    if printf '%s\n' "$mapping" | grep -Eq ':1884$'; then
      echo 'OK: legacy skyhub_emqx maps container 1883 to host 1884.'
    else
      echo 'ERROR: expected skyhub_emqx container mapping is absent.' >&2
      result=1
    fi
  fi
  if docker ps --filter 'name=^/skyhub_backend$' --format '{{.Names}}' | grep -qx skyhub_backend; then
    echo 'INFO: legacy skyhub_backend is running; do not replace its HTTP port.'
  fi
  next_mapping="$(docker port skyhub-next-backend-1 4000/tcp 2>/dev/null || true)"
  if printf '%s\n' "$next_mapping" | grep -qx '127.0.0.1:4001'; then
    next_port_ok=1
    echo 'INFO: skyhub-next-backend-1 publishes container 4000 on 127.0.0.1:4001.'
  fi
else
  echo 'ERROR: Docker daemon unavailable for container/port verification.' >&2
  result=1
fi

if listening 4000; then
  echo 'INFO: TCP 4000 has a listener; do not assume it belongs to SkyHub Next.'
fi
if listening 4001; then
  if [[ "$next_port_ok" == 1 ]]; then
    echo 'OK: TCP 4001 is the expected existing SkyHub Next loopback mapping.'
  else
    echo 'ERROR: TCP 4001 belongs to an unexpected or unverified listener.' >&2
    result=1
  fi
elif [[ "$next_port_ok" == 1 ]]; then
  echo 'ERROR: Docker reports SkyHub Next port 4001 but no listener exists.' >&2
  result=1
else
  echo 'OK: TCP 4001 is currently free.'
fi
if [[ "$result" == 0 ]]; then
  echo 'Preflight passed. This does NOT establish MQTT auth, ACL, DJI Pilot 2 or OSD availability.'
else
  echo 'Preflight failed; no live services were modified.'
fi
exit "$result"
