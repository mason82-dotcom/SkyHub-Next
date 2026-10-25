# SkyHub Next – eigenständige Mediengalerie (25.10.2026)

## Einstieg

Die neue, eigenständige Seite liegt unter `/media-gallery.html` und ist über **Medien** in der Hauptnavigation von Operations, Missionen, Routen, Survey und Smart Farming erreichbar. Sie ist statisch und wird vom bestehenden Backend-`express.static(frontend/public)` ausgeliefert. Kein zusätzlicher Proxy, kein neues Docker-Image oder Container wird durch den Code automatisch bereitgestellt.

**Stand:** Lesende Metadaten-Galerie – **kein Foto-/Video-Downloader und noch keine Miniaturbild-Auslieferung**. Das Backend hat bislang absichtlich keinen authentifizierten, objektidentitätsgeprüften Medien-Payload-Endpunkt. Ein in der Ansicht angezeigtes Symbol ist ein Platzhalter, kein geprüftes Vorschaubild. Die UI enthält keinen Upload, Lösch- oder DJI-Steuerbefehl.

## Zwei getrennte Datenquellen

| Modus | Quelle | Berechtigung | Wichtige Grenze |
| --- | --- | --- | --- |
| Verifizierte Pilot-2-Medien | `GET /api/media-library/v1/workspaces/:workspaceId/assets`, Detail und M3M-Gruppenhinweise | Beide Header **`Authorization: Bearer <SkyHub-View-Token>`** und **`X-Auth-Token: <Workspace-gebundener Pilot-Token>`** | Listenprüfung bezeichnet nur den HEAD bei Registrierung; Detail führt einen **neuen** S3-HEAD-Abgleich aus; kein Pixel-, XMP-/EXIF- oder NDVI-Nachweis |
| MinIO-Objekte | `GET /api/media/status`, `/api/media/buckets`, `/api/media/objects` | SkyHub-View-Token, nur lesend | S3-Auflistung ist weder eine DJI-Herkunftsprüfung noch eine Integritätsbestätigung |

Die verifizierte Bibliothek ist seit 25.10.2026 auf dem Pi mit migrations 003–005 produktiv aktiviert, bislang wurde nur die **leere Liste** verifiziert. Ohne hochgeladene und registrierte Originalmedien ist ein leerer Grid-Zustand richtig. Bei unbekanntem Workspace 404, fehlenden/ungültigen Tokens 401, HTTPS/Scope-Problemen 403, HEAD-Konflikten 409 und Redis-Ratenlimit 429 zeigt die UI getrennte, redigierte Meldungen. Diese Zustände dürfen nicht als erfolgreiches Einlesen angezeigt werden.

Die bestehende `SKYHUB_MEDIA_ENABLED`-S3-API bleibt unverändert. Der S3-Modus zeigt ausschließlich Metadaten; Objektschlüssel können private Dateinamen/Pfade enthalten und sollten nicht in öffentliche Screenshots kopiert werden.

## Galerie-Navigation (lokale Seitenfilter)

Beide Bereiche bieten eine **Sofortsuche nach Namen**, Auswahl nach **Dateiendung** (JPEG/PNG/WebP, TIFF, MP4/MOV, Sonstige) sowie Sortierung nach Name und Objektgröße. Die Kategorie ist eine **unverifizierte Dateinamen-Endung, kein per MIME-Sniffing validierter Medientyp**. Weder die Suche noch das Sortieren lösen S3- oder Pilot-2-HTTP-Abfragen aus; beides wirkt ausschließlich auf die **aktuell geladene Seite** (verifizierte Bibliothek maximal 20 Einträge, S3 maximal 50 Einträge). Nicht geladene Seiten werden explizit nicht als durchsucht dargestellt. Neue Seiten werden weiterhin erst durch eine eigene Benutzeraktion angefordert.

Die zwei getrennten Quellen bleiben strikt getrennt. Keine Bilder, Videos, Rohpixel, Bucket-Objektpfade für die verifizierte Bibliothek oder vorzeitig als überprüft behauptete Medien werden aus der reinen Dateiendung erzeugt. Es gibt weiterhin **keinen Download oder Thumbnail-Endpunkt**. Die Filter-Eingaben bleiben allein im Browser-Dokument; sie werden weder als URL-Parameter an die API gesendet noch in Browser-Storage gespeichert.

## Sicherheitsarchitektur

- Alle Lesevorgänge erfolgen per `GET` und `cache:'no-store'`; die UI stellt keine Kamera-, Flug-, Upload- oder Schreibfunktionen bereit.
- Passwortfelder werden unmittelbar nach der Anmeldung geleert; Tokens bleiben nur im Speicher der geöffneten Seite. Keine Cookies, URL-Parameter für Credentials, `localStorage` oder `sessionStorage`.
- Im normalen Netz akzeptiert die Seite Token-Eingaben ausschließlich über **HTTPS** (Loopback `localhost` für lokale Entwicklung ausgenommen). Die echte HTTPS-Route erfordert weiterhin ein gültig vertrauenswürdiges Zertifikat sowie die korrekte Caddy-Weiterleitung.
- Workspacebindung, Audit, Redis-Limits, HEAD-Recheck und S3-Whitelist verbleiben **serverseitig**, nicht in der UI.
- Das Datenmodell verwirft unbekannte oder gefälschte Erfolgsaussagen und projiziert verifizierte Einträge ausschließlich auf sichere Kartenfelder; Objektschlüssel, Callback-Koordinaten, ETags und Sensor-/Kalibrierungsbehauptungen erscheinen nicht in verifizierten Karten oder Details.
- M3M-Dateinamenhinweise sind nie Bestätigungen von CaptureUUID, Bandregistrierung, Reflektanz, NDVI oder NDRE.
- Seitenweises Laden nur nach Benutzeraktion; pro Anmeldesitzung maximal 20 Seiten, maximal 20 verifizierte oder 50 S3-Objekte pro Seite. Keine rekursiven Bucket-Vollscans.

## Lokale Offline-Prüfung und Rollout-Grenzen

```bash
cd ~/Projekte/SkyHub-Next
node --test backend/test/media-gallery-ui.test.js
node --check frontend/public/media-gallery-controls.js
node --check frontend/public/media-gallery-verified.js
node --check frontend/public/media-gallery-s3.js
```

Diese Tests sind **synthetische Vertrags- und Quelltests**, kein Browser-/Pi-Live-Check. Den laufenden Backend-Container nicht für diese Funktion neu starten, solange DJI-Hardware verbunden ist. Später zuerst getrennt den produktiven Source-Commit, lokalen Container-Inhalt, sichere LAN-HTTPS-Erreichbarkeit und die tatsächliche Caddy-Route nachweisen; danach Browser-Klicktests auf leere Liste, authentifizierte S3-Auflistung, Seitenwechsel und Detail-HEAD durchführen. Ein GitHub-Merge allein ändert das Pi-Image nicht.

**Folgeausbau:** kontrollierter, auditierbarer Medien-Payload-/Thumbnail-Endpunkt mit workspacegebundener Autorisierung und immutable `VersionId`/Checksums sowie begrenzter Byte-Ausgabe – erst nach unabhängigen Sicherheits- und realen Medien-Tests. Keinesfalls private MinIO-Presigned-URLs oder S3-Keys allein durch Frontend-JavaScript zur Anzeige zusammenbauen.
