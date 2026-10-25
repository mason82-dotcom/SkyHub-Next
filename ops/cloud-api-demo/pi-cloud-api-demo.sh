#!/usr/bin/env bash
# Verwaltet den isolierten DJI-Cloud-API-Demo-Stack (Docker-Projekt "cloudapidemo") auf dem Pi.
# Kein sudo, keine Aenderung an SkyHub Next, Mosquitto, Caddy oder anderen Containern.
#   bash pi-cloud-api-demo.sh init          .env mit Zufallsgeheimnissen anlegen/ergaenzen (nichts wird ueberschrieben)
#   bash pi-cloud-api-demo.sh fetch-sources Upstream-Quellen bei Bedarf klonen und auf den Commit aus sources.lock setzen
#   bash pi-cloud-api-demo.sh preflight     Ports, Speicher, Quellen (Commit-Pin) und Zugangsdaten pruefen (nur lesen)
#   bash pi-cloud-api-demo.sh build         Images bauen, nichts starten
#   bash pi-cloud-api-demo.sh apply         init + Konfiguration rendern + bauen + starten + warten
#   bash pi-cloud-api-demo.sh provision     EMQX-Benutzer (JavaServer, admin, pilot) per REST-API anlegen/aktualisieren
#   bash pi-cloud-api-demo.sh status        Container, Erreichbarkeit, Speicher
#   bash pi-cloud-api-demo.sh logs [dienst] letzte Logzeilen (mysql redis emqx backend web)
#   bash pi-cloud-api-demo.sh rollback      Container und Netz entfernen, Daten (Volumes) bleiben
#   bash pi-cloud-api-demo.sh rollback --purge   zusaetzlich Volumes, Images und erzeugte Konfiguration loeschen
set -Eeuo pipefail
umask 077

STACK_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$STACK_DIR/../.." && pwd)"
# Upstream-Quellen (nicht versioniert, per sources.lock gepinnt) liegen im Projektordner unter third_party/.
SOURCES_DIR="${DEMO_SOURCES_DIR:-$REPO_DIR/third_party/dji-cloud-api-demo}"
ENV_FILE="${ENV_FILE:-$STACK_DIR/.env}"
RUNTIME="${RUNTIME:-$STACK_DIR/runtime}"
cd "$STACK_DIR"
# Pfade immer aus dem Skriptstandort ableiten: aeltere .env-Dateien mit festen Pfaden bleiben damit wirkungslos
# (Umgebungsvariablen haben bei docker compose Vorrang vor --env-file).
export STACK_DIR DEMO_BACKEND_DIR="$SOURCES_DIR/DJI-Cloud-API-Demo" DEMO_WEB_DIR="$SOURCES_DIR/Cloud-API-Demo-Web"
compose=(docker compose --env-file "$ENV_FILE" -f "$STACK_DIR/docker-compose.yml")

say() { printf '%s\n' "$*"; }
die() { printf 'FEHLER: %s\n' "$*" >&2; exit 1; }
rand() { python3 -c 'import secrets;print(secrets.token_hex(16))'; }
envget() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-; }
# Adresse, an die Web, Backend und MQTT gebunden werden: Standard ist die LAN-Adresse, nie 0.0.0.0.
bind_addr() { local v; v="$(envget DEMO_BIND_ADDRESS)"; [[ -n "$v" ]] || v="$(envget LAN_IP)"; printf '%s' "$v"; }
# Gleicher Ursprung (opt-in): Web und Backend hinter einer Adresse (nginx im Web-Container leitet die API und den
# WebSocket weiter). Voraussetzung fuer die HTTPS-Route ueber Caddy; das Backend lauscht dann nur noch auf Loopback.
same_origin() { [[ "$(envget DEMO_SAME_ORIGIN)" == "true" ]]; }
backend_addr() { if same_origin; then printf '127.0.0.1'; else bind_addr; fi; }
if [[ -f "$ENV_FILE" ]]; then export DEMO_BIND_ADDRESS="$(bind_addr)" DEMO_BACKEND_BIND="$(backend_addr)"; fi

