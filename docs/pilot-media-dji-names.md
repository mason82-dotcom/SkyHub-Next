# Originale DJI-Dateinamen für Pilot-2-Medien

DJI Pilot 2 legt Uploads als `dji-cloud/<ws>/media/<sitzung>/org_<fingerprint>_<ms>.<ext>` ab und meldet den echten
Kameranamen (`DJI_20261004172757_0096_V.JPG`) nur in der Upload-Bestätigung (`dji_pilot_media_verified.file_name`).
Mit dieser Funktion benennt SkyHub jede bestätigte Datei im selben Sitzungsordner in den DJI-Namen um.

## Ablauf je Datei (`backend/pilot-media-rename.js`)
1. Nur echte DJI-Namen (`DJI_<14 Ziffern>_<4 Ziffern>[_Kennung].<jpg|dng|mp4|mov|tif|…>`), nur unter dem registrierten
   Sitzungsordner des eigenen Arbeitsbereichs; existiert der Zielname schon, bleibt die Datei unverändert.
2. Kopie anlegen → Größe der Kopie prüfen → Datenbank: `object_key` = DJI-Name, `pilot_object_key` = Originalschlüssel,
   neuer ETag → erst dann das Original löschen. Bei jedem Fehler bleibt das Original erhalten.
3. Wiederholt Pilot 2 die Upload-Bestätigung mit dem Originalschlüssel, beantwortet SkyHub sie aus dem Eintrag
   (`pilot_object_key`) statt per HEAD – Pilot 2 sieht keinen Fehler.

Die Umbenennung läuft nach der Antwort an Pilot 2 und verzögert den Upload nicht. Fast-Upload (Fingerabdruck) ist unverändert.

## Einrichtung (brix-node, durch den Betreiber)
```bash
cd /srv/stacks/skyhub-next && git pull --ff-only origin main
# 1. Sicherung und Migration 007 (additiv, wiederholbar)
docker compose -p skyhub-next exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t dji_pilot_media_verified' > ~/backups/dji_pilot_media_verified-$(date +%F).sql
docker compose -p skyhub-next exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < backend/db/migrations/007_dji_pilot_media_dji_names.sql
# 2. eigenes MinIO-Konto (Get/Put/Delete nur dji-cloud/<ws>/media/*), Schlüssel landen in .env
bash scripts/minio-pilot-media-renamer.sh apply
# 3. einschalten: SKYHUB_PILOT_MEDIA_DJI_NAMES=true in .env, Backend neu erzeugen (DRC aktiv: begleitet)
bash scripts/brix-compose.sh build backend && bash scripts/brix-compose.sh up -d --force-recreate backend
# 4. vorhandene Dateien: erst Probelauf, dann umbenennen
docker compose -p skyhub-next exec backend node pilot-media-dji-names.js
docker compose -p skyhub-next exec backend node pilot-media-dji-names.js --apply --confirm UMBENENNEN
```
Danach `migration-inventory.json`: `pilot-media-dji-names-007` auf `applied: true`.

## Folgen für andere Dienste
- FlightHub Keyless liest beim nächsten Scan die neuen Namen ein (Herkunft „Pilot-2-Upload“ bleibt).
- Der ACE-Spiegel (`ace-skyhub-sync`, rclone sync) lädt die Dateien einmal unter den neuen Namen neu.

## Zurück
`SKYHUB_PILOT_MEDIA_DJI_NAMES=false` stoppt neue Umbenennungen. Bereits umbenannte Dateien behalten ihren DJI-Namen;
der Originalschlüssel steht in `pilot_object_key`. Konto entfernen: `bash scripts/minio-pilot-media-renamer.sh remove`.
