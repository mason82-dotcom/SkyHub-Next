#!/usr/bin/env bash
# Probelauf von SQL-Migrationen an einer KOPIE der Produktionsdatenbank des Pi.
#   bash scripts/pi-migration-rehearsal.sh backend/db/migrations/001_dji_map_elements.sql [weitere.sql ...] [--tests]
# Wirkung: liest die Produktionsdatenbank nur per pg_dump und schreibt NICHTS dorthin. Die Kopie liegt in einem
# Wegwerf-Container (gleiches Image, nur Loopback, Datenbankname skyhub_test wie von den Integrationstests verlangt),
# der samt Dump immer wieder gelöscht wird. Es werden keine Zugangsdaten ausgegeben.
# Geprüft wird: Wiederherstellung, optional (--tests) die datenbankgestützten Integrationstests gegen die Kopie (VOR den
# Migrationen, weil sie den unmigrierten Zustand voraussetzen), Migration (ON_ERROR_STOP), zweiter Lauf
# (Wiederholbarkeit, ein Fehler im zweiten Lauf gilt als FEHL) und dass die Bestandstabellen gegenüber der frisch
# wiederhergestellten Kopie unverändert bleiben (exakte Zeilenzahlen; die Kopie muss zwischen den Live-Zählungen vor und
# nach dem Dump liegen, weil Produktion weiter Telemetrie schreibt).
# Ersetzt keine Freigabe: Eine produktive Migration braucht zusätzlich Sicherung und ausdrückliche Entscheidung.
set -Eeuo pipefail
umask 077

PROD_CONTAINER="${SKYHUB_PG_CONTAINER:-skyhub-next-postgres-1}"
REHEARSAL="skyhub-migration-rehearsal"
PORT="${SKYHUB_REHEARSAL_PORT:-55433}"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

migrations=(); run_tests=0
for arg in "$@"; do
  case "$arg" in
    --tests) run_tests=1 ;;
    -*) echo "Unbekannte Option: $arg" >&2; exit 2 ;;
    *.sql) [[ -f "$arg" ]] || { echo "Datei fehlt: $arg" >&2; exit 2; }; migrations+=("$arg") ;;
    *) echo "Nur .sql-Dateien erlaubt: $arg" >&2; exit 2 ;;
  esac