# sources.lock: "Verzeichnis URL Commit" je Zeile. Prueft Commit-Pin und unveraenderten Arbeitsbaum.
lock_entries() { grep -vE '^[[:space:]]*(#|$)' "$STACK_DIR/sources.lock"; }
check_sources() {
  local dir url sha head bad=0
  while read -r dir url sha; do
    if [[ ! -d "$SOURCES_DIR/$dir/.git" ]]; then say "FEHL Quelle fehlt: $SOURCES_DIR/$dir (fetch-sources ausfuehren)"; bad=1; continue; fi
    head="$(git -C "$SOURCES_DIR/$dir" rev-parse HEAD 2>/dev/null)"
    if [[ "$head" != "$sha" ]]; then say "FEHL $dir steht auf ${head:0:10}, erwartet ${sha:0:10} (sources.lock)"; bad=1
    elif [[ -n "$(git -C "$SOURCES_DIR/$dir" status --porcelain 2>/dev/null)" ]]; then say "FEHL $dir hat lokale Aenderungen: Quellen muessen unveraendert sein"; bad=1
    else say "ok   $dir @ ${sha:0:10}"; fi
  done < <(lock_entries)
  return $bad
}
cmd_fetch_sources() {
  local dir url sha
  command -v git >/dev/null || die "git fehlt"
  mkdir -p "$SOURCES_DIR"
  while read -r dir url sha; do
    if [[ ! -d "$SOURCES_DIR/$dir/.git" ]]; then
      say "Klone $url nach $SOURCES_DIR/$dir ..."
      git clone --quiet "$url" "$SOURCES_DIR/$dir"
    fi
    [[ -z "$(git -C "$SOURCES_DIR/$dir" status --porcelain)" ]] || die "$dir hat lokale Aenderungen: nichts ueberschrieben"
    git -C "$SOURCES_DIR/$dir" cat-file -e "$sha^{commit}" 2>/dev/null || git -C "$SOURCES_DIR/$dir" fetch --quiet origin
    git -C "$SOURCES_DIR/$dir" checkout --quiet --detach "$sha"
  done < <(lock_entries)
  check_sources
}

cmd_init() {
  touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
  local lan
  lan="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -1)"
  add() { grep -q -E "^$1=" "$ENV_FILE" || { printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; say "  neu: $1"; }; }
  add LAN_IP "${lan:-192.168.178.63}"
  add DEMO_BIND_ADDRESS "${lan:-192.168.178.63}"
  add DEMO_SAME_ORIGIN "false"
  add DJI_APP_ID ""
  add DJI_APP_KEY ""
  add DJI_APP_LICENSE ""
  add AMAP_KEY ""
  add AMAP_SECURITY_CODE ""
  add MAP_TILE_URL ""
  local pm="$HOME/Projekte/SkyHub-Next-data/basemaps"
  add PMTILES_DIR "$([[ -d "$pm" ]] && printf '%s' "$pm")"
  add PMTILES_VECTOR "baden-wuerttemberg.pmtiles"
  add PMTILES_AERIAL "luftbild-home.pmtiles"
  add MAP_CENTER "10.4515,51.1657"
  add MAP_ZOOM "6"
  for key in MYSQL_ROOT_PASSWORD REDIS_PASSWORD JWT_SECRET EMQX_COOKIE EMQX_DASHBOARD_PASSWORD \
             MQTT_JAVA_PASSWORD MQTT_ADMIN_PASSWORD MQTT_PILOT_PASSWORD WEB_ADMIN_PASSWORD WEB_PILOT_PASSWORD; do
    add "$key" "$(rand)"
  done
  add WORKSPACE_BIND_CODE "$(python3 -c 'import secrets;print(secrets.token_hex(4))')"
  say "init fertig. Quellen holen: bash $0 fetch-sources"
  say "Trage DJI_APP_ID, DJI_APP_KEY, DJI_APP_LICENSE (und optional AMAP_KEY) selbst in $ENV_FILE ein."
}

