# SkyHub Next – Verifizierte DJI-Pilot-2-Medienbibliothek (Read-only)

Stand: 25.10.2026. Isolierter Baustein auf aktuellem `main`. **Kein produktives Deployment und keine Änderungen am Raspberry Pi.**

## Zweck und Herkunft

Die auf `main` vorhandene Pilot-2-Uploadpipeline liefert **verifizierte Medienobjekte** in `dji_pilot_media_verified`: STS-Berechtigungsumfang, Workspace, Objektname, Dateigröße, ETag, HEAD-Datum und die separat validierte Teilmenge der Pilot-2-Callback-Metadaten. Die neue Bibliothek zeigt ausschließlich solche bestätigten Einträge und verzichtet auf eine zweite XMP-/EXIF-Auswertung.

Die bisherigen M3M-Module `m3m-xmp-markers.js`, `m3m-xmp-capture-groups.js`, `m3m-tiff-ifd.js`, `m3m-media-inventory.js` bleiben maßgeblich. Insbesondere **werden private CaptureUUIDs und rohe DJI-XMP-Metadaten nicht aus dem isolierten Reader herausgereicht**. Die Bibliothek verwendet für einen ausdrücklich als unsicher eingestuften **Dateinamen-Hinweis** nur die bereits vorhandene, aggregierende `inventoryMediaNames`-Funktion.

DJI belegt die CaptureUUID-v4-Gruppierung, EXIF/GPS/RTK-Daten und separaten RGB-/G-/R-/RE-/NIR-Aufnahmen im offiziellen `Mavic_3M_Image_Processing_Guide_EN.pdf`: https://dl.djicdn.com/downloads/DJI_Mavic_3_Enterprise/20230829/Mavic_3M_Image_Processing_Guide_EN.pdf . Dateinamensgruppen **ersetzen keine** XMP-CaptureUUID-Gleichheit, Kamerakalibrierung oder Bandregistrierung.

## Neue Dateien

- `backend/db/migrations/005_dji_pilot_media_library.sql`: additive `asset_id UUID DEFAULT gen_random_uuid()`, workspace-gebundene Unique- und Keyset-Pagination-Indizes, ein gruppenorientierter Index sowie `dji_pilot_media_library_audit` mit append-only SQL-Triggern aus Migration 004. Bestehende Medien- und MinIO-Daten werden nicht gelöscht.
- `backend/pilot-media-library.js`: read-only PostgreSQL-Projektion mit signiertem, **workspace-gebundenem** Cursor (HMAC-SHA256, Geheimnis nur via Dependency Injection, mindestens 32 Byte), `limit` 1–100 und geordneter Pagination auf dem **vollständigen PostgreSQL-Mikrosekunden-Zeitstempel** plus `asset_id`. Der Cursor enthält keine Dateinamen, Objektpfade, Drohnen-SN, Tokens oder XMP-CaptureUUIDs.
- `backend/pilot-media-library-http.js`: eigenständige, noch **nicht** in `server.js` eingebundene Express-GET-Router-Fabrik. Exakte Workspace-Bindung, HTTPS-Pflicht, tokengeprüfter Principal mit `operator` oder `pilot` für denselben Workspace, zwingende Ratenbegrenzung, SQL-Audit und redigierte DJI-Antworthüllen.
- `backend/pilot-media-rate-limit.js`: erweitert den vorhandenen Redis-Limiter um `library_list`, `library_detail`, `library_m3m_group`. **Nur** diese drei Leseaktionen erlauben Operator-Principals; eine Operator-Rolle darf weiterhin keine Pilot-2-Upload-Callbacks schreiben.

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

- **Keine** Migration beim Programmstart, kein HTTP-Mount in `server.js`, keine Redis/MinIO-Veränderung und kein Pi-Deployment.
- Pro Lesevorgang Redis-Limit und append-only Audit (Workspace, Aktion, Ergebnis); bei Audit-/Redis-/Storage-Fehler keine erfolgreiche Antwort.
- Neue Unit-Tests `backend/test/pilot-media-library.test.js` und `backend/test/pilot-media-library-http.test.js` für HMAC-Tampering, Sessiontrennung, Metadaten-Whitelist, Sicherheitsflags, HEAD-Recheck, Auth, Rollen, Fehlerredaktion und GET-API.
- `backend/test/pilot-media-library.integration.test.js` gegen ausschließlich `skyhub_test` auf Loopback mit migrations 003/004/005 im eigenen PostgreSQL-Schema und **vollständigem Transaktions-Rollback**. Speziell geprüft: Keyset-Cursor mit zwei Einträgen **innerhalb derselben Millisekunde** sowie SQL-Audit-Unveränderlichkeit.

## Offene technische Grenzen

1. Noch kein EXIF-/XMP-Werte-Extractor mit separater Privacy- und Quellen-Freigabe – die bisherige M3M-Probe gibt nur Metadatenmarker und Gruppenzähler aus, was nicht überschrieben wird.
2. Kein RTK-Qualitätsnachweis, keine photogrammetrische Bildzuordnung und keine sensor-kalibrierte NDVI-/NDRE-Verarbeitung.
3. HEAD+ETag ist kein durchgehender kryptographischer Integritätsbeweis. Zwischen Detail-HEAD und späterem Download kann das Objekt wechseln; echte `VersionId`-/Checksum-Prüfung und kontrollierter Zugriff sind getrennt zu entwickeln.
4. Für die spätere Frontend-Freigabe müssen echte Pilot-/Operator-Authentifizierung, Ratenbegrenzung, Migration-Rollback, TLS-Proxy, S3-Read-Rechte und eine explizite Pi-Abnahme verbunden werden.
