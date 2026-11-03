# WPML-Missionsbibliothek auf MinIO S3 und DJI-Pilot-2-Waylinebibliothek

**Stand:** 02.11.2026 · Code auf dem Arbeitsbranch, **standardmäßig ausgeschaltet** (`SKYHUB_WPML_STORE_ENABLED=false`, `SKYHUB_PILOT_WAYLINE_ENABLED=false`). Keine Hardware- oder Flugfreigabe; `flightReady` bleibt immer `false`.

## Zweck und Grenze

Der WPML-Missionseditor (`/wpml-editor.html`) kann jetzt

1. **eine WPML-KMZ hochladen** (DJI Pilot 2, FlightHub 2 oder SkyHub-Export), sie lokal im Browser prüfen und als Wegpunktentwurf übernehmen;
2. Entwürfe oder Original-KMZ **in einer MinIO-Missionsbibliothek** (`skyhub-wpml`) ablegen, auflisten und wieder laden;
3. – optional und getrennt aktivierbar – diese Bibliothek **DJI Pilot 2 über die DJI-Cloud-API-Waylineverwaltung** anbieten (Liste + Download).

SkyHub erzeugt dabei **keinen Flugauftrag**: keine `flighttask_prepare`/`flighttask_execute`-Dienste, kein MQTT-Versand. Ob und wann eine Route geflogen wird, entscheidet der Pilot in DJI Pilot 2, das die Mission dort selbst prüft.

## Herstellerreferenz

Maßgeblich ist die DJI-Referenzimplementierung im Repository: `third_party/dji-cloud-api-demo` (Cloud-SDK `com.dji.sdk.cloudapi.wayline.api.IHttpWaylineService`, Beispiel `WaylineFileServiceImpl`, Pilot-Seite `Cloud-API-Demo-Web/src/pages/page-pilot/pilot-home.vue`).

