#!/usr/bin/env bash
# Live-Steuerung (DRC) auf brix-node einrichten: zwei Mosquitto-Benutzer mit ACL (docs/drc-matrice4.md), .env-Einträge,
# Broker neu einlesen, Backend neu starten. Als mason auf brix-node im Stack-Ordner ausführen (kein root):
#   bash scripts/brix-drc-setup.sh 9N9CN0000000RC 192.168.178.63:1884
# Passwörter und Token werden erzeugt und NIE angezeigt; das DRC-Token liegt danach in ~/.config/skyhub/drc-token (0600).
# Idempotent: läuft nicht ein zweites Mal, wenn skyhub_commander schon in der ACL steht. Sicherungen: *.bak-<zeit>.
set -Eeuo pipefail
cd "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
GATEWAY="${1:?Seriennummer der RC Plus 2 angeben}"; BROKER="${2:?Broker-Adresse host:port aus Sicht der RC angeben}"
[[ "$GATEWAY" =~ ^[A-Za-z0-9_-]{4,64}$ ]] || { echo "ungültige Seriennummer" >&2; exit 2; }
[[ "$BROKER" =~ ^[A-Za-z0-9.-]+:[0-9]{1,5}$ ]] || { echo "Broker als host:port" >&2; exit 2; }
M=ops/brix/mosquitto
[[ -f $M/acl && -f $M/passwd && -f .env ]] || { echo "ops/brix/mosquitto/{acl,passwd} oder .env fehlen" >&2; exit 2; }
if grep -q '^user skyhub_commander$' $M/acl; then echo "DRC-Benutzer sind bereits eingerichtet – nichts geändert."; exit 0; fi
grep -q '^SKYHUB_DRC_' .env && { echo "SKYHUB_DRC_* steht schon in .env – bitte prüfen, nichts geändert." >&2; exit 2; }

ts=$(date +%Y%m%d-%H%M%S); umask 077
cp -p $M/acl "$M/acl.bak-$ts"; cp -p $M/passwd "$M/passwd.bak-$ts"; cp -p .env ".env.before-drc-$ts"
gen(){ openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-"$1"; }
pc=$(gen 32); pl=$(gen 32); tk=$(gen 40)
# Mosquitto-Hash ($7$ = PBKDF2-SHA512, 101 Runden) wie scripts/pi-mosquitto-dedicated.js passwdLine(); Passwort per stdin.
hash(){ printf '%s\n%s' "$1" "$2" | docker exec -i skyhub-next-backend-1 node -e '
const c=require("crypto");let d="";process.stdin.on("data",x=>d+=x).on("end",()=>{const i=d.indexOf("\n"),u=d.slice(0,i),p=d.slice(i+1);
const s=c.randomBytes(12),h=c.pbkdf2Sync(p,s,101,64,"sha512");process.stdout.write(u+":$7$101$"+s.toString("base64")+"$"+h.toString("base64")+"\n");});'; }
hash skyhub_commander "$pc" >> $M/passwd
hash skyhub_drc_link "$pl" >> $M/passwd
cat >> $M/acl <<ACL

user skyhub_commander
topic write thing/product/${GATEWAY}/services
topic write thing/product/${GATEWAY}/drc/down
topic write thing/product/${GATEWAY}/events_reply
topic read thing/product/${GATEWAY}/services_reply
topic read thing/product/${GATEWAY}/events
topic read thing/product/${GATEWAY}/osd
topic read thing/product/${GATEWAY}/state
topic read thing/product/${GATEWAY}/drc/up

user skyhub_drc_link
topic write thing/product/${GATEWAY}/drc/up
topic read thing/product/${GATEWAY}/drc/down
ACL
{
  printf '\n# Live-Steuerung (DRC), eingerichtet %s mit scripts/brix-drc-setup.sh (docs/drc-matrice4.md)\n' "$ts"
  printf 'SKYHUB_DRC_ENABLED=true\nSKYHUB_DRC_TOKEN=%s\nSKYHUB_DRC_GATEWAY_SN=%s\n' "$tk" "$GATEWAY"
  printf 'SKYHUB_DRC_MQTT_URL=mqtt://mosquitto:1884\nSKYHUB_DRC_MQTT_USERNAME=skyhub_commander\nSKYHUB_DRC_MQTT_PASSWORD=%s\n' "$pc"
  printf 'SKYHUB_DRC_BROKER_ADDRESS=%s\nSKYHUB_DRC_BROKER_USERNAME=skyhub_drc_link\nSKYHUB_DRC_BROKER_PASSWORD=%s\nSKYHUB_DRC_BROKER_TLS=false\n' "$BROKER" "$pl"
} >> .env
mkdir -p ~/.config/skyhub; printf '%s\n' "$tk" > ~/.config/skyhub/drc-token
unset pc pl tk

docker kill -s HUP skyhub-next-mosquitto-1 >/dev/null
echo "Mosquitto-Benutzer: $(cut -d: -f1 $M/passwd | tr '\n' ' ')"
bash scripts/brix-compose.sh up -d --no-deps backend
for i in $(seq 30); do s=$(docker inspect -f '{{.State.Health.Status}}' skyhub-next-backend-1); [[ $s == healthy ]] && break; sleep 3; done
echo "Backend: $s"
docker logs --since 2m skyhub-next-backend-1 2>&1 | grep -E '^\[drc\]' | head -5
echo "Sicherungen: $M/acl.bak-$ts $M/passwd.bak-$ts .env.before-drc-$ts"
