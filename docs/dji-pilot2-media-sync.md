# DJI Pilot 2 – Mediensynchronisation RC Plus 2 / RC Pro (31.10.2026)

## Verhalten

- **Nur manueller Upload.** Pilot 2 lädt nichts automatisch hoch: `pilot-login.js` lädt das DJI-Modul `media` mit `autoUploadPhoto:false`, `autoUploadVideo:false` und setzt diese Werte bei jedem Seitenaufruf erneut (`mediaSetAutoUploadPhoto/Video(false)`). Ein in Pilot 2 eingeschalteter Auto-Upload wird so wieder ausgeschaltet.
- Hochladen: in Pilot 2 im **Album** Fotos/Videos auswählen → Cloud-Upload. Die Dateien landen in MinIO unter `dji-cloud/<Workspace>/media/<Sitzung>/` und erscheinen sofort in der **Mediengalerie** (`/media-gallery.html#b=dji-cloud`).
- Fotos werden als Original übertragen (`uploadPhotoType 0`).

## Ablauf

1. Pilot 2 → `POST https://rpi5.fritz.box/storage/api/v1/workspaces/<ws>/sts` (Header `X-Auth-Token` = Gerätetoken aus der Kopplung). SkyHub fordert beim MinIO mit dem eigenen Upload-Konto `skyhub-pilot-uploader` per **AssumeRole** 15-Minuten-Zugangsdaten an. Die Sitzungsrichtlinie erlaubt nur `PutObject`/Multipart unter genau `dji-cloud/<ws>/media/<32-hex-Sitzung>/`; der Bereich wird in `dji_pilot_media_grants` registriert.
2. Pilot 2 lädt per S3 nach `https://rpi5.fritz.box:9446` hoch. Caddy (nur Heimnetz, nur PUT/POST/HEAD, Auth-Header nicht im Log) → `127.0.0.1:4002` → schmaler Upload-Proxy im Backend → `skyhub-minio:9000`. MinIO bleibt ohne veröffentlichten Port.
3. Pilot 2 → `POST /media/api/v1/workspaces/<ws>/upload-callback`. SkyHub prüft das Objekt per eigenem S3-HEAD (Lesekonto) und speichert es in `dji_pilot_media_verified`; Audit in `dji_pilot_media_http_audit`, Redis-Ratenlimits.

Code: `backend/minio-sts.js`, `backend/s3-upload-proxy.js`, `backend/pilot-media-upload-runtime.js`; bestehende Bausteine `pilot-media-sts.js`, `pilot-media-http.js`, `pilot-media-store.js` (Migrationen 003–005 sind auf dem Pi vorhanden).

## Einrichtung auf dem Pi

```bash
cd ~/Projekte/SkyHub-Next
bash scripts/pi-minio-pilot-uploader.sh plan
bash scripts/pi-minio-pilot-uploader.sh apply        # Konto + Richtlinie, Schlüssel nach .env (Sicherung)
sudo bash scripts/pi-caddy-pilot-media.sh apply      # /storage/api, /media/api und S3-Endpunkt :9446
```

In `.env` ergänzen:

```
SKYHUB_PILOT_MEDIA_UPLOAD_ENABLED=true
SKYHUB_PILOT_PUBLIC_URL=https://rpi5.fritz.box
SKYHUB_PILOT_MEDIA_S3_PUBLIC_ENDPOINT=https://rpi5.fritz.box:9446
```

Danach `bash scripts/pi-update-backend.sh --apply` (von sauberem `main`). Im Backend-Log erscheint `[pilot media] upload sync active`, `/api/health` enthält `pilotMediaUpload` (Anzahl Grants, Proxy-Zähler). Auf der RC die Pilot-Login-Seite neu öffnen; die Diagnose zeigt „Medien-Synchronisation: bereit, nur manueller Upload“.

**Abschalten:** `SKYHUB_PILOT_MEDIA_UPLOAD_ENABLED=false` und Backend-Update; Caddy-Rückbau mit `sudo bash scripts/pi-caddy-pilot-media.sh rollback`.

## Offene Hardwarepunkte

- Ob Pilot 2 dem Caddy-internen Zertifikat für den S3-Endpunkt vertraut, ist erst am RC prüfbar (die Login-Seite über dieselbe CA funktioniert).
- `fast-upload` antwortet für unbekannte Fingerprints mit 404 (DJI dokumentiert keinen Fehlerfall); Pilot 2 sollte dann normal hochladen.
- Sehr große Videos: Die STS-Zugangsdaten gelten 15 Minuten; Pilot 2 fordert bei Ablauf neue an.