cmd_render() {
  [[ -f "$ENV_FILE" ]] || die ".env fehlt: erst init ausfuehren"
  mkdir -p "$RUNTIME/web"; chmod 700 "$RUNTIME" "$RUNTIME/web"
  python3 - "$ENV_FILE" "$RUNTIME" "$STACK_DIR/web-overlay" <<'PY'
import gzip, json, os, shutil, struct, sys
env_file, rt, overlay = sys.argv[1], sys.argv[2], sys.argv[3]
e = {}
for line in open(env_file):
    line = line.rstrip("\n")
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        e[k] = v
need = ["LAN_IP", "MYSQL_ROOT_PASSWORD", "REDIS_PASSWORD", "JWT_SECRET", "MQTT_JAVA_PASSWORD", "MQTT_ADMIN_PASSWORD",
        "MQTT_PILOT_PASSWORD", "WEB_ADMIN_PASSWORD", "WEB_PILOT_PASSWORD", "WORKSPACE_BIND_CODE"]
missing = [k for k in need if not e.get(k)]
if missing:
    sys.exit("FEHLER: fehlende Werte in .env: " + ", ".join(missing))
q = json.dumps  # JSON-Strings sind gueltiges YAML und TypeScript
lan = e["LAN_IP"]

def write(rel, text, mode=0o644):
    path = os.path.join(rt, rel)
    with open(path, "w") as f:
        f.write(text)
    os.chmod(path, mode)

# Dateien werden einzeln in Container gemountet: Zugriffsschutz kommt vom Verzeichnis runtime/ (0700).
write("application.yml", f"""# erzeugt von pi-cloud-api-demo.sh, ueberschreibt nur die genannten Schluessel
spring:
  datasource:
    druid:
      url: jdbc:mysql://mysql:3306/cloud_sample?useSSL=false&allowPublicKeyRetrieval=true&characterEncoding=utf8
      username: root
      password: {q(e["MYSQL_ROOT_PASSWORD"])}
  redis:
    host: redis
    port: 6379
    password: {q(e["REDIS_PASSWORD"])}
jwt:
  secret: {q(e["JWT_SECRET"])}
mqtt:
  BASIC:
    protocol: MQTT
    host: {q(lan)}
    port: 18830
    username: JavaServer
    password: {q(e["MQTT_JAVA_PASSWORD"])}
  DRC:
    protocol: WS
    host: {q(lan)}
    port: 18084
    path: /mqtt
    username: JavaServer
    password: {q(e["MQTT_JAVA_PASSWORD"])}
cloud-api:
  app:
    id: {q(e.get("DJI_APP_ID", ""))}
    key: {q(e.get("DJI_APP_KEY", ""))}
    license: {q(e.get("DJI_APP_LICENSE", ""))}
oss:
  enable: false
ntp:
  server:
    host: de.pool.ntp.org
livestream:
  url:
    agora:
      channel: ""
      token: ""
      uid: 654321
    rtmp:
      url: ""
    rtsp:
      username: ""
      password: ""
      port: 8554
    gb28181:
      serverIP: 127.0.0.1
      serverPort: 5060
      serverID: "0"
      agentID: "0"
      agentPassword: ""
      localPort: 5061
      channel: "0"
    whip:
      url: ""
logging:
  level:
    com.dji: info
""")
write("20-local-users.sql", f"""USE `cloud_sample`;
UPDATE manage_user SET password='{e["WEB_ADMIN_PASSWORD"]}', mqtt_password='{e["MQTT_ADMIN_PASSWORD"]}' WHERE username='adminPC';
UPDATE manage_user SET password='{e["WEB_PILOT_PASSWORD"]}', mqtt_password='{e["MQTT_PILOT_PASSWORD"]}' WHERE username='pilot';
UPDATE manage_workspace SET bind_code='{e["WORKSPACE_BIND_CODE"]}' WHERE workspace_id='e3dea0f5-37f2-4d79-ae58-490af3228069';
""")
write("acl.conf", """%% erzeugt von pi-cloud-api-demo.sh: alles nicht Genannte wird verweigert
{allow, {username, "JavaServer"}, all, ["#"]}.
{allow, {username, "admin"}, all, ["thing/product/+/drc/#"]}.
{allow, {username, "pilot"}, all, ["thing/product/#", "sys/product/#"]}.
{deny, all}.
""")
same_origin = e.get("DEMO_SAME_ORIGIN", "false").lower() == "true"
if same_origin:
    # Zur Laufzeit aus der Adresse der Seite abgeleitet: gleiches Bundle fuer http://<IP>:8081 und https://<Host>:4444.
    base_url = "window.location.origin + '/'"
    ws_url = "(window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/api/v1/ws'"
else:
    base_url = q("http://" + lan + ":6789/")
    ws_url = q("ws://" + lan + ":6789/api/v1/ws")
center = e.get("MAP_CENTER") or "10.4515,51.1657"
try:
    map_lng, map_lat = [float(x) for x in center.split(",")]
    map_zoom = int(e.get("MAP_ZOOM") or 6)
except ValueError:
    sys.exit("FEHLER: MAP_CENTER muss 'laengengrad,breitengrad' und MAP_ZOOM eine Zahl sein")
def pmtiles_info(path):
    """Liest den PMTiles-v3-Header und die Metadaten (nur lesend, nur die ersten Bytes und der Metadatenblock)."""
    with open(path, "rb") as f:
        h = f.read(127)
        if h[:7] != b"PMTiles" or h[7] != 3:
            return None
        meta_off, meta_len = struct.unpack("<2Q", h[24:40])
        icomp, tcomp, ttype, minz, maxz = struct.unpack("<5B", h[97:102])
        west, south, east, north = [v / 1e7 for v in struct.unpack("<4i", h[102:118])]
        f.seek(meta_off); raw = f.read(meta_len)
    try:
        meta = json.loads(gzip.decompress(raw) if icomp == 2 else raw)
    except Exception:
        meta = {}
    return {"minZoom": minz, "maxZoom": maxz, "bounds": [west, south, east, north],
            "tileType": ttype, "attribution": meta.get("attribution", "")}

basemaps = []
pm_dir = e.get("PMTILES_DIR", "")
if pm_dir:
    for key, default, kind in (("PMTILES_VECTOR", "baden-wuerttemberg.pmtiles", "vector"), ("PMTILES_AERIAL", "luftbild-home.pmtiles", "raster")):
        name = e.get(key) or default
        path = os.path.join(pm_dir, name)
        info = pmtiles_info(path) if os.path.isfile(path) else None
        if not info:
            print(f"WARN {name} in {pm_dir} fehlt oder ist kein PMTiles v3: Ebene wird ausgelassen", file=sys.stderr)
            continue
        if kind == "vector" and info["tileType"] != 1:
            print(f"WARN {name} ist keine Vektorkarte (MVT): ausgelassen", file=sys.stderr); continue
        if kind == "raster" and info["tileType"] not in (2, 3, 4):
            print(f"WARN {name} ist kein Rasterbild (PNG/JPEG/WebP): ausgelassen", file=sys.stderr); continue
        if kind == "vector":
            entry = {"type": "vector", "name": "Karte (offline)", "url": "/basemaps/" + name, "maxZoom": info["maxZoom"],
                     "attribution": "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>-Mitwirkende, <a href=\"https://protomaps.com\">Protomaps</a>"}
        else:
            att = info["attribution"] or "Luftbild"
            entry = {"type": "raster", "name": "Luftbild (offline)", "url": "/basemaps/" + name, "minZoom": info["minZoom"],
                     "maxZoom": info["maxZoom"], "bounds": info["bounds"], "attribution": att,
                     "mime": {2: "image/png", 3: "image/jpeg", 4: "image/webp"}[info["tileType"]]}
        basemaps.append(entry)
os.makedirs(os.path.join(rt, "no-basemaps"), exist_ok=True)

write("web/config.ts", f"""export const CURRENT_CONFIG = {{
  appId: {q(e.get("DJI_APP_ID", ""))},
  appKey: {q(e.get("DJI_APP_KEY", ""))},
  appLicense: {q(e.get("DJI_APP_LICENSE", ""))},
  baseURL: {base_url},
  websocketURL: {ws_url},
  rtmpURL: '',
  gbServerIp: '',
  gbServerPort: '',
  gbServerId: '',
  gbAgentId: '',
  gbPassword: '',
  gbAgentPort: '',
  gbAgentChannel: '',
  rtspUserName: '',
  rtspPassword: '',
  rtspPort: '8554',
  agoraAPPID: '',
  agoraToken: '',
  agoraChannel: '',
  amapKey: '',
  // Karte: Leaflet/OpenStreetMap statt AMap (siehe web-overlay/leaflet-shim)
  mapTileUrl: {q(e.get("MAP_TILE_URL", ""))},
  mapCenter: [{map_lng}, {map_lat}],
  mapZoom: {map_zoom},
  mapBasemaps: {json.dumps(basemaps, ensure_ascii=False)},
}}
""")
shutil.copytree(overlay, os.path.join(rt, "web"), dirs_exist_ok=True)
for root, dirs, files in os.walk(os.path.join(rt, "web")):
    for d in dirs: os.chmod(os.path.join(root, d), 0o755)
    for f in files: os.chmod(os.path.join(root, f), 0o644)
# nginx im Web-Container. Gleicher Ursprung (opt-in): nur die Praefixe des Demo-Backends (url.*.prefix) und der
# WebSocket gehen an das Backend, alles andere bleibt statisch.
nginx_conf = """server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy no-referrer always;
"""
if same_origin:
    nginx_conf += """  client_max_body_size 200m;
  location ~ ^/(manage|map|media|wayline|storage|control)/api/v1/ {
    proxy_pass http://backend:6789;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
    proxy_read_timeout 120s;
  }
  location = /api/v1/ws {
    proxy_pass http://backend:6789;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
  }
"""
nginx_conf += """  # Offline-Karten (PMTiles): nur diese Dateien, Range-Anfragen, nie komprimieren
  location ~ ^/basemaps/[^/]+\\.pmtiles$ {
    gzip off;
    add_header X-Content-Type-Options nosniff always;
    add_header Cache-Control "public, max-age=3600" always;
  }
  location /basemaps/ { return 404; }
  location / { try_files $uri $uri/ /index.html; }
}
"""
write("web/nginx.conf", nginx_conf)

PY
  say "Konfiguration erzeugt in $RUNTIME (Verzeichnis nur fuer dich lesbar)."
}


