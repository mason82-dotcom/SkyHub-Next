# BRIX – WPML-Planungsreiter kontrolliert bereitstellen (P1)

Stand 07.11.2026. **Betriebsanleitung, kein ausgeführtes Deployment.**
Ziel ist **das bestehende SkyHub-Next-Backend** auf brix-node (Linux x86-64), **nicht**
die separate DJI Cloud API 2 Vue-DevKit-App. Der Raspberry Pi bleibt der
Caddy-/MQTT-Eingang. Die vorhandenen Docker-Volumes und die vier Infrastruktur-
Dienste werden weder neu erstellt noch migriert.

## Schutzgrenzen

- **DRC bleibt ausgeschaltet**: nur wenn `SKYHUB_DRC_ENABLED=false` sowohl in
  der lokalen Konfiguration als auch im effektiven Compose-Profil und im
  tatsächlich laufenden Backend-Container belegt ist. Andernfalls **STOP**.
- Kein Flug, kein aktiver Operator-Lease, kein RC-Kontrollübergang im Updatefenster.
  Ein Backend-Neustart kann laufende Datenpfade unterbrechen; sichere RC-Rückgabe
  ist bei Transportverlust nicht garantiert.
- Keine Pilot-2-Pairing-Aktion, kein MQTT-Publish, keine MinIO-Synchronisierung,
  keine Datenbankmigration, kein `brix-drc-setup.sh`, kein `compose up` ohne
  ausdrücklichen Backend-Dienstnamen.
- `scripts/brix-planning-rollout-check.py` hat drei Modi. **Alle sind lesend**:
  `source` prüft nur lokale Dateien, `preflight` den BRIX-Baselinezustand,
  `postflight` zusätzlich die ausgelieferten Assets.
  Es führt **nie** `git pull`, Docker Build/Up, Schreib-HTTP, S3 oder DRC aus.
- Die statische Portalprüfung ist keine echte DJI- oder Flugabnahme. Der
  externe Browser-/HTTPS-Test und die Pilot-2-Rückgabe bleiben Betreiberaufgaben.

## A – Istzustand und Freigabe

Auf **brix-node**, nicht auf dem Pi, und ausschließlich außerhalb aktiver
DRC-/Flugsitzungen:

```bash
cd /srv/stacks/skyhub-next
git status --short
git branch --show-current
bash scripts/brix-compose.sh ps
systemctl --user status brix-backup.timer --no-pager
```

Den zuletzt bestätigten Backup-/Restore-Test und die Erreichbarkeit des Pi/Caddy
separat prüfen. Alte Backups allein beweisen keine aktuelle Wiederherstellbarkeit.
Bei unerwarteten lokalen Änderungen, unklarer Containerzuordnung oder
nicht bestätigter RC-Rückgabe abbrechen.

## B – Getesteten Main-Stand abrufen und lesend prüfen

Erst nach bewusster Freigabe und unverändertem Arbeitsbaum:

```bash
git fetch origin main
git pull --ff-only origin main
python3 scripts/brix-planning-rollout-check.py --mode preflight
```

Der Check verlangt u. a. Linux x86-64, `main` == lokal bekanntes
`origin/main`, unveränderte getrackte Dateien, private `.env`, eine
RFC1918-LAN-Bind-Adresse, Compose-Backend-Port 4000→4001 (oder den
konfigurierten Port), laufendes/DRC-deaktiviertes Backend, Postgres, Redis und
Mosquitto, auflösbares altes Docker-Image und `/api/health`.
**FAIL bedeutet keine Freigabe**. Keine interpolierte Compose-JSON im Chat posten:
sie kann Zugangsdaten enthalten.

## C – Backup und reversibles Image sichern

Dieser Block **schreibt lokale Sicherungsdateien und einen Docker-Image-Tag**.
Er ist deshalb im Unterschied zur Vorprüfung eine bewusste Betriebsaktion.

