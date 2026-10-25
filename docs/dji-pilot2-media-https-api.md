# DJI Pilot 2 – isolierte HTTPS-Medienendpunkte

Stand: 25.10.2026. Isolierter Baustein auf der verifizierten PostgreSQL-Basis. **Kein Deployment, keine Änderung der produktiven Pi-Dienste.**

## Umfang und Authentifizierung

`backend/pilot-media-http.js` exportiert `createPilotMediaHandlers` und `createPilotMediaRouter` als isolierte Express-Implementierung der folgenden DJI-Pilot-2-HTTPS-API:

| POST-Pfad | Verhalten | Erfolgsantwort |
|---|---|---|
| `/media/api/v1/workspaces/:workspaceId/files/tiny-fingerprints` | Nur HEAD-bestätigte Datensätze des autorisierten Workspaces abfragen | `{code:0,message:'success',data:{tiny_fingerprints:[...]}}` |
| `/media/api/v1/workspaces/:workspaceId/fast-upload` | Nur bereits bestätigten Fingerprint als vorhanden behandeln | `{code:0,message:'success',data:{}}` |
| `/media/api/v1/workspaces/:workspaceId/upload-callback` | Callback validieren, STS-Präfix prüfen und Objekt serverseitig mit `HeadObject` belegen, bevor der Datensatz persistiert wird | `{code:0,message:'success',data:{object_key:'...'}}` |
| `/media/api/v1/workspaces/:workspaceId/group-upload-callback` | Meldung nur speichern, wenn die per Gruppe gemeldeten erfolgreichen Dateien bereits einzeln in derselben Workspace-Datenbank verifiziert sind | `{code:0,message:'success',data:{}}` |

Für jeden Request werden `req.secure === true`, exakt die konfigurierte Workspace-UUID, ein einzelner `X-Auth-Token`, der injizierte bestehende `pilotAuth.principal` mit `role:'pilot'` und identischem Workspace geprüft. Es gibt keinen Fallback auf einfachen Boolean-Zugriff oder vom Client vorgegebene Rollen. Der Caller muss **alle** Funktionen `authorize`, `allowRequest`, `audit`, `store`, `groups`, `headObject`, `transaction` injizieren; sonst startet der isolierte Router nicht.

`express.json({limit:'96kb',strict:true})` beschränkt JSON-Anfragen. Query-Parameter sind gesperrt. Serverseitige Ausnahmen und defekte JSON-Anfragen liefern ausschließlich redigierte DJI-Antworthüllen, keine Tokens, SQL-Ausdrücke, Seriennummern oder Credential-Daten. `Cache-Control: no-store` ist für erfolgreiche und fehlerhafte Ausgaben gesetzt.

**Wichtige DJI-Kompatibilitätsgrenze:** Die aktuelle DJI-Webreferenz gibt für `fast-upload` nur die erfolgreiche, leere `data`-Hülle wieder, aber keinen eindeutigen Fehlstatus für noch nicht gespeicherte Dateien an. SkyHub liefert in diesem isolierten Staging-Baustein für nicht vorhandene Fingerprints `404` mit nicht-null Fehlercode, statt einen Upload fälschlich als bereits erfolgreich auszugeben. Exakte Interpretation durch die eingesetzte Pilot-2-Version muss am RC getestet werden, **bevor die Medienbibliothek aktiviert wird**.

## Deduplizierung und Mediengruppen

`backend/pilot-media-groups.js` verwendet die Migration `backend/db/migrations/004_dji_pilot_media_http.sql`. Ein `group-upload-callback` mit `file_group_id`, `file_count` und `file_uploaded_count` wird nur mittels eines atomaren `INSERT ... SELECT ... HAVING count(*) = $uploaded` aus der Tabelle der **einzeln verifizierten** Medien protokolliert. Der Gruppenzähler ist ein Bericht über bereits nachgewiesene Erfolgsdateien, **kein** Nachweis, dass eine komplette Flugmission erfolgreich war. Identische Wiederholungen sind idempotent, widersprüchliche gemeldete Zahlen führen zu Konflikt. Gruppen ohne ID oder mit null bestätigten Dateien werden noch nicht automatisch als vollständig anerkannt, auch wenn DJI optionale Gruppennamen dokumentiert. Diese strengere Entscheidung benötigt Hardwarevalidierung.

