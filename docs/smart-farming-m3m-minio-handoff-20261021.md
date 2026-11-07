# SkyHub M3M + MinIO: Neuaufnahme und Integrationsuebergabe (21.10.2026)

**Geltungsbereich:** Aktiver SkyHub-Next-Checkout auf Raspberry Pi 5,
M3M-Medienbestand auf privatem MinIO. Diese Notiz dokumentiert
bereits gemeldete Pi-Tests und ersetzt **keine** Live-SSH-Abfrage.

## Gesicherte Pi-Fakten (aus den Hardwaretests vom 21.10.2026)

- MinIO läuft als einzelner Docker-Dienst auf **ARM64** mit
  **RestartCount 0** und Readiness-HTTP-Status **200**.
- Bestandsdaten auf NVMe unter
  `/mnt/hc4backup/skyhub-next/minio`; zuletzt ca. **31 GB**
  Objektbestand gemeldet. Das ist **kein** verifiziertes Backup.
- Die fünf SkyHub-Buckets sind per **S3 HEAD und LIST** erreichbar.
  Ein eigener Reader-Zugang darf lesen; **PUT und DELETE wurden mit
  HTTP 403 zurückgewiesen**. MinIO-Root-Credentials liegen nicht im
  Backend-Reader.
- Das produktive SkyHub-Backend erreicht den gemeinsamen Container.
  Medien-Endpoints wurden authentifiziert geprüft:
  `/api/media/status`, `/api/media/buckets` und
  `/api/media/objects` jeweils **HTTP 200**; ohne View-Token
  wurde **HTTP 401** bestätigt.
- Lokale Compose-Overlays `docker-compose.minio.yml` und
  `docker-compose.media.yml` sowie `.env` sind **privat**
  (Dateimodus 0600 / Git-Exclude). Die S3-Variablen sind absichtlich
  nicht automatisch in der interaktiven Pi-Shell gesetzt, aber
  im produktiven Backend-Container verfügbar. **Keine Werte ausgeben.**

Diese Befunde schließen den bisherigen Blocker
„Mediencontainer funktioniert noch nicht“ im Rahmen der gemeldeten
**Laufzeit- und Lesezugriffstests**. Noch offen sind Backup/Restore,
bootfeste NVMe-Mount-Abhängigkeit und Upload über die DJI-Pilot-2-
Medien-Schnittstelle. Sie dürfen nicht aus einem HTTP-200-Check
als erledigt abgeleitet werden.

## Bereits entwickelte M3M-MinIO-Integration: lokal auf Pi

Der getrennte lokale Entwicklungsbranch
`feature/m3m-minio-integration-20261021` wurde mit HEAD
`5a77de6` und sauberen Git-Status gemeldet. **Dieser Branch
ist am 21.10.2026 nicht im GitHub-Remote sichtbar** und darf nicht
als bereits reviewte/veröffentlichte Implementierung gelten.

Bekannte lokale Inhalte:
- `backend/m3m-s3-inventory.js` mit
  `inventoryM3MFromS3()` auf `dji-cloud`:
  gebundene Pagination (200 Elemente pro Seite, höchstens 101
  Seiten / 20.000 direkte Einträge) und aggregierte Ausgabe,
  **keine Objektschlüssel in der Ergebnistabelle**.
- `backend/test/m3m-s3-inventory.test.js` mit 12 S3-Tests;
  `backend/media-api.js` und
  `backend/test/media-api.test.js` mit 8 HTTP-Tests.
- Geplante lesende API:
  `GET /api/media/m3m/inventory?prefix=...`.
  **Lokal implementiert und synthetisch getestet** ist nicht
  gleich **im produktiven Pi-Backend aktiviert**.
- Zuletzt gemeldeter lokaler Testsatz: **278 Tests, davon
  276 bestanden, 2 bewusst uebersprungen, 0 Fehler**.

Ein M3M-Scan der **ersten 100 direkten S3-Objekte**
ergab 3 nach den strikten Namensregeln erkennbare
Dateien: **RGB 1, Red 1, NIR 1**. Daraus wurden
**2 Dateinamen-Aufnahmegruppen** ermittelt, keine vollstaendige
Vier-Spektral- oder Fuenf-Kanal-Gruppe.
`G` und `RE` wurden dort nicht gefunden.
Dieser *seitengesteuerte Teilausschnitt* erlaubt **keine**
Aussage, ob im gesamten Bucket vollständige M3M-Aufnahmesätze
liegen.