```bash
umask 077
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="$HOME/Projekte/_backups/skyhub-next/$stamp"
mkdir -p "$backup"
cp -p .env "$backup/.env"
if [ -f docker-compose.override.yml ]; then
  cp -p docker-compose.override.yml "$backup/docker-compose.override.yml"
fi
git rev-parse HEAD > "$backup/source-commit.txt"
backend_id=$(bash scripts/brix-compose.sh ps -q backend)
old_image=$(docker inspect -f '{{.Image}}' "$backend_id")
docker image inspect "$old_image" >/dev/null
rollback_tag="skyhub-next-backend:preplanning-$stamp"
docker image tag "$old_image" "$rollback_tag"
printf '%s\n' "$rollback_tag" > "$backup/rollback-tag.txt"
```

Die bereits vorhandene restic-/Datenbanksicherung bleibt davon unabhängig
erforderlich. **Keine** produktive DB-Restore-Aktion während dieses reinen
Frontend-/Backend-Image-Rollouts.

## D – Nur Backend aktualisieren

Einziger geplanter Container-Rollout nach erfolgreichen Gates und Backup:

```bash
bash scripts/brix-compose.sh build backend
bash scripts/brix-compose.sh up -d --no-deps --no-build backend
python3 scripts/brix-planning-rollout-check.py --mode postflight
```

`postflight` prüft lesend `/api/health`, `/cloud-api2.html`,
`/cloud-api2-planning.mjs` und die drei bestehenden WPML-Originalseiten
an der privaten BRIX-Bind-Adresse. Das beweist nur Asset-Auslieferung und
Backend-Liveness; Caddy/TLS, Leaflet, Eingabe und Betriebsberechtigung sind
separat zu prüfen. Beim ersten Fehler keine weiteren Dienste neustarten.

## E – Abnahme nach Deployment

1. Über den **bestehenden Pi-Caddy-HTTPS-Einstieg** den Reiter
   `/cloud-api2.html#planning` öffnen. TLS ohne `-k` prüfen.
2. 320-/390-/834-/1440-px-Vollansicht, Tastatur und echten Touch testen.
   Eingebetteten Editor und Original-Direktlink prüfen.
3. Ohne Speichern eine harmlose lokale Eingabe vornehmen; beim Werkzeugwechsel
   muss sie erhalten bleiben. Keine MinIO- oder Flugaktion auslösen.
4. HTTP/Backend/Containerstatus prüfen; Gerätestatus, RC/Pilot 2 und Broker
   unverändert lassen. DRC bleibt ausdrücklich deaktiviert.
5. Ergebnis mit Zeitpunkt, Commit-ID, PASS/FAIL/UNBEKANNT und
   **anonymisierten** Logs dokumentieren. Keine Tokens, Seriennummern,
   GPS-Daten oder Compose-JSON hochladen.

## F – Rollback nur bei Fehler

Nur den zuvor **lokal markierten**, nachweisbar funktionsfähigen
Backend-Image-Stand wiederherstellen. Kein Postgres-/Redis-/Mosquitto-Neustart:

```bash
rollback_tag=$(cat "$backup/rollback-tag.txt")
docker image inspect "$rollback_tag" >/dev/null
docker image tag "$rollback_tag" skyhub-next-backend:amd64
bash scripts/brix-compose.sh up -d --no-deps --no-build --force-recreate backend
```

Danach Backend, Caddy und erwartete alte Portaloberfläche erneut prüfen.
Der Checkout kann weiterhin neuere Quellen enthalten; ein späterer Build
würde diese erneut übernehmen. Vor erneutem Rollout Ursache beheben
und Source-/Image-Version wieder eindeutig abgleichen.

**Wichtig:** Diese Anleitung wurde in GitHub geprüft, aber auf brix-node
nicht ausgeführt. Die produktive DRC-Hardwarefreigabe ist weiterhin offen.
