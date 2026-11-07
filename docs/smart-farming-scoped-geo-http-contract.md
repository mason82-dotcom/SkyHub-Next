# SkyHub-Next: P3 getrennt autorisierter GIS-HTTP-Vertrag (nur Labor)

**Stand:** 02.11.2026. **Basis:** der experimentelle lokale M3M-GIS-Worker aus dem bereits gemergten PR #231; dieses Paket wird als eigenständiger, **nicht gemounteter** HTTP-Vertrag aus dem historischen Draft #116 nach `main` übernommen. **Keine Raspberry-Pi-Bereitstellung oder produktive API-Aktivierung.**

## Welche Sicherheitslücke wird geschlossen?

Die vorhandene Smart-Farming-Katalogschnittstelle ist Metadaten-only und verwendet den SkyHub-Bearer-Ansichtstoken; sie besitzt keinen allgemein freigegebenen Nutzer-/Workspace-Feldrechtevertrag. Der bisherige P3-Python-Worker `m3m_private_gis_query.py` darf deshalb nicht einfach an eine vom Browser erreichbare Route angehängt werden. Auch ein erfolgreicher M3M-Bundle-Seal ist kein Nachweis, dass ein anfragender Nutzer diese privaten Felddaten sehen darf.

Das isolierte Inkrement ergänzt `backend/smart-farming-geo-api.js` als **isoliert importierbaren Express-Router**, der standardmäßig **nirgendwo gemountet** ist. `backend/server.js`, Docker, MQTT, DJI, MinIO und Datenbanken bleiben unverändert.

## HTTP-Kontrakt im isolierten Testserver

`POST /api/smart-farming/geo/:candidateId/sample` mit kleinem JSON-Body:

~~~json
{"schema":"skyhub-m3m-geospatial-request-v1","geometry":{"type":"Point","coordinates":[9.0,49.0]}}
~~~

Der Punkt ist ein **Syntaxbeispiel**, keine echte Befliegungskoordinate. Als Alternative ist ein einfaches GeoJSON-Polygon ohne Löcher und mit maximal 256 Punkten erlaubt. Der Textkörper ist auf 16 KiB und das erwartete Rasterfenster auf höchstens 250.000 Pixel begrenzt; der nachgelagerte Python-Worker erzwingt diesen Grenzwert beim tatsächlichen Rasterlesen. Es werden keine vom Browser gewählten Pfade, SHA-Pins, S3-Schlüssel oder CRS-Angaben angenommen.

## Abhängigkeiten des Routers – zwingend alle injizieren

1. `authenticate(req,res,next)`: bestehende HTTP-Authentifizierung oder zukünftiger Identity Provider; nicht für allgemeine LAN-Freigabe ohne Identität verwenden.
2. `scopedPrincipal(req)`: serverseitig abgeleitete und geprüfte `{actorId, workspaceId}`; **niemals** aus dem JSON-Body oder einem ungesicherten Header übernehmen.
3. `authorizeWorkspaceCandidate({principal,candidateId})`: unabhängige objektbezogene Zugriffsprüfung auf ein tatsächlich im Workspace vorhandenes Asset mit Feld-/Rollenrechten; `false` ergibt generisch 404, Fehler 503.
4. `sampleVerifiedBundle({principal,candidateId,geometry})`: **noch nicht an Live-Daten angeschlossener Provider**. Dieser muss nach der Autorisierung den Kandidaten ausschließlich über eine serverseitige, versionsgebundene Asset-Registry auflösen, extern gepinnte Siegel/Dateien verifizieren, den privaten Python-Worker ausführen und dessen numerische Ergebnisse zurückgeben. Tests verwenden nur einen synthetischen Provider.