done
[[ ${#migrations[@]} -gt 0 ]] || { echo "Verwendung: bash scripts/pi-migration-rehearsal.sh <migration.sql> [...] [--tests]" >&2; exit 2; }
for tool in docker python3 ss; do command -v "$tool" >/dev/null || { echo "Fehlt: $tool" >&2; exit 2; }; done
docker inspect "$PROD_CONTAINER" >/dev/null 2>&1 || { echo "Produktions-Container nicht gefunden: $PROD_CONTAINER" >&2; exit 2; }
docker inspect "$REHEARSAL" >/dev/null 2>&1 && { echo "REFUSED: $REHEARSAL existiert bereits (vorheriger Lauf abgebrochen?). Zuerst: docker rm -f $REHEARSAL" >&2; exit 2; }
ss -ltnH "sport = :$PORT" | grep -q . && { echo "REFUSED: Loopback-Port $PORT ist belegt (SKYHUB_REHEARSAL_PORT setzen)." >&2; exit 2; }

IMAGE="$(docker inspect -f '{{.Config.Image}}' "$PROD_CONTAINER")"
WORK="$(mktemp -d)"
cleanup() { docker rm -fv "$REHEARSAL" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

result=0
ok()   { printf '  ok   %s\n' "$*"; }
fail() { printf '  FEHL %s\n' "$*"; result=1; }
prod_psql() { docker exec "$PROD_CONTAINER" sh -c 'psql -U "${POSTGRES_USER:-skyhub_next}" -d "${POSTGRES_DB:-skyhub_next}" -At -c "$1"' sh "$1"; }
copy_psql() { docker exec -i "$REHEARSAL" psql -U skyhub_next -d skyhub_test -v ON_ERROR_STOP=1 -At "$@"; }

echo "1/5 Lesende Sicherung der Produktionsdatenbank ($PROD_CONTAINER, Image $IMAGE)"
mapfile -t tables < <(prod_psql "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1")
# Produktion schreibt weiter (Telemetrie): Zeilenzahlen VOR und NACH dem Dump einklammern, die Kopie muss dazwischen liegen.
declare -A lo hi base
for t in "${tables[@]}"; do lo[$t]="$(prod_psql "select count(*) from \"$t\"")"; done
docker exec "$PROD_CONTAINER" sh -c 'pg_dump -Fc -U "${POSTGRES_USER:-skyhub_next}" -d "${POSTGRES_DB:-skyhub_next}"' > "$WORK/prod.dump"
for t in "${tables[@]}"; do hi[$t]="$(prod_psql "select count(*) from \"$t\"")"; done
[[ -s "$WORK/prod.dump" ]] && ok "Dump $(stat -c %s "$WORK/prod.dump") Bytes (wird am Ende gelöscht)" || { fail "Dump leer"; exit 1; }

echo "2/5 Wegwerf-Container starten und Kopie wiederherstellen"
password="rehearsal_$(python3 -c 'import secrets;print(secrets.token_hex(12))')"
docker run -d --rm --name "$REHEARSAL" -e POSTGRES_USER=skyhub_next -e POSTGRES_DB=skyhub_test \
  -e POSTGRES_PASSWORD="$password" -p "127.0.0.1:$PORT:5432" --memory 384m "$IMAGE" >/dev/null
for _ in $(seq 1 45); do docker exec "$REHEARSAL" pg_isready -U skyhub_next -d skyhub_test -q 2>/dev/null && break; sleep 2; done
docker exec "$REHEARSAL" pg_isready -U skyhub_next -d skyhub_test -q || { fail "Kopie-Datenbank startet nicht"; exit 1; }
docker exec -i "$REHEARSAL" pg_restore -U skyhub_next -d skyhub_test --no-owner < "$WORK/prod.dump" >/dev/null 2>"$WORK/restore.err" || true
# pg_restore-Meldungen enthalten keine Zugangsdaten; Fehlzeilen zeigen, statt sie zu verwerfen.
if grep -qiE 'error' "$WORK/restore.err"; then
  fail "pg_restore meldete Fehler (Schema der Kopie kann von Produktion abweichen):"; grep -iE 'error' "$WORK/restore.err" | head -5
fi
for t in "${tables[@]}"; do
  base[$t]="$(copy_psql -c "select count(*) from \"$t\"" 2>/dev/null || echo FEHLT)"
  if [[ "${base[$t]}" == FEHLT ]] || (( base[$t] < lo[$t] || base[$t] > hi[$t] )); then
    fail "Wiederherstellung: Tabelle $t hat ${base[$t]} Zeilen, erwartet ${lo[$t]}..${hi[$t]}"
  fi
done
[[ $result -eq 0 ]] && ok "${#tables[@]} Tabellen wiederhergestellt, Zeilenzahlen innerhalb der Produktionswerte um den Dump"

# Die Integrationstests legen ihr Schema selbst an und setzen den Zustand "noch nicht migriert" voraus
# (sie prüfen u. a., dass Probe-Tabellen nach ROLLBACK TO SAVEPOINT verschwinden). Deshalb VOR den Migrationen,
# in einer Transaktion, die sie am Ende zurückrollen.
echo "3/5 Datenbankgestützte Integrationstests (vor den Migrationen)"
if [[ $run_tests -eq 1 ]]; then
  if ! command -v node >/dev/null; then
    fail "node fehlt für --tests"
  elif SKYHUB_TEST_DATABASE_URL="postgresql://skyhub_next:$password@127.0.0.1:$PORT/skyhub_test" \
     node --test "$ROOT/backend/test/postgis.integration.test.js" "$ROOT/backend/test/map-element-mutation.integration.test.js" >"$WORK/tests.out" 2>&1; then
    ok "Integrationstests bestanden gegen die Kopie"
  else
    fail "Integrationstests fehlgeschlagen:"; grep -E '^(✖|not ok)' "$WORK/tests.out" | head -5
  fi
else
  echo "  übersprungen (mit --tests aktivieren)"
fi


echo "4/5 Migrationen anwenden (ON_ERROR_STOP) und Wiederholbarkeit prüfen"
for file in "${migrations[@]}"; do
  if copy_psql < "$file" >/dev/null 2>"$WORK/mig.err"; then ok "angewendet: $file"; else fail "Fehler in $file: $(head -c 300 "$WORK/mig.err" | tr '\n' ' ')"; continue; fi
  if copy_psql < "$file" >/dev/null 2>"$WORK/mig2.err"; then ok "zweiter Lauf ohne Fehler: $file"; else fail "nicht wiederholbar: $file ($(head -c 200 "$WORK/mig2.err" | tr '\n' ' '))"; fi
done

echo "5/5 Bestandstabellen nach Tests und Migration unverändert?"
changed=0
for t in "${tables[@]}"; do
  after="$(copy_psql -c "select count(*) from \"$t\"" 2>/dev/null || echo FEHLT)"
  [[ "$after" == "${base[$t]}" ]] || { fail "Tabelle $t: $after statt ${base[$t]} Zeilen"; changed=1; }
done
[[ $changed -eq 0 ]] && ok "alle ${#tables[@]} Bestandstabellen unverändert"

echo
[[ $result -eq 0 ]] && echo "ERGEBNIS: Probelauf bestanden. Produktion wurde nicht verändert; Container und Dump werden entfernt." \
                    || echo "ERGEBNIS: Probelauf NICHT bestanden. Produktion wurde nicht verändert."
exit "$result"