# EMQX 5.3.0: Benutzer der eingebauten Datenbank per REST-API anlegen (idempotent). Nur gegen 127.0.0.1:18083.
cmd_provision() {
  [[ -f "$ENV_FILE" ]] || die ".env fehlt"
  python3 - "$ENV_FILE" <<'PY'
import base64, json, sys, time, urllib.error, urllib.request
e = {}
for line in open(sys.argv[1]):
    line = line.rstrip("\n")
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); e[k] = v
base = "http://127.0.0.1:18083/api/v5"
def call(method, path, body=None, token=None):
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as err:
        return err.code, None
for _ in range(60):
    try:
        if urllib.request.urlopen("http://127.0.0.1:18083/status", timeout=3).status == 200: break
    except Exception: time.sleep(2)
else: sys.exit("FEHLER: EMQX-API nicht erreichbar")
status, login = call("POST", "/login", {"username": "admin", "password": e["EMQX_DASHBOARD_PASSWORD"]})
if status != 200: sys.exit(f"FEHLER: EMQX-Dashboard-Login fehlgeschlagen (HTTP {status})")
token = login["token"]
authn = "/authentication/password_based%3Abuilt_in_database"
status, _ = call("GET", authn, token=token)
if status == 404:
    status, _ = call("POST", "/authentication", {"mechanism": "password_based", "backend": "built_in_database", "user_id_type": "username",
        "password_hash_algorithm": {"name": "sha256", "salt_position": "suffix"}}, token)
    if status not in (200, 201): sys.exit(f"FEHLER: Authenticator anlegen fehlgeschlagen (HTTP {status})")
