# SkyHub Next – Mediengalerie (31.10.2026)

## Stand

`/media-gallery.html` zeigt den **kompletten Bestand** des MinIO-Speichers (`basemaps`, `dji-cloud`, `farming`, `mapping-results`, `pv-inspections`), also 14.639 Objekte und ca. 31 GB am 31.10.2026, mit:

- Gesamtübersicht (Dateien, Speicher, Fotos, Videos, TIFF, Sonstige) und Speicherbereich-Auswahl mit Zählern
- Ordneransicht mit Pfadnavigation (Ordnerkarten mit Titelbild, Datei-/Foto-/Videozahl, Größe) oder flacher Liste „Alle Dateien“
- Suche über den **gesamten** Speicherbereich (mehrere Wörter, Pfad oder Datum wie `20261002`), Filter nach Typ, Sortierung nach Aufnahmezeit, Name oder Größe
- Vorschaubildern: aus dem EXIF-Thumbnail der DJI-JPEGs (nur die ersten 256 KB werden gelesen, serverseitig gecacht), PNG/WebP direkt, Videos mit erstem Frame
- Betrachter (Pfeiltasten ←/→, Esc) für Originalfotos, Videos (mit Spulen über HTTP-Range) und Textdateien (JSON/GeoJSON/MRK …), Metadaten (Pfad, Größe, Aufnahme- und Uploadzeit, Kamera-/Bandhinweis aus dem DJI-Dateinamen), Download- und Öffnen-Knopf
- URL-Zustand (`#b=dji-cloud&p=wayline/`) für Zurück/Vor und Links
- Pilot-2-Uploads (gespeichert als `org_<Fingerprint>_<ms>.jpg`) erscheinen mit ihrem **DJI-Dateinamen** aus `dji_pilot_media_verified`; die Suche findet beide Namen (seit 31.10.2026)
- **Missionsanalyse** für `.kmz` im Betrachter (`/api/media/mission`): WPML 1.0.2 und 1.0.6 (nur Analyse), Drohne/Kamera laut Datei inkl. Warnung bei unpassender Kombination (z. B. Matrice 4E mit M4T-Kamera), Typ, Wegpunkte, Fehler/Warnungen

**Keine Token- oder Passwortabfrage** mehr: Im Heimnetz (`SKYHUB_LAN_VIEW_CIDR`, Caddy `:4443` lässt ohnehin nur 192.168.178.0/24 durch) sind alle lesenden Medienaufrufe ohne Anmeldung erlaubt. Gleiches gilt für Dashboard (`/`) und Smart-Farming-Katalog. Ohne Heimnetz-Absender antwortet die API weiterhin mit 401; Pilot-Admin, DR-Berichte und Diagnosen bleiben tokengeschützt. Die Pilot-2-Seite auf der RC koppelt nur noch über den Kopplungscode (das manuelle Tokenfeld ist entfernt).

## API (nur GET, Heimnetz oder View-Token)

| Pfad | Inhalt |
| --- | --- |
| `/api/media/summary` | Je Bucket: Objekte, Bytes, Typzähler, letzte Änderung (vollständiger Scan, 2 min gecacht) |
| `/api/media/index?bucket=` | Alle Objekte eines Buckets (`key`, `size`, `lastModified`) in einer Antwort |
| `/api/media/file?bucket=&key=[&download=1]` | Objektinhalt; Bilder/Videos/PDF inline, sonst Download; `Range` wird an MinIO durchgereicht; `CSP: sandbox` |
| `/api/media/thumb?bucket=&key=` | EXIF-Vorschaubild eines JPEG (160×120), sonst 404 → Browser nutzt Original oder Symbol |
| `/api/media/objects?…&delimiter=/` | Seitenweise Liste wie bisher, optional mit Ordnern (`folders`) |

Bucket-Whitelist und Schlüsselprüfung bleiben in `backend/s3-storage.js`; es gibt keine schreibenden Medienendpunkte.

## Prüfung

```bash
cd ~/Projekte/SkyHub-Next/backend && npm test
node --test ../frontend/test/smart-farming-ui.test.js
```

Wirksam wird die Galerie erst nach einem Backend-Update (`bash scripts/pi-update-backend.sh`), das das Frontend ins Image kopiert. Das Update startet den Backend-Container neu und trennt kurz aktive DJI-/MQTT-Sitzungen.

---

## Historie: Metadaten-Galerie vom 25.10.2026 (ersetzt)

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

## Raspberry-Pi-Image-Build: Dateirechte (25.10.2026)

Beim isolierten Pi-Kandidaten `skyhub-next-backend:maps-media-candidate` lagen `/app/backend/map-page-referrer.js` und die neuen Medien-Skripte zwar im Image, aber `node --check` als der vorgesehene Docker-Benutzer `node` endete mit **EACCES**. Der vorangestellte `test -f` prüft nur Existenz und war daher kein ausreichender Nachweis. Der Betreiber hat das Image nicht als laufenden Backend-Container bestätigt; die HTTP-Seiten im alten Container lieferten für die WPML-Karten weiter `Referrer-Policy: no-referrer` und für die Galerie `404`.

Das Backend-Dockerfile normalisiert daher die **Lese-/Traverse-Rechte** der kopierten Quellen nach sämtlichen `COPY`-Schritten und vor `USER node`, ohne Dateien schreibbar zu machen. Die CI simuliert restriktive `0600`-Modi von Pi-Quelldateien **vor** dem Build und führt `node --check` mit dem nichtprivilegierten Benutzer **im gebauten Image ohne Netzwerk** aus.

Vor einer produktiven Umschaltung ausschließlich das separate Kandidaten-Image neu bauen und dessen Readability-Check unter `--network none` erneut ausführen. **Weder `git pull` noch Docker-Build allein sind ein Deployment.** Der Backend-Tausch unterbricht aktive DJI-/MQTT-Sitzungen und ist unabhängig vom CI-Erfolg nur in einem explizit abgestimmten Wartungsfenster vorgesehen. Ein Image mit `EACCES` niemals produktiv aktivieren. Für die Galerie ist keine Datei `media-gallery.js` vorgesehen: Die Seite lädt bewusst `media-gallery-verified.js` und `media-gallery-s3.js` samt Modellen.

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
