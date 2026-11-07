#!/usr/bin/env bash
# ADR-001: prepare brix-node for the central WPML route library with Forgejo operator login.
#
#   bash scripts/brix-wpml-central-setup.sh            # = --check: read-only status, changes nothing
#   bash scripts/brix-wpml-central-setup.sh --apply    # backup, migrations 003-005, workspace role, app login, secrets
#
# --apply does NOT switch the feature on and does NOT restart anything. Afterwards (see output):
#   echo SKYHUB_WPML_CENTRAL=1 >> .env && bash scripts/brix-compose.sh up -d --no-deps --no-build backend
# Idempotent: existing secrets are kept, migrations use IF NOT EXISTS / CREATE OR REPLACE.
# Never prints a secret; secrets reach psql only via stdin, never via argv or environment of other processes.
set -Eeuo pipefail
cd "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:---check}"
[[ "$mode" == --check || "$mode" == --apply ]] || { echo "Verwendung: $0 [--check|--apply]" >&2; exit 2; }
[[ "$(uname -m)" == x86_64 ]] || { echo "ERROR: nur fuer brix-node" >&2; exit 2; }
[[ -f .env ]] || { echo "ERROR: .env fehlt" >&2; exit 2; }

SECRETS_DIR="${SKYHUB_WPML_SECRETS_DIR:-$HOME/.config/skyhub-wpml}"
CLIENT="$SECRETS_DIR/oidc-client.json"
CENTRAL="$SECRETS_DIR/central.json"
envval(){ grep -E "^$1=" .env | tail -n1 | cut -d= -f2- || true; }
WS="$(envval SKYHUB_PILOT_WORKSPACE_ID)"
compose(){ bash scripts/brix-compose.sh "$@" 2> >(grep -v '^+ ' >&2); }
psql_admin(){ compose exec -T postgres psql -X -q -v ON_ERROR_STOP=1 -U skyhub_next -d skyhub_next "$@"; }
ok(){ printf '  [ok]   %s\n' "$*"; }
todo(){ printf '  [offen] %s\n' "$*"; }
fail(){ printf '  [FEHLER] %s\n' "$*" >&2; exit 1; }

echo "== Voraussetzungen"
[[ "$WS" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] \
  && ok "SKYHUB_PILOT_WORKSPACE_ID gesetzt" || fail "SKYHUB_PILOT_WORKSPACE_ID fehlt oder ist keine UUID"
[[ "$(id -u)" == 1000 ]] && ok "uid 1000 (= node im Backend-Image)" || fail "Skript als uid 1000 ausfuehren (Dateien muessen node gehoeren)"
for f in backend/db/migrations/003_wpml_route_library_draft.sql backend/db/migrations/004_wpml_route_audit_draft.sql \
         backend/db/migrations/005_wpml_runtime_rls_draft.sql docker-compose.wpml-central.brix.yml; do
  [[ -f "$f" ]] || fail "$f fehlt (Repo noch nicht auf dem Stand von #99?)"
done
ok "Migrationen und Overlay vorhanden"
psql_admin -tAc 'select 1' >/dev/null || fail "Postgres nicht erreichbar (bash scripts/brix-compose.sh ps)"
ok "Postgres erreichbar"
if [[ -f "$CLIENT" && "$(stat -c %a "$CLIENT")" == 600 ]] && \
   python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d.get("client_id") and len(d.get("client_secret",""))>=16 else 1)' "$CLIENT"; then
  ok "Forgejo-Client $CLIENT (0600, client_id + client_secret)"
else
  fail "$CLIENT fehlt, ist nicht 0600 oder unvollstaendig"
fi

state(){
  psql_admin -tAc "select
    (to_regclass('public.skyhub_wpml_routes') is not null)::int,
    (to_regclass('public.skyhub_wpml_route_audit') is not null)::int,
    (to_regclass('public.skyhub_wpml_workspace_role') is not null)::int,
    coalesce((select rolcanlogin::int from pg_roles where rolname='skyhub_wpml_app'),-1),
    (select count(*) from pg_roles where rolname='skyhub_wpml_ws_'||replace('$WS','-',''))" | tr '|' ' '
}
read -r t003 t004 t005 app_login ws_role < <(state)
echo "== Datenbank"
[[ $t003 == 1 ]] && ok "003 Routenbibliothek" || todo "003 Routenbibliothek"
[[ $t004 == 1 ]] && ok "004 Audit" || todo "004 Audit"
[[ $t005 == 1 ]] && ok "005 Laufzeitrolle und RLS" || todo "005 Laufzeitrolle und RLS"
[[ $ws_role == 1 ]] && ok "Workspace-Rolle pilot" || todo "Workspace-Rolle pilot"
[[ $app_login == 1 ]] && ok "skyhub_wpml_app darf sich anmelden" || todo "Login fuer skyhub_wpml_app"
echo "== Secrets"
[[ -f "$CENTRAL" && "$(stat -c %a "$CENTRAL")" == 600 ]] && ok "$CENTRAL (0600)" || todo "$CENTRAL"
echo "== .env"
for k in SKYHUB_WPML_SECRETS_DIR SKYHUB_WPML_OIDC_ISSUER SKYHUB_WPML_OIDC_REDIRECT_URI SKYHUB_WPML_OPERATOR_ISSUER \
         SKYHUB_WPML_WORKSPACES SKYHUB_WPML_CENTRAL_ORIGINS; do
  [[ -n "$(envval "$k")" ]] && ok "$k" || todo "$k"