for user, key in (("JavaServer", "MQTT_JAVA_PASSWORD"), ("admin", "MQTT_ADMIN_PASSWORD"), ("pilot", "MQTT_PILOT_PASSWORD")):
    status, _ = call("POST", authn + "/users", {"user_id": user, "password": e[key], "is_superuser": False}, token)
    if status == 409:
        status, _ = call("PUT", authn + "/users/" + user, {"password": e[key], "is_superuser": False}, token)
    if status not in (200, 201, 204): sys.exit(f"FEHLER: Benutzer {user} anlegen fehlgeschlagen (HTTP {status})")
status, users = call("GET", authn + "/users", token=token)
names = sorted(u["user_id"] for u in (users or {}).get("data", []))
print("EMQX-Benutzer:", ", ".join(names))
PY
}

own_running() { [[ -n "$("${compose[@]}" ps -q 2>/dev/null)" ]]; }

cmd_preflight() {
  local bad=0 p
  [[ -f "$ENV_FILE" ]] || { say "FEHL .env fehlt: init ausfuehren"; return 1; }
  docker info >/dev/null 2>&1 || { say "FEHL Docker nicht erreichbar"; return 1; }
  local bind; bind="$(bind_addr)"
  if [[ -z "$bind" || "$bind" == "0.0.0.0" || "$bind" == "::" ]]; then say "FEHL DEMO_BIND_ADDRESS fehlt oder ist ein Wildcard (0.0.0.0): nur eine LAN-Adresse ist zulaessig"; bad=1
  elif ! ip -4 -o addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | grep -qx "$bind"; then say "FEHL $bind gehoert keiner Schnittstelle dieses Rechners (LAN_IP geaendert? .env pruefen)"; bad=1
  else say "ok   Bindung an $bind (nicht 0.0.0.0)"; fi
  check_sources || bad=1
  if own_running; then say "ok   eigener Stack laeuft bereits: Portpruefung uebersprungen"
  else
    for p in 8081 6789 18830 18084 18083 3307 6380; do
      if ss -ltnH "sport = :$p" | grep -q .; then say "FEHL Port $p ist belegt"; bad=1; else say "ok   Port $p frei"; fi
    done
  fi
  local avail; avail="$(awk '/MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo)"
  if (( avail >= 1800 )); then say "ok   verfuegbarer Speicher: ${avail} MiB"; else say "WARN nur ${avail} MiB verfuegbar (Stack braucht rund 2 GiB inkl. Build)"; fi
  for k in DJI_APP_ID DJI_APP_KEY DJI_APP_LICENSE; do
    [[ -n "$(envget $k)" ]] && say "ok   $k gesetzt" || say "WARN $k leer: Pilot-2-Anmeldung funktioniert erst mit den DJI-App-Daten"
  done
  local tile_url; tile_url="$(envget MAP_TILE_URL)"
  say "ok   Karte: Leaflet/OpenStreetMap (kein AMap-Key noetig); Kacheln laedt der Browser von ${tile_url:-tile.openstreetmap.org}"
  return $bad
}