Der Router kann ohne alle vier Callbacks nicht erstellt werden. Ein gewöhnlicher `SKYHUB_VIEW_TOKEN` ohne geprüften `scopedPrincipal` kann den GIS-Zugriff **nicht** aktivieren. Es gibt keine `GET`-/Download-/Tile-/Düngungs-/Missionsroute. Der Browser erhält niemals Roh-GeoJSON, Koordinaten oder Dateipfade zurück.

## Ausgabe- und Fehlervertrag

Nur wenn die Providerantwort das bekannte Experimentalschema, vollständige acht numerische Layer, endliche Kennzahlen, gültige Pixelzahlen, `fullBundleIntegrityRecheckedAfterRead=true` und alle Kalibrierungs-/Flug-/Applikationsflags **false** liefert, wird ein bereinigtes JSON mit `schema=skyhub-m3m-geo-sample-http-v1` ausgeliefert. Rohantworten werden **nicht** weitergereicht. NoData, Mean/Median/Perzentile und Min/Max werden geprüft. Es gelten `Cache-Control: no-store`, `nosniff`, `no-referrer` und eine obere Grenze für gleichzeitige Requests (Standard 2).

- 401: Authentication verweigert; 403: keine serverseitige Workspace-Identität; 404: unbekannter/unberechtigter Kandidat oder nicht vorhandene Route.
- 400: Body oder GeoJSON ungültig; 413: Request zu groß; 415: kein `application/json`; 429: begrenzte Parallelität überschritten.
- 503: Workspace-Rechte-Service ausgefallen, Worker nicht verfügbar, verändertes Siegel oder manipulierte/unsichere Rasterdaten. Fehlermeldungen enthalten keine Dateipfade, GPS-Daten, HMAC-/SHA-Geheimnisse oder Anbieterdiagnostik.

Die HTTP-Ausgabe trägt weiterhin `operationalUseAllowed=false`, `prescriptionExportAllowed=false`, `flightMissionAllowed=false` und `radiometricCalibrationVerified=false`. Diese Bedingungen dürfen bei späterer echter Kalibrierung nicht durch freie Benutzerparameter überschrieben werden.

## Abnahme / offene Gates

`backend/test/smart-farming-geo-api.test.js` führt isolierte echte Loopback-Express-Tests für Auth, Workspace-Autorisierung, fehlerhafte Body-Geometrien, fehlende Rechte, gefälschte Qualitätsflags, numerische Validierung, Output-Whitelisting und gleichzeitige Anfragen aus. Der bestehende isolierte `.github/workflows/m3m-offline-acceptance.yml` testet diese Datei explizit mit. Zusätzliche Regressionstests verbieten das Importieren/Mounten in `backend/server.js` und prüfen die verpflichtenden Trust-Callbacks. Die CI-Ergebnisse beziehen sich nur auf einen synthetischen Provider; **keine echte HTTP↔Python-Verkabelung oder Browser-/Android-Abnahme**.

Vor produktiver Kopplung fehlen weiterhin: verbindliches Workspace-RBAC, abgeschlossene MinIO-Objektversionierung und private Hash-Pins, geschützter Worker-Jobdienst mit Ressourcenbudget und nachvollziehbarem Audit, echte M3M-Originalaufnahmen inklusive DLS-/Panel-Referenz, prüfbare Band- und Radiometriequalität sowie eine separate Browser-/CSP-/CSRF-/HTTPS-Abnahme. Bei POST mit Bearer-Token muss die künftige Autorisierungsarchitektur auch Origin-/CSRF-Risiken explizit berücksichtigen. Keine Kacheln oder georeferenzierten Kartenbilder ohne vorgelagerte Datensatz-/Rechtefreigabe.

## Release-Grenze

Nach vollständiger grüner synthetischer CI darf der ungemountete Router als **experimenteller Quellcode-Vertrag** in `main` integriert werden, aber nicht als produktives GIS-Feature gelten. **Kein Deployment oder API-Mount allein aufgrund bestandener HTTP-Tests**, keine Änderung des Pi-Stacks und keine DJI-Missions-/Agras-Ausführung.