done
[[ "$(envval SKYHUB_WPML_CENTRAL)" == 1 ]] && ok "SKYHUB_WPML_CENTRAL=1 (eingeschaltet)" || todo "SKYHUB_WPML_CENTRAL=1 (noch aus)"
echo "== Forgejo vom Backend-Container aus"
issuer="$(envval SKYHUB_WPML_OIDC_ISSUER)"; issuer="${issuer:-https://rpi5-pironman.tailf59dac.ts.net:9445}"
if compose exec -T backend node -e '
  fetch(process.argv[1]+"/.well-known/openid-configuration",{signal:AbortSignal.timeout(5000)})
    .then(r=>r.json()).then(d=>process.exit(d.issuer===process.argv[1]?0:3)).catch(()=>process.exit(4))' "$issuer"; then
  ok "Discovery von $issuer erreichbar, issuer passt"
else
  todo "Backend erreicht $issuer nicht (DNS/Tailscale im Container pruefen, z. B. extra_hosts)"
fi

[[ "$mode" == --check ]] && { echo; echo "Nur geprueft. Einrichten: bash $0 --apply"; exit 0; }

echo; echo "== Einrichten"
umask 077
mkdir -p "$HOME/Projekte/_backups/skyhub-next"
backup="$HOME/Projekte/_backups/skyhub-next/pre-wpml-central-$(date -u +%Y%m%dT%H%M%SZ).dump"
compose exec -T postgres pg_dump -U skyhub_next -d skyhub_next -Fc > "$backup"
[[ -s "$backup" ]] || fail "Backup leer"
ok "Backup $backup ($(du -h "$backup" | cut -f1))"

if [[ $t003 != 1 || $t004 != 1 || $t005 != 1 ]]; then
  cat backend/db/migrations/003_wpml_route_library_draft.sql backend/db/migrations/004_wpml_route_audit_draft.sql \
      backend/db/migrations/005_wpml_runtime_rls_draft.sql | psql_admin -1 -f -
  ok "Migrationen 003-005 in einer Transaktion angewendet"
fi
psql_admin -tAc "select skyhub_wpml_provision_workspace('$WS'::uuid)" >/dev/null
ok "Workspace-Rolle pilot bereitgestellt"

if [[ ! -f "$CENTRAL" ]]; then
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  openssl genpkey -algorithm ed25519 -out "$tmp/sign.pem" 2>/dev/null
  dbpw="$(openssl rand -hex 32)"
  # Password goes to psql on stdin only.
  printf "\\\\set pw '%s'\nALTER ROLE skyhub_wpml_app LOGIN PASSWORD :'pw' CONNECTION LIMIT 8;\n" "$dbpw" | psql_admin -f -
  ok "Login fuer skyhub_wpml_app gesetzt (Passwort nur in $CENTRAL)"
  DBPW="$dbpw" KEYFILE="$tmp/sign.pem" OUT="$CENTRAL" python3 - <<'PY'
import base64, json, os, secrets, datetime
out = os.environ["OUT"]
data = {
    "signingKeyPem": open(os.environ["KEYFILE"]).read(),
    "keyId": "wpml-" + datetime.date.today().strftime("%Y%m%d"),
    "keySecret": secrets.token_urlsafe(48),
    "recordMacSecret": secrets.token_urlsafe(48),
    "cookieKey": base64.b64encode(secrets.token_bytes(32)).decode(),
    "databaseUrl": "postgresql://skyhub_wpml_app:%s@postgres:5432/skyhub_next" % os.environ["DBPW"],
}
fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as f:
    json.dump(data, f)
PY
  unset dbpw
  ok "$CENTRAL erzeugt (0600)"
else
  ok "$CENTRAL vorhanden, bleibt unveraendert"
fi

add_env(){ [[ -n "$(envval "$1")" ]] || { printf '%s=%s\n' "$1" "$2" >> .env; ok ".env: $1 ergaenzt"; }; }
add_env SKYHUB_WPML_SECRETS_DIR "$SECRETS_DIR"
add_env SKYHUB_WPML_OIDC_ISSUER "https://rpi5-pironman.tailf59dac.ts.net:9445"
add_env SKYHUB_WPML_OIDC_REDIRECT_URI "https://rpi5.fritz.box:4443/wpml/oidc/callback"
add_env SKYHUB_WPML_OIDC_ORG "skyhub"
add_env SKYHUB_WPML_OPERATOR_ISSUER "https://rpi5.fritz.box:4443/wpml-operator"
add_env SKYHUB_WPML_WORKSPACES "pilot=$WS"
add_env SKYHUB_WPML_CENTRAL_ORIGINS "https://rpi5.fritz.box:4443"

echo
echo "Fertig vorbereitet, noch AUS. Einschalten:"
echo "  echo SKYHUB_WPML_CENTRAL=1 >> .env && bash scripts/brix-compose.sh up -d --no-deps --no-build backend"
echo "  docker logs skyhub-next-backend-1 2>&1 | grep wpml-central"
echo "Zurueck: Zeile SKYHUB_WPML_CENTRAL=1 aus .env entfernen und denselben up-Befehl ausfuehren."
