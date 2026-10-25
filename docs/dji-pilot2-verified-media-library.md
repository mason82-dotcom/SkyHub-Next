# SkyHub Next – Verifizierte DJI-Pilot-2-Medienbibliothek (Read-only)

Stand: 25.10.2026. Runtime-Anbindung vorbereitet, standardmäßig ausgeschaltet. Auf dem Pi ist bislang nur die ältere lesende `/api/media`-S3-API aktiv; das produktive Schema 003–005 fehlt dort. **Kein produktives Deployment dieser Bibliothek.**

## Zweck und Herkunft

Die auf `main` vorhandene Pilot-2-Uploadpipeline liefert **verifizierte Medienobjekte** in `dji_pilot_media_verified`: STS-Berechtigungsumfang, Workspace, Objektname, Dateigröße, ETag, HEAD-Datum und die separat validierte Teilmenge der Pilot-2-Callback-Metadaten. Die neue Bibliothek zeigt ausschließlich solche bestätigten Einträge und verzichtet auf eine zweite XMP-/EXIF-Auswertung.

Die bisherigen M3M-Module `m3m-xmp-markers.js`, `m3m-xmp-capture-groups.js`, `m3m-tiff-ifd.js`, `m3m-media-inventory.js` bleiben maßgeblich. Insbesondere **werden private CaptureUUIDs und rohe DJI-XMP-Metadaten nicht aus dem isolierten Reader herausgereicht**. Die Bibliothek verwendet für einen ausdrücklich als unsicher eingestuften **Dateinamen-Hinweis** nur die bereits vorhandene, aggregierende `inventoryMediaNames`-Funktion.

DJI belegt die CaptureUUID-v4-Gruppierung, EXIF/GPS/RTK-Daten und separaten RGB-/G-/R-/RE-/NIR-Aufnahmen im offiziellen `Mavic_3M_Image_Processing_Guide_EN.pdf`: https://dl.djicdn.com/downloads/DJI_Mavic_3_Enterprise/20230829/Mavic_3M_Image_Processing_Guide_EN.pdf . Dateinamensgruppen **ersetzen keine** XMP-CaptureUUID-Gleichheit, Kamerakalibrierung oder Bandregistrierung.

## Neue Dateien

- `backend/db/migrations/005_dji_pilot_media_library.sql`: additive `asset_id UUID DEFAULT gen_random_uuid()`, workspace-gebundene Unique- und Keyset-Pagination-Indizes, ein gruppenorientierter Index sowie `dji_pilot_media_library_audit` mit append-only SQL-Triggern aus Migration 004. Bestehende Medien- und MinIO-Daten werden nicht gelöscht.
- `backend/pilot-media-library.js`: read-only PostgreSQL-Projektion mit signiertem, **workspace-gebundenem** Cursor (HMAC-SHA256, Geheimnis nur via Dependency Injection, mindestens 32 Byte), `limit` 1–100 und geordneter Pagination auf dem **vollständigen PostgreSQL-Mikrosekunden-Zeitstempel** plus `asset_id`. Der Cursor enthält keine Dateinamen, Objektpfade, Drohnen-SN, Tokens oder XMP-CaptureUUIDs.
- `backend/pilot-media-library-http.js`: Express-GET-Router-Fabrik mit exakter Workspace-Bindung, HTTPS-Pflicht, tokengeprüftem Principal mit `operator` oder `pilot` für denselben Workspace, zwingender Ratenbegrenzung, SQL-Audit und redigierten DJI-Antworthüllen. Der derzeitige Pilot-Authenticator stellt nur Pilot-Principals aus; eine Operator-Identität braucht eine gesonderte Freigabe.
- `backend/pilot-media-rate-limit.js`: erweitert den vorhandenen Redis-Limiter um `library_list`, `library_detail`, `library_m3m_group`. **Nur** diese drei Leseaktionen erlauben Operator-Principals; eine Operator-Rolle darf weiterhin keine Pilot-2-Upload-Callbacks schreiben.
- `backend/pilot-media-library-runtime.js`: bindet die GET-Routen nur bei `SKYHUB_MEDIA_LIBRARY_ENABLED=true` ein. Erfordert aktivierte S3-Reader-API, Pilot-Workspace, Datenbank, Redis und ein eigenes 32-Byte-Cursor-Geheimnis als 64 Hex-Zeichen. Der S3-HEAD verwendet dasselbe Reader-Konto wie `/api/media`; es gibt keinen Objekt-Download.

## API (vorbereitet, nicht produktiv freigeschaltet)

| GET-Pfad | Abgesicherte Antwort |
|---|---|
| `/api/media-library/v1/workspaces/:workspaceId/assets?limit=30&cursor=<signed>` | Begrenzte Liste bereits verifizierter Medien; nächste Seite nur mit gültigem HMAC-Cursor desselben Workspaces |
| `/api/media-library/v1/workspaces/:workspaceId/assets/:assetId` | Metadatendetail nur, wenn ein **neues** serverseitiges S3-`HeadObject` exakt zu gespeicherter Dateigröße, ETag und `LastModified` passt; andernfalls 409 oder 404, **keine** behauptete fortdauernde Integrität |
| `/api/media-library/v1/workspaces/:workspaceId/groups/:groupId/m3m-hints` | Bounded max. 5000 verifizierte Namen aus demselben Workspace und derselben DJI-Dateigruppe; pro STS-Uploadsession getrennte Aggregation, um gleiche DJI-Dateinamen aus verschiedenen Flügen nicht versehentlich zusammenzuführen |

Der Detailendpunkt kann den gespeicherten S3-Objektschlüssel innerhalb des authentifizierten Workspaces ausgeben; **keine** Presigned URL, kein direkter MinIO-Proxy, kein Medien-Payload und keine Schreibfunktion. Die Listenansicht unterdrückt den Objektschlüssel und zeigt nur die interne Asset-UUID.