cmd_build() {
  cmd_render
  say "Baue Backend (Maven, dauert auf dem Pi einige Minuten) ..."
  nice -n 15 "${compose[@]}" build backend
  say "Baue Frontend (npm) ..."
  nice -n 15 "${compose[@]}" build web
}

cmd_apply() {
  [[ -f "$ENV_FILE" ]] || cmd_init
  cmd_preflight || die "Preflight fehlgeschlagen: nichts gestartet"
  cmd_build
  say "Starte Datenbank, Cache und MQTT-Broker ..."
  "${compose[@]}" up -d mysql redis emqx
  local j
  for j in $(seq 1 48); do
    [[ "$("${compose[@]}" ps --format '{{.Health}}' mysql redis emqx 2>/dev/null | grep -c healthy)" == 3 ]] && break
    sleep 5
  done
  cmd_provision
  say "Starte Backend und Web ..."
  "${compose[@]}" up -d
  say "Warte auf Gesundheit der Dienste (bis 4 min) ..."
  local i
  for i in $(seq 1 48); do
    if [[ "$("${compose[@]}" ps --format '{{.Health}}' mysql redis emqx 2>/dev/null | grep -c healthy)" == 3 ]] \
       && curl -fsS -m 3 -o /dev/null "http://$(bind_addr):8081/"; then break; fi
    sleep 5
  done
  cmd_status
  say ""
  say "Web:       http://$(envget LAN_IP):8081/   (Anmeldung 'adminPC' bzw. 'pilot', Passwoerter in $ENV_FILE)"
  say "Pilot 2:   Cloud-Dienste -> Drittanbieter-Cloud -> http://$(envget LAN_IP):8081/pilot-login"
  say "Hinweis:   Die Fernsteuerung kann nur an EINE Plattform gekoppelt sein (SkyHub Next oder diese Demo)."
}

