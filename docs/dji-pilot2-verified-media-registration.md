# DJI Pilot 2 – Persistente Medienregistrierung mit S3-Objektnachweis

Stand: 22.10.2026 – Entwicklungsbranch `feature/pilot2-media-verified-registration-20261022`. **Nicht auf dem Raspberry Pi installiert; keine produktive HTTP-Route.**

## Architektur

Der Baustein ergänzt die bereits bestehenden Pilot-2-Medienverträge, den separaten HTTPS-STS-Grenzhandler und den echten MinIO-STS-Aussteller aus den Draft-PRs #34 und #36. Alle Teile bleiben aufeinander gestapelt, ohne `backend/server.js`, Docker Compose oder laufende Broker-/Speicherdienste zu ändern.

- `backend/db/migrations/003_dji_pilot_media_verified.sql`: additive PostgreSQL-Migration für `dji_pilot_media_grants` und `dji_pilot_media_verified`. Workspace-UUID, Grant-Präfix, Datei-Identität, S3-HEAD-Evidenz und stark begrenzte Pilot-Metadaten. **Keine STS-Credentials, Tokens oder Bildbytes.**
- `backend/pilot-media-store.js`: `createRegisteredStsIssuer` hüllt den bestehenden STS-Aussteller ein. Das ausgegebene `<workspace>/media/<session>`-Präfix muss vor der Ausgabe des Grants dauerhaft gespeichert werden; falls die Datenbankregistrierung fehlschlägt, werden die Credentials dem Client nicht übergeben.
- `createPilotMediaStore.verifyCallback`: akzeptiert nur einen validierten, erfolgreich gemeldeten DJI-Callback, ein registriertes Workspace-STS-Präfix und eine begrenzte Gültigkeit mit 15 Minuten Callback-Nachlauf. Anschließend muss ein **vom Server selbst ausgeführter S3 `HeadObject`** für den exakt bezeichneten Objektschlüssel Länge, ETag und Änderungszeit melden. Letztere muss in das STS-Zeitfenster passen. Erst danach entsteht ein persistenter bestätigter Eintrag.
- `backend/pilot-media-head.js`: serverseitiger, rein lesender `HeadObjectCommand`-Adapter für einen **separaten S3-Leseprincipal**, niemals den Put-only-Pilot-STS-Token. `404` bedeutet kein Nachweis, `403` oder Netzwerkfehler führen fail-closed zu einer unverfügbaren Prüfung.
- `existingTinyFingerprints` und `verifiedFingerprint`: suchen ausschließlich nach bereits bestätigten Medien **im selben Workspace**. Beide verwenden SQL-Parameter und den vorhandenen DJI-Fingerprint-Validator.

## Garantien und Einschränkungen

- Unique-Key auf `(workspace_id,object_key)`, Unique-Index auf `(workspace_id,fingerprint)` für nichtleere Fingerprints, Fremdschlüssel von Medien zu exakt demselben Workspace und Grant. Doppelte identische Callbacks sind idempotent; widersprüchliche Antworten erzeugen `conflict`.
- Keine Callback-gesteuerten S3-Schreib-/Löschoperationen, kein direktes Vertrauen in den vom Client übermittelten Objektschlüssel außerhalb des Grants, keine persistierten Credentials.
- Ein S3 `HEAD`-Nachweis bestätigt das **Vorhandensein, die vom Storage gemeldete Länge und den ETag**, aber noch nicht das tatsächliche DJI-Multispektralformat, die volle Datei-Hash-Integrität oder eine über Multipart-Uploads hinweg kryptografische Inhaltsgleichheit. DJI-Fingerprint-Werte sind clientseitige Identifikatoren; ihre semantische/cryptographische Verifikation bleibt aus. Wegen möglicher Änderungen zwischen HEAD und Konsum („TOCTOU“) muss eine spätere Medienanalyse ETag/Version erneut prüfen.
- Die DJI-`group-upload-callback`-Verarbeitung ist noch nicht integriert. Die existierende `media_assets`-Legacy-Tabelle wird absichtlich **nicht** überschrieben oder migriert. Kein automatisch gestarteter Worker, keine neue HTTP-Route und keine Freischaltung auf dem RC.
- Das Verbindungsstück, das mit dem *authentifizierten Pilot-2-Workspace-Principal* den Callback in `verifyCallback` überführt, muss noch gesondert implementiert und gegen DJI Pilot 2/RC Pro Enterprise getestet werden. Ohne diese Bindung darf die isolierte Store-Funktion nicht direkt öffentlich verfügbar gemacht werden.

## Tests und Rollback

`node --test backend/test/pilot-media-store.test.js` deckt in-memory-SQL-Adapter und Fake-`HeadObject` ab. `backend/test/pilot-media-store.integration.test.js` läuft in der bereits vorhandenen **dedizierten** CI-PostgreSQL-Datenbank `skyhub_test` über Loopback. Migration und Testdaten entstehen in einer eigenständigen Transaktion mit Rollback. Auch ein erneuter Migrationsaufruf, SQL-Workspace-Fremdschlüssel, Konflikte und verzögerte Callbacks werden geprüft.

Migration wird **nicht** auf dem Pi ausgeführt. Das Rückrollen eines künftigen produktiven Deployments verlangt vorab geprüfte Datenbanksicherung und ein separates Migrations-/Rollback-Fenster; die Bestandsdaten in MinIO bleiben davon unabhängig.
