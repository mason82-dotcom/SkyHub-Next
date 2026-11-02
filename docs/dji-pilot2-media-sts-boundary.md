# DJI Pilot 2 Media STS – isolierte HTTPS-Autorisierungsgrenze

Stand: 22.10.2026. Basis: SkyHub Next, Branch `feature/pilot2-media-sts-boundary-20261022` auf dem unabhängig getesteten DJI-Service-Reply-Branch.

## Zentrale Protokollunterscheidung

**Pilot 2 (RC Pro Enterprise, RC Plus 2):** Medienverwaltung nutzt HTTPS. Der Pfad für kurzlebige Speicherzugangsdaten ist `POST /storage/api/v1/workspaces/{workspace_id}/sts` und erfordert den Header `X-Auth-Token`. Vor dem Medienupload nutzt Pilot 2 Medien-Fingerprint-, Upload- und Callback-HTTP-Endpunkte.

**DJI Dock:** `storage_config_get` verwendet für die Medien-STSes das MQTT-Topic `thing/product/{gateway_sn}/requests` und eine Antwort auf `requests_reply`. Dieser Dock-Pfad ist **nicht** Voraussetzung für die Pilot-2-Medienbibliothek und wird hier nicht abonniert oder beantwortet.

DJI-Referenzen:
- https://developer.dji.com/doc/cloud-api-tutorial/en/feature-set/pilot-feature-set/pilot-media-management.html
- https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/https/media-management/obtain-temporary-credential.html
- https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dock-to-cloud/mqtt/dock/dock3/media.html

## Implementierung

`backend/pilot-media-sts.js` exportiert `createPilotMediaStsHandler`. Es ist ein rein injizierbarer Request-Handler, **nicht** im `backend/server.js` oder Pilot-2-Webview eingebunden. Der Handler hat **keinen** eigenen MinIO-Client, keinen Datenbankzugriff, keine ausgehende Verbindung, keine MQTT-Veröffentlichung, keine Konfiguration über `process.env` und kann keine Produktions-Zugangsdaten ausgeben, solange keine geprüften Abhängigkeiten explizit übergeben werden.

Prüfreihenfolge, bevor überhaupt eine Ausgabe möglich wäre:

1. `req.secure === true` (der produktive Reverse Proxy muss vertrauenswürdig konfiguriert bleiben); genau der konfigurierte UUID-Workspace in `req.params.workspaceId`; keine willkürlichen Body- oder Query-Parameter.
2. Nichtleerer `X-Auth-Token` als einfacher Header-Wert, maximal 512 Zeichen; Verifikation über die injizierte Funktion `authorize`, deren Principal **objektförmig**, `role === 'pilot'` und exakt auf den konfigurierten Workspace gebunden sein muss. Ein Boolean reicht nicht.
3. Konfiguration für MinIO mit exakt festgelegtem HTTPS-Origin, Bucket `dji-cloud` und Region; explizite issuer- und separate Rate-Limiter-Funktion. Fehlt eines davon, antwortet der Handler mit `503` und ohne Credentials.
4. Rate-Limiter muss explizit `true` liefern. Andernfalls `429`; bei Fehlern `503`.
5. Der externe STS-Issuer erhält nur Workspace, Principal und das maximale Ablaufintervall von 900 Sekunden, **nicht den Pilot-Token**.
6. Der zurückgelieferte Grant muss Provider `minio`, Bucket, Endpoint und Region exakt treffen; `objectKeyPrefix` ist auf `<workspace>/media/<session_id>` begrenzt; drei nichtleere temporäre Credential-Felder und Ablaufdauer 1–900 Sekunden erforderlich. Danach prüft `media-upload-contract.stsResponse` die offizielle DJI-HTTPS-Antworthülle.
7. Fehler und Exceptions aus Auth, Limiter und Issuer werden redigiert. Keine Ausgabe von Fehlerdetails, Credential-Werten oder Gerätekennungen in Fehlermeldungen. `Cache-Control: no-store` ist auch im Erfolgsfall gesetzt.

**Wichtige Grenze:** Metadaten im Grant und die Befristungszahl beweisen **keine** tatsächliche MinIO-IAM-Durchsetzung! Diese muss mit einem echten begrenzten STS-Issuer sowie aktiven Positiv-/Negativtests (nur `PutObject` auf exakt diesem Präfix, kein `GetObject`, `DeleteObject`, `ListBucket` und keine fremden Workspace-Präfixe) separat nachgewiesen werden. Bis dahin darf das Modul nicht produktiv verdrahtet und der DJI-Pilot-Media-UI-Baustein nicht geladen werden.

## Tests und nächster Schritt

`node --test backend/test/pilot-media-sts.test.js`

Tests decken Workspace-Isolation, TLS, Header, Rollenbindung, unabhängige Rate-Limits, Fehlfunktionen, Verbot ungebundener Präfixe, Provider-/Endpoint-Verwechslung und geheime Daten ab. Die CI führt außerdem den gesamten Backend- und PostGIS-Testsatz aus.

Die spätere produktive Integration benötigt einen sicheren MinIO-STSes-Issuer, dessen Policy am echten Server überprüft wurde; einen persistenten und überprüften Upload-Registerdienst samt Fingerprint- und Callback-Verarbeitung; Audit- und Ratenlimits; einen separat freizugebenden Pilot-2-Hardwaretest mit Wegwerf-Bucket. Ein isolierter Vertrag ersetzt diese Arbeit nicht.

**Betrieb:** Keine Port-/Broker-/Compose-Änderung, kein `api`-/`media`-Modul in Pilot 2 aktiviert, kein Raspberry-Pi-Deployment.