## Naechster sicherer Ablauf

### 1. Lokalen Integrationsbranch ohne Branchwechsel veröffentlichen

Auf dem Pi im aktiven SkyHub-Checkout:

```bash
cd ~/Projekte/SkyHub-Next
git status --short --branch
git show -s --oneline feature/m3m-minio-integration-20261021
git diff --check origin/main...feature/m3m-minio-integration-20261021
# Zu diesem Branch gehoerende getrackte Dateinamen auf
# versehentlich versionierte Secrets pruefen (niemals Werte posten):
git ls-tree -r --name-only feature/m3m-minio-integration-20261021 |
  grep -E '(^|/)(\.env$|\.env\.(local|production|development)$|id_rsa$|credentials(\.json)?$|secrets\.json$)' || true

# NUR wenn keine privaten Konfigurationsdateien versioniert sind:
git push -u origin \
  refs/heads/feature/m3m-minio-integration-20261021:refs/heads/feature/m3m-minio-integration-20261021
```

Das `git push` eroeffnet **keinen** Docker-Service, startet
keinen MinIO und veraendert keine Datenbank. Danach kann der
tatsaechlich genutzte Code aus dem Remote geprueft, mit den
separaten MinIO- und M3M-Medienbranches abgeglichen und ein
isolierter PR mit vollstaendiger CI erstellt werden.
Falls der Branch nicht existiert oder die gefundene Git-History
anders ist, den Push abbrechen; **keinen Reset** ausfuehren.

### 2. Vollständige Pagination als isolierten Lese-Test prüfen

Vor einem produktiven Deploy sicherstellen, dass:
- `prefix` durch den Nutzer explizit auf den bekannten
  M3M-Dateibaum begrenzt ist, nicht auf den gesamten Bucket;
- Fortsetzungstokens bei Wiederholung abbrechen und die
  101-Seiten-/20.000-Datei-Grenze wirklich durchsetzen;
- ausschliesslich direkte M3M-Dateieintraege gezaehlt werden,
  keine entfernten Unterverzeichnisse anderer Projekte;
- eine abgeschnittene Ergebnisliste (`truncated=true`)
  niemals als vollstaendige Bilanz ausgegeben wird;
- Seriennummern, Schluessel, Fotos, EXIF, XMP, GPS, Objektnamen
  und Credentials nicht in Konsolen-/HTTP-Antworten landen;
- S3-Reader-Account unveraendert **keine** PUT-/DELETE-Rechte hat.

### 3. DJI-Medien-/Bilddaten erst nach gesonderter Freigabe

Filename-Gruppen sind nur eine **Hypothese**.
`radiometricCalibrationVerified`,
`bandCoregistrationVerified`, `reflectanceReady`,
`ndviReady`, `ndreReady` bleiben **false**.
M3M-JPEG-/TIFF-Originalbilder, deren Kalibrier-Tags und
Band-Coregistrierung wurden damit **nicht** geprueft.
Keine DJI-Medienuploads, keine S3-Objektwrites, keine
`media_assets`-Migration ohne getrennte Tests.

## Branches im Remote (Stand der Neuaufnahme)

- `main`: produktiver Basiscodestand, nicht automatisch Pi-Deployment.
- `feature/shared-minio-storage-20261021`: Shared-NVMe-
  MinIO-Migration und Betriebspruefungen, offen in Draft-PR #19.
- `feature/minio-media-readonly-20261021`: authentifizierter
  S3-Medien-Lesezugang, bisher eigenstaendiger Branch.
- `feature/m3m-media-inventory-readonly-20261021`: rein lokale
  Verzeichnis-/Dateinamensinventur, Draft-PR #23.
- `feature/m3m-minio-integration-20261021`: **nur als Pi-local
  belegt, noch nicht vom GitHub-Remote eingelesen**.

Die naechste Code-Review soll **vor** einem Merge/Backend-Rebuild
den tatsaechlichen, lokal bereits weit entwickelten Branch verwenden,
anstatt MinIO, Medien-API oder M3M-Inventur parallel neu zu schreiben.