## Ratenbegrenzung und Audit

`backend/pilot-media-rate-limit.js` enthält einen atomaren, fail-closed Redis-Lua-Limiter mit Workspace-/Aktionsfenstern. Standardwerte pro 60 Sekunden: 60 Kurzfingerprint-Abfragen, 120 Fast-Upload-Abfragen, 120 Datei-Callbacks und 30 Gruppen-Callbacks. Er benötigt `redis.status === 'ready'`, speichert **keine Tokens, Geräte-IDs oder Dateinamen** und ist derzeit bewusst nicht in den Pi-Dienst importiert.

`backend/pilot-media-http-audit.js` schreibt ausschließlich `workspace_id`, `operation`, `outcome` und einen serverseitigen Zeitstempel in `dji_pilot_media_http_audit`. SQL-Trigger verweigern Änderungen, Löschungen und TRUNCATE dieser Audit-Historie. Keine Dateipfade, Pilot-Credentials, Objekt-ETags, Fingerprints oder IP-Adressen werden in diesem Audit persistiert. Schreibende Callbacks und Audit laufen über `createPilotMediaMutationTransaction` auf demselben PostgreSQL-Client. Bei Audit-Fehler rollt die Medienänderung zurück und der Router antwortet mit 503. Der injizierte `transaction`-Adapter muss Store, Gruppen und Audit an diesen Client binden; Mock-Adapter sind nur für Tests geeignet. Lesende Fingerprint-Abfragen werden weiterhin separat auditiert.

## Freigabegrenzen

- `backend/server.js`, `pilot-routes.js`, Pilot-2-Webview, Caddy, EMQX, Docker Compose und Pi-Datenbank sind **unverändert**; die neuen Routen sind nicht produktiv gemountet.
- Die STS-Ausstellung bleibt separat deaktiviert; `createRegisteredStsIssuer` aus `backend/pilot-media-store.js` muss beim späteren Mount explizit eingesetzt werden, damit ausgestellte Credentials erst nach dauerhaft gespeicherter Scope-Zuordnung die RC erreichen.
- Ein HEAD/ETag ist keine kryptografische Datei-Verifikation; `fast-upload` und Gruppen-Reports greifen auf bestätigte Datenbankeinträge zurück und prüfen nicht vor jeder Auskunft erneut den aktuellen S3-Stand.
- Es fehlen noch eine Versions-/TLS-/IAM-Abnahme auf dem Pi, die abschließende DJI-Pilot-2-Hardwareprüfung, produktive Reconciliation/Re-HEAD nach längerer Zeit, Multipart- und M3M-Metadatenanalyse sowie die bewusste Aktivierung der `api`- und `media`-Module in Pilot 2.

## Tests

- `node --test backend/test/pilot-media-http.test.js backend/test/pilot-media-groups.test.js backend/test/pilot-media-rate-limit.test.js`: Requests, Auth, Rollen, Limiter, Audit, JSON-Format, Vertraulichkeit und Fake-Storage.
- `backend/test/pilot-media-http.integration.test.js`: echter PostgreSQL-Test mit 003+004-Migration in `skyhub_test`; gegen Fremdworkspace, abweichende Gruppenzähler sowie SQL-Audit-Manipulation; alle Schemaänderungen werden zurückgerollt.
- Bestehende PostGIS-, MinIO-STS-, Backup-/Restore- und gesamte Backend-Tests bleiben unverändert erforderlich.
- DJI-Referenzen: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/https/media-management/fast-upload.html und https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/https/media-management/group-upload-callback.html .

- `backend/test/pilot-media-mutation.integration.test.js`: echter PostgreSQL-Rollback bei Audit-Ausfall, anschließende erfolgreiche Registrierung und idempotente Wiederholung.