cmd_status() {
  "${compose[@]}" ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || true
  local lan; lan="$(envget LAN_IP)"
  printf 'Web      http://%s:8081/  -> HTTP %s\n' "$lan" "$(curl -s -m 4 -o /dev/null -w '%{http_code}' "http://$(bind_addr):8081/" || true)"
  printf 'Backend  :6789            -> HTTP %s (404/401 ist ok: antwortet)\n' "$(curl -s -m 4 -o /dev/null -w '%{http_code}' "http://$(backend_addr):6789/manage/api/v1/login" || true)"
  printf 'MQTT     :18830           -> %s\n' "$(timeout 3 bash -c "exec 3<>/dev/tcp/$(bind_addr)/18830" 2>/dev/null && echo offen || echo zu)"
  docker stats --no-stream --format '{{.Name}}  {{.MemUsage}}  CPU {{.CPUPerc}}' $("${compose[@]}" ps -q 2>/dev/null) 2>/dev/null || true
}

cmd_logs() {
  "${compose[@]}" logs --no-color --tail=60 "${1:-backend}" 2>&1 | sed -E 's/(password|secret|token|license|key)([":= ]+)[^ ,"}]+/\1\2<…>/Ig'
}

cmd_rollback() {
  [[ -f "$ENV_FILE" ]] || die "keine .env: nichts zu entfernen"
  if [[ "${1:-}" == "--purge" ]]; then
    "${compose[@]}" down --volumes --rmi local --remove-orphans
    # Nur das erzeugte Verzeichnis unterhalb dieses Stacks loeschen, nie einen frei gesetzten Pfad.
    [[ "$RUNTIME" == "$STACK_DIR"/runtime ]] || die "RUNTIME zeigt nicht auf $STACK_DIR/runtime: nichts geloescht"
    rm -rf "$RUNTIME"
    say "Entfernt: Container, Netz, Volumes (MySQL- und EMQX-Daten), lokale Images und erzeugte Konfiguration. .env bleibt."
  else
    "${compose[@]}" down --remove-orphans
    say "Entfernt: Container und Netz. Volumes und Images bleiben (--purge loescht sie)."
  fi
}

case "${1:-}" in
  init) cmd_init ;;
  fetch-sources) cmd_fetch_sources ;;
  render) cmd_render ;;
  preflight) cmd_preflight ;;
  build) cmd_build ;;
  apply) cmd_apply ;;
  status) cmd_status ;;
  provision) cmd_provision ;;
  logs) shift; cmd_logs "${1:-backend}" ;;
  rollback) shift; cmd_rollback "${1:-}" ;;
  *) say "Verwendung: bash $0 init|fetch-sources|preflight|build|apply|status|logs [dienst]|rollback [--purge]"; exit 2 ;;
esac