| DJI-Vorgabe | Umsetzung in SkyHub |
| --- | --- |
| `GET wayline/api/v1/workspaces/{workspace_id}/waylines` mit `PaginationData` (`list`, `pagination{page,page_size,total}`), Filter `favorited`, `order_by`, `template_type`, `drone_model_keys`, `payload_model_key`, `key` | `backend/dji-wayline-http.js` |
| `GET …/waylines/{wayline_id}/url` leitet direkt auf die Objekt-URL weiter | 302 auf eine **10 Minuten gültige, vorsignierte** GET-URL (AWS SigV4) am für die RC erreichbaren S3-Endpunkt |
| `GET …/waylines/duplicate-names` muss verfügbar sein; Namen eindeutig | Namen sind bibliotheksweit eindeutig; abweichender Inhalt mit gleichem Namen → HTTP 409 |
| `POST …/upload-callback` (Pilot lädt via STS hoch) | **bewusst abgelehnt** (`code` 310001, kein Erfolg vorgetäuscht): die STS-Richtlinie erlaubt nur Medien, und SkyHub registriert keine Objekte, die es nicht selbst validiert hat |
| `POST/DELETE …/favorites?id=…` | Redis-Set je Workspace |
| `id` ist UUID; `name` ohne `<>:"/\|?*._\` | deterministische RFC-9562-v8-UUID aus dem SHA-256 der Datei; Namensmuster wird serverseitig erzwungen |
| `sign` = MD5-Hex der KMZ; `drone_model_key` `0-<type>-<sub>`, `payload_model_keys` `["1-<type>-<sub>"]`, `template_types` 0–3 | aus der **serverseitig geprüften** `template.kml` abgeleitet, nicht aus Clientangaben |
| Pilot-H5 lädt das JSBridge-Modul `mission` (nach `api`) | `frontend/public/pilot-login.js`, nur wenn der Server `wayline` im Bootstrap meldet |

Authentifizierung der Pilot-Routen wie bei den Medienrouten: HTTPS über den vertrauten Proxy, `x-auth-token` eines für **diesen** Workspace gekoppelten RC bzw. des Operator-Tokens.

## Speicher (`backend/wpml-mission-store.js`)

- Bucket `skyhub-wpml`, Schlüssel `missions/<uuid>.kmz`, `Content-Type: application/vnd.google-earth.kmz`.
- **Write-once:** bedingter Schreibvorgang `If-None-Match: *` (MinIO ≥ 2024); vorhandene Objekte werden nie überschrieben. Gleicher Inhalt → gleiche ID → idempotent. `Content-MD5` sichert die Übertragung.
- Vor jedem Schreiben läuft der vorhandene Offline-Validator (`inspectKmz`): ZIP-/CRC-/Pfadprüfung, WPML-Semantik, Fluggerät/Nutzlast. Ungültig → 422 mit höchstens 25 Pfaden, nichts wird geschrieben.
- Beim Lesen wird der Inhalt erneut gehasht und mit der ID verglichen (Integritätsprüfung, sonst 502).
- **Bestehendes Backend-Konto** (`SKYHUB_S3_ACCESS_KEY`, auf dem Pi der Service-Account „SkyHub Media Reader“) – kein neues Konto, kein neues Secret. Seine Inline-Policy wird um `storage/policies/skyhub-wpml-writer.json` ergänzt: `ListBucket` nur Präfix `missions/`, `GetObject`/`PutObject` nur `skyhub-wpml/missions/*`, **kein Löschen**; alle bisherigen Leserechte bleiben unverändert. Konsequenz: Dieses Konto ist danach nicht mehr rein lesend, sondern darf in genau diesem Präfix schreiben. Ein eigenes Konto bleibt über `SKYHUB_WPML_S3_ACCESS_KEY/SECRET_KEY` möglich; der Pilot-Upload-Schlüssel wird abgelehnt.
- Die Bibliothek ist auf 500 Missionen begrenzt (Pi-Maßstab); die Liste wird 30 s zwischengespeichert und bei jedem Schreiben verworfen.

## Web-API für den Editor (`/api/wpml/missions`, nur mit View-Token)

| Methode | Pfad | Ergebnis |
| --- | --- | --- |
| `GET` | `/api/wpml/missions/status` | `online`, `bucket-missing`, `forbidden` oder `unavailable` |
| `GET` | `/api/wpml/missions?page=&page_size=&key=` | `{list, pagination}` |
| `POST` | `/api/wpml/missions` | Body = KMZ, Header `X-SkyHub-Mission-Name` (URI-kodiert); 201 neu, 200 identisch vorhanden |
| `GET` | `/api/wpml/missions/{id}` | Metadaten |
| `GET` | `/api/wpml/missions/{id}/kmz` | Datei |

**Lokale Routenrevisionen:** Für die automatische, zustimmungspflichtige Übernahme bestehender Browser-Routen und neuer Revisionen in diese MinIO-KMZ-Bibliothek siehe [WPML-Routen-MinIO-Synchronisierung](wpml-route-minio-sync.md). Keine Synchronisierung ohne Zustimmung; keine Server-Löschung oder Flugfreigabe.

**Optionale tokenfreie Heimnetzfreigabe (Default AUS):** Einrichten mit `SKYHUB_WPML_LAN_NO_TOKEN_ENABLED=true`, `SKYHUB_WPML_LAN_ORIGINS=https://rpi5.fritz.box:4443` und `SKYHUB_LAN_VIEW_CIDR=192.168.178.0/24` in `.env`; danach Backend über `bash scripts/pi-update-backend.sh --apply` aktualisieren. Ausschließlich für `/api/wpml/missions` über den HTTPS-Dashboard-Proxy, dessen tatsächliche Client-IP im erlaubten CIDR liegt. Tokenfreie POSTs erfordern einen zur freigegebenen Origin passenden `Origin`-Header und `Sec-Fetch-Site: same-origin`, sofern vom Browser gesendet. Andere Schreib-APIs und DJI-Pilot-2 bleiben geschützt. **Warnung:** Damit können alle Clients im zugelassenen Heimnetz gültige KMZ-Routen ablegen; nur in einem vertrauenswürdigen LAN aktivieren. Rollen-, Fehler- und Bestätigungsvertrag: [UX-Vertrag](../UX-CONTRACT.md#wpml-missionsbibliothek-erste-schreibaktion-der-web-ui).

## Nachvollziehbare Nachfolgeversionen (ab dieser Erweiterung)

- Bestehende Missionen bleiben **unverändert**. Alte Einträge ohne verifizierte Vorgängerreferenz werden als eigenständige Wurzeln angezeigt – selbst wenn Namen ähnlich sind. Insbesondere die historischen Missionen „SkyHub Wegpunktmission“ (2 Wegpunkte) und „SkyHub-Wegpunktmission“ (3 Wegpunkte) werden nicht nachträglich als zusammengehörig behauptet.
- „In Editor laden“ lädt die ausgewählte KMZ unverändert zur lokalen Vorschau. Erst nach ausdrücklichem „In Editor übernehmen“ wird ihre **serverseitig bekannte ID** als Vorgänger einer neu zu speichernden Mission vorgemerkt; ein externer KMZ-Import oder neuer Entwurf besitzt keine solche Referenz.
- Ein erneuter ausdrücklicher Speichervorgang kann optional den Header `X-SkyHub-Parent-Mission-Id: <uuid>` senden. Das Backend verlangt eine **bereits vorhandene** Vorgänger-KMZ mit demselben DJI-Fluggerät und lehnt ungültige, unbekannte, sich selbst referenzierende oder nachträglich veränderte Abstammung ab (HTTP 400/404/409/422).
- Die S3-Objektmetadaten enthalten `parent-id`, `root-id`, `generation`; bestehende Objekte werden **niemals** überschrieben. Eine Ableitung benötigt wegen der DJI-Namenseindeutigkeit einen **neuen Missionsnamen**. Alternative Kinder desselben Vorgängers sind Zweige; die Generation ist daher **keine global eindeutige Revisionsnummer**.
- Der Button „Mit Vorgänger vergleichen“ für verknüpfte Missionen sowie der separate manuelle Vergleich zweier beliebiger vorhandener KMZ-Dateien laden ausschließlich die ausgewählten KMZ-Dateien und vergleichen offline die vom Editor unterstützte Wegpunkt-Teilmenge. Ein manueller Vergleich **belegt keine tatsächliche Versionsabstammung**. Angezeigt werden aggregierte Änderungen (Anzahl der Wegpunkte, Positionen, Höhen, Wegpunktfotos, Flugprofilfelder, Fotointervall). Kein GPS-Inhalt im Vergleichstext, keine Änderung im Editor, keine Flugfreigabe. Bei nicht unterstützten DJI-Aktionen ist die Auswertung ausdrücklich **unvollständig**; fehlende Unterschiede sind keine semantische Gleichheit.
- Der normale DJI-Pilot-2-Wayline-Vertrag bleibt unverändert: weiterhin individuelle unveränderliche Dateien und eindeutige Namen. Die zusätzlichen internen Versionsmetadaten werden nicht als DJI-Flugfreigabe interpretiert.

## KMZ-Upload im Editor (`frontend/public/wpml-kmz-import-core.js`)

Lokal, ohne Server: begrenzter ZIP-Leser (Store/Deflate über `DecompressionStream`, CRC32, max. 12 MiB/32 MiB entpackt, keine verschlüsselten oder Symlink-Einträge), DTD-freier XML-Parser, WPML 1.0.2 und 1.0.6.

Übernommen werden nur Wegpunktvorlagen mit Höhe relativ zum Startpunkt. **Abgelehnt** (mit Begründung): Mapping-/Korridorvorlagen, EGM96/AGL-Höhen, `autoLand`/`gotoFirstWaypoint`, unbekannte Fluggeräte, Lücken in Wegpunktindizes, individuelle Höhen ohne Ellipsoidhöhe. **Aufgelistet und vor dem Übernehmen bestätigt** wird jede verlustbehaftete Änderung, u. a. 1.0.6 → 1.0.2, abweichendes RC-Verlustverhalten, Übergangsgeschwindigkeit, eigene Wegpunktgeschwindigkeiten/-ausrichtung, Gimbal-/Zoom-/Fokusaktionen. „Original in MinIO ablegen“ speichert die **unveränderte** Datei nach Servervalidierung, sodass Pilot-2-Funktionen dort erhalten bleiben.

Weitere Editorfunktionen: Rückgängig (50 Schritte), Richtung umkehren, Wegpunkt mittig einfügen (Ellipsoidhöhe muss gemessen werden, wird nie interpoliert), Exportdateiname aus dem Missionsnamen, Leaflet mit Subresource Integrity.

## Aktivierung auf dem Pi (Reihenfolge)

1. `bash scripts/pi-minio-wpml-store.sh plan` – zeigt Bucket, WPML-Rechte des bestehenden Backend-Kontos und `.env`-Schalter, ändert nichts.
2. `bash scripts/pi-minio-wpml-store.sh apply` – legt den Bucket an (versioniert), sichert die bisherige Policy des Backend-Kontos nach `~/.config/skyhub/minio-backend-policy.before-wpml*.json`, ergänzt die WPML-Rechte und prüft mit dem Backend-Schlüssel selbst: `missions/` lesbar und beschreibbar, Löschen verweigert, `dji-cloud` weiter lesbar. Bei jedem Fehler wird die alte Policy automatisch zurückgesetzt. Danach setzt es `SKYHUB_WPML_STORE_ENABLED=true` (mit `.env`-Sicherung). Mehrfaches Ausführen ist unschädlich.
3. Backend über den geprüften Weg neu erzeugen: `bash scripts/pi-update-backend.sh --apply`; danach `GET /api/wpml/missions/status` mit einem authentifizierten Client → `online`.
4. **Pilot-2-Bibliothek – erst nach erfolgreichem Editor-Test:**
   1. Caddy (root, mit Sicherung, Validierung und automatischer Wiederherstellung): `sudo bash scripts/pi-caddy-pilot-wayline.sh apply`. Leitet `https://rpi5.fritz.box/wayline/api/v1/workspaces/*` ans Backend und erlaubt auf `:9446` aus dem Heimnetz `GET/HEAD /skyhub-wpml/missions/*`. Voraussetzung: `pi-caddy-pilot-media.sh` ist bereits eingerichtet. `bash scripts/pi-caddy-pilot-wayline.sh check` muss danach „JSON vom SkyHub-Backend“ melden.
   2. In `.env` `SKYHUB_PILOT_WAYLINE_ENABLED=true` setzen (genau einmal) und `bash scripts/pi-update-backend.sh --apply`. Der vorsignierte Download läuft über den bestehenden S3-Proxy (`:4002`) der Medien-Synchronisation; er erlaubt dann zusätzlich nur `GET/HEAD` signierter Links auf genau `skyhub-wpml/missions/<uuid>.kmz`. Ohne `SKYHUB_PILOT_MEDIA_UPLOAD_ENABLED=true` gibt es diesen Proxy nicht.
   3. Auf der RC Pro Enterprise Pilot 2 neu mit SkyHub verbinden. Die Diagnose zeigt „Wayline-Bibliothek“ und „Mission-Modul geladen“; in der Pilot-2-Routenbibliothek erscheinen die gespeicherten Missionen.

**Rückweg:** Pilot 2: `SKYHUB_PILOT_WAYLINE_ENABLED=false` + Backend-Update, optional `sudo bash scripts/pi-caddy-pilot-wayline.sh rollback`. Bibliothek: `bash scripts/pi-minio-wpml-store.sh rollback` (stellt die gesicherte Policy wieder her und setzt `SKYHUB_WPML_STORE_ENABLED=false`) bzw. `SKYHUB_PILOT_WAYLINE_ENABLED=false`; danach Backend über denselben Weg neu erzeugen. Bucket und Objekte bleiben erhalten.

## Prüfungen

- `node --test backend/test/wpml-mission-store.test.js backend/test/dji-wayline-http.test.js backend/test/wpml-kmz-import.test.js`
- Gegen eine **isolierte Wegwerf-MinIO** (gleiches Image, tmpfs, nur `127.0.0.1`) am 02.11.2026 geprüft: Skript `plan`/`apply` (zweimal)/`rollback` an einem nachgebildeten Service-Account unter root mit Inline-Leserichtlinie, Richtlinie, Write-once, 409 bei Namenskonflikt, Löschen und fremdes Präfix → 403, vorsignierter Download 200 / manipulierte Signatur 403, Rückimport ohne Abweichung; Chromium-Ende-zu-Ende-Test des Editors (Upload, Übernehmen, Speichern, Liste, Zurückladen, falscher Token → 401, 412 px ohne horizontales Scrollen).
- **Offen:** Test mit echter RC Pro Enterprise + Mavic 3M in Pilot 2 (Liste, Download, Öffnen der Route); dieser Nachweis fehlt und ist Voraussetzung für jeden produktiven Einsatz.
