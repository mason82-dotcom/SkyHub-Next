# DJI-Medienverwaltung (Pilot 2 → Cloud): Vertragsbaustein

Stand: 22.10.2026. **Nicht mit DJI Pilot 2 verbunden. Keine Route, kein Speicherzugriff, keine Ausgabe von Zugangsdaten.**

Quellen (englische DJI-Webreferenz, am 22.10.2026 ausgelesen; die Seite nennt keine Cloud-API-Version):
`feature-set/pilot-feature-set/pilot-media-management` sowie
`api-reference/pilot-to-cloud/https/media-management/` (`fast-upload`,
`obtain-exited-tiny-fingerprint`, `obtain-temporary-credential`,
`mediafile-upload-result-report`, `group-upload-callback`).

## Ablauf laut DJI

1. Die Login-Seite setzt den Workspace, lädt das `api`-Modul (Host und Token, DJI sendet den Header `X-Auth-Token`) und danach das Medien-Modul.
2. Vor einem Upload fragt Pilot 2 per `tiny-fingerprints` und `fast-upload`, ob eine Datei schon existiert.
3. Fehlt sie, holt Pilot 2 pro Upload **temporäre Speicher-Zugangsdaten** (`sts`) und lädt direkt in den Objektspeicher (Anbieter `ali`, `aws` oder `minio`).
4. Danach meldet Pilot 2 das Ergebnis pro Datei (`upload-callback`) und pro Dateigruppe (`group-upload-callback`).

| Endpunkt | Zweck | Antwort-Daten |
|---|---|---|
| `POST /media/api/v1/workspaces/{id}/files/tiny-fingerprints` | welche der gesendeten Kurz-Fingerabdrücke existieren | `tiny_fingerprints[]` |
| `POST /media/api/v1/workspaces/{id}/fast-upload` | existiert die Datei (`fingerprint`)? | `{}` |
| `POST /storage/api/v1/workspaces/{id}/sts` | temporäre Zugangsdaten | `bucket`, `credentials`, `endpoint`, `object_key_prefix`, `provider`, `region` |
| `POST /media/api/v1/workspaces/{id}/upload-callback` | Ergebnis je Datei | `object_key` |
| `POST /media/api/v1/workspaces/{id}/group-upload-callback` | Ergebnis je Dateigruppe | `{}` |

Alle Antworten haben die DJI-Hülle `{code, message, data}`; `code` 0 bedeutet Erfolg.

## Umgesetzt: `backend/media-upload-contract.js`

Reine Funktionen ohne Netzwerk-, Datei-, Datenbank- oder Umgebungszugriff; `server.js` importiert sie nicht (Test `media-upload-contract.test.js` stellt das sicher).

- **Eingaben prüfen und normalisieren:** `parseTinyFingerprintRequest` (höchstens 500 eindeutige Einträge, Zeichen `A–Z a–z 0–9 _ . -`), `parseFastUploadRequest`, `parseUploadCallback`, `parseGroupUploadCallback`. Ungültiges ergibt `null`, nie eine Teilantwort.
- **Pfade und Schlüssel:** relative Pfade ohne `..`, `.`, leere Segmente, Backslash, führenden Schlüsselstrich und Steuerzeichen. `objectKeyUnderPrefix` prüft, dass ein gemeldeter `object_key` unter dem ausgegebenen Präfix liegt.
- **Position:** `shoot_position` wird auf WGS84-Grenzen geprüft; `0/0` gilt (wie bei der Telemetrie) als „keine Position“ und wird nicht übernommen.
- **Antworten:** `okEnvelope`, `errorEnvelope`, `tinyFingerprintResponse`, `uploadCallbackResponse`.
- **`stsResponse` als Sperre für spätere Anbieter:** nimmt nur kurzlebige Zugangsdaten an (`securityToken` Pflicht, `expire` 1–3600 s), nur `https`-Endpunkte ohne Benutzerdaten, nur die Anbieter `ali`, `aws`, `minio`, und der Objektschlüssel-Präfix muss den Workspace als Pfadsegment enthalten. Statische oder zu langlebige Schlüssel führen zu einem Fehler statt zu einer Antwort.

## Abweichungen und Unklarheiten der DJI-Seite

- Das Feld heißt in der Referenz `tinny_fingerprint` (sic) und wird so übernommen.
- `shoot_position.lat/lng` und `relative_altitude` sind dort als `integer` beschrieben; Koordinaten und Höhen werden hier als endliche Zahlen akzeptiert, weil Ganzzahlen für Koordinaten nicht plausibel sind. Gegen echte Pilot-2-Nachrichten **nicht** geprüft.
- Das Format des Kurz-Fingerabdrucks ist nur durch ein Beispiel belegt (`<hex>_<Datum>`); SkyHub prüft nur Zeichensatz und Länge.
- Die Schemanamen auf der Gruppen-Seite (`FolderUploadCallbackInput` und `MissionFinishCallBackInput`) widersprechen sich; maßgeblich sind die Felder `file_group_id`, `file_count`, `file_uploaded_count`.
- Beim Gruppen-Callback ist `file_group_id` laut Tabelle optional; sie wird auch optional akzeptiert.

## Bewusst nicht umgesetzt

- **Keine Routen, kein Laden der Module in der Login-Seite.** Das Medien-Modul braucht das `api`-Modul und damit eine Zusage, dass Pilot 2 gegen SkyHub schreibt.
- **Keine STS-Ausgabe.** Pilot 2 würde **Schreibrechte** auf den Objektspeicher erhalten. Dafür fehlen: ein MinIO-Benutzer oder -Zweck mit einer auf Präfix und `PutObject` beschränkten Richtlinie, ein AssumeRole-Aufruf mit begrenzter Laufzeit, und Geheimnisse in der `.env`. Das sind Änderungen an MinIO und an den Geheimnissen, die nach den Betriebsregeln nur über geprüfte Skripte mit Rollback laufen.
- **Kein Speicher** für Fingerabdrücke, Upload-Ergebnisse und Dateigruppen. Die vorhandene Medien-API (`backend/media-api.js`) bleibt rein lesend.

## Vor einer Verdrahtung erforderlich

1. Entscheidung, ob Pilot 2 in den Bucket `dji-cloud` oder in einen eigenen Upload-Bucket schreiben darf.
2. Eigene MinIO-Richtlinie (nur `PutObject` unter `<workspace>/…`, kein `GetObject`, `DeleteObject` oder `ListBucket`) und Test, dass `DELETE` und fremde Präfixe verweigert werden.
3. Migration für Fingerabdrücke und Upload-Ergebnisse (workspace-gebunden, mit Audit), zuerst als Entwurf und mit isoliertem Datenbanktest.
4. Autorisierung über den bestehenden Workspace-Principal (`X-Auth-Token` = Kopplungstoken), HTTPS-Pflicht, Größen- und Ratenlimits, Feature-Flag (Standard `false`).
5. Laden von `api`- und Medien-Modul erst nach Hardwareabnahme mit einer Test-SD-Karte und einem Wegwerf-Bucket.