Die Metadatenansicht enthält **nur** DJI-Pilot-2-Callbackfelder (`absolute_altitude`, `relative_altitude`, `gimbal_yaw_degree`, `created_time`, `shoot_position`, sofern vorhanden und valide). Das Format kennzeichnet die Quelle ausdrücklich als `pilot-upload-callback`. Sie ist **kein** EXIF-/XMP-Originaldatensatz; `exif`, `xmp`, `rtk` sind `not-extracted`, die Aussagen zu Kalibrierung/Reflexion/NDVI/NDRE sind immer `false`. Andere JSONB-Felder werden nicht an den Client ausgegeben.

Der M3M-Report enthält nur Zähler und `classification: filename-hints-only`. Keine Dateinamen, XMP-CaptureUUIDs oder Capture-Zeitstempel werden aus dem Gruppenreport ausgegeben. Er weist mögliche vier Spektralbänder nur durch Namen aus und behauptet weder vollständige Spektralbilder noch ein messbereites Pflanzenindex-Ergebnis.

## Sicherheit und Tests

- **Keine** Migration beim Programmstart. Der HTTP-Mount ist ausschließlich bei explizitem Flag und vollständiger Startkonfiguration aktiv. Kein Pi-Deployment der Bibliothek.
- Zusätzlich zum bestehenden View-Bearer-Token verlangt der Bibliotheksrouter einen workspace-gebundenen Pilot-Token in `X-Auth-Token`; HTTP ohne vertrauenswürdige HTTPS-Proxy-Kennzeichnung wird abgelehnt. Zugangsdaten niemals in geteilten Logs oder URL-Parametern ausgeben.
- Pro Lesevorgang Redis-Limit und append-only Audit (Workspace, Aktion, Ergebnis); bei Audit-/Redis-/Storage-Fehler keine erfolgreiche Antwort.
- Neue Unit-Tests `backend/test/pilot-media-library.test.js` und `backend/test/pilot-media-library-http.test.js` für HMAC-Tampering, Sessiontrennung, Metadaten-Whitelist, Sicherheitsflags, HEAD-Recheck, Auth, Rollen, Fehlerredaktion und GET-API.
- `backend/test/pilot-media-library.integration.test.js` gegen ausschließlich `skyhub_test` auf Loopback mit migrations 003/004/005 im eigenen PostgreSQL-Schema und **vollständigem Transaktions-Rollback**. Speziell geprüft: Keyset-Cursor mit zwei Einträgen **innerhalb derselben Millisekunde** sowie SQL-Audit-Unveränderlichkeit.

## Offene technische Grenzen

1. Noch kein EXIF-/XMP-Werte-Extractor mit separater Privacy- und Quellen-Freigabe – die bisherige M3M-Probe gibt nur Metadatenmarker und Gruppenzähler aus, was nicht überschrieben wird.
2. Kein RTK-Qualitätsnachweis, keine photogrammetrische Bildzuordnung und keine sensor-kalibrierte NDVI-/NDRE-Verarbeitung.
3. HEAD+ETag ist kein durchgehender kryptographischer Integritätsbeweis. Zwischen Detail-HEAD und späterem Download kann das Objekt wechseln; echte `VersionId`-/Checksum-Prüfung und kontrollierter Zugriff sind getrennt zu entwickeln.
4. Für die spätere Frontend-Freigabe müssen echte Pilot-/Operator-Authentifizierung, Ratenbegrenzung, Migration-Rollback, TLS-Proxy, S3-Read-Rechte und eine explizite Pi-Abnahme verbunden werden.

## Pi-Rollout: Reihenfolge und Freigabepunkte

1. Den bereits bewiesenen `/api/media`-Leseweg beibehalten. Das produktive PostgreSQL-Schema der Pilot-Medienfamilie auf Vorhandensein und Eigentümer prüfen. Die drei SQL-Dateien anhand des Migrationsregisters einzeln auswählen; **niemals** alle numerisch sortierten Dateien des Verzeichnisses anwenden (der WPML-Draft verwendet ebenfalls `003`).
2. `scripts/pi-migration-rehearsal.sh` auf einem aktuellen Prüf-Checkout mit genau `003_dji_pilot_media_verified.sql`, `004_dji_pilot_media_http.sql` und `005_dji_pilot_media_library.sql` ausführen. Der Probelauf stellt einen Dump in einem Wegwerf-Container wieder her und führt SQL dort zweimal aus. Ergebnis, Platzbedarf, Backup und tatsächlichen Restore vor produktiver DDL prüfen. Das Skript wendet **keine** SQL-Datei in Produktion an.
3. Nach einem getrennten produktiven Migrationsplan und Wiederherstellungsnachweis die Familie in einer festgelegten Reihenfolge auf der Pi-Datenbank anwenden. Erst danach das aktuelle Backend-Image bauen und kontrolliert ersetzen. `SKYHUB_MEDIA_LIBRARY_ENABLED` bleibt beim ersten Image-Update `false`.
4. Für die Aktivierung ein unabhängiges Cursor-Geheimnis mit `openssl rand -hex 32` privat in der lokalen `.env` hinterlegen, den Schlüssel genau einmal setzen und das Flag auf `true` ändern. Die effektive Compose-Konfiguration, die externe Netzzuordnung und den HTTPS-Proxy prüfen, bevor ausschließlich das Backend neu angelegt wird. Zwei authentifizierte Header sind erforderlich. Eine leere Liste nach erfolgreichem Schema-Rollout ist erwartbar, solange der STS-Issuer und Pilot-Uploadpfad nicht produktiv aktiviert wurden.
