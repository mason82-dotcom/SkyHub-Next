# Cloud API 2: Keyless-Webportal in SkyHub Next

**Stand: 06.11.2026.** Eigenständige, responsive Weboberfläche und read-only DaaS-Fassade auf SkyHubs bestehende Cloud-API-1.x-Geräteregistrierung. Keine originale DJI Cloud API 2 PaaS-/SDK-Installation.

## Start und Endpunkte

- Neue Website: /cloud-api2.html
- GET /api/cloud-api2/status – SkyHub MQTT-Verbindungsstatus und Laufzeitgrenzen
- GET /api/cloud-api2/devices – projizierte registrierte Geräte
- GET /api/cloud-api2/capabilities – verfügbare und bewusst deaktivierte Fähigkeiten
- Objektorientierter ES-Client: frontend/public/cloud-api2-sdk.mjs
- Deterministischer Simulator: frontend/public/cloud-api2-lab.mjs
- KI-Werkstatt: nur lokale Promptvorlagen; kein KI-Dienst oder DJI MCP gestartet

Die Website funktioniert als statische Seite auch dann, wenn der Server 401 zurückgibt: Die Live-Geräteansicht meldet korrekt den fehlenden Zugang und die Simulations-/KI-Abschnitte bleiben lokal benutzbar. Es wird kein View-Token im Frontend abgefragt und kein DJI-Key verlangt.

## Funktionsmatrix

| Modul | Ohne DJI-Key umgesetzt | Status |
| --- | --- | --- |
| Dashboard und Geräte-Kacheln | Ja | SkyHub Registry, read-only |
| Backend / PaaS-ähnlicher Geräteüberblick | Ja, eigene Fassade | Keine originale DJI PaaS |
| Objektorientiertes SDK | Ja, eigenes Browser-ES-Modul | Nur GET |
| Frontend-Komponenten | Ja, eigenständig | Ohne proprietäre Assets |
| Offline-Gerätesimulator | Ja | Synthetisch, browserintern |
| KI-Entwicklungshilfen | Ja | Lokale Promptvorlagen |
| DJI API 2 Java/JNI SDK | Nein | Nicht installiert |
| Original DJI PaaS und Frontend-Runtime | Nein | Externe Bereitstellung/Lizenz |
| Cloud API 2 MQTT Bridge | Nein | Nicht konfiguriert |
| DJI AI Plugin und dessen MCP-Tools | Nein | Nicht installiert |
| Flugsteuerung, Missionsversand, DRC | Nein | Absichtlich gesperrt |

## Sicherheitsmodell

SkyHub empfängt weiterhin die bereits vorhandenen MQTT-Daten über Cloud API 1.x. Die neue Website greift nicht auf MQTT zu, sondern verwendet ausschließlich GET-Endpunkte hinter der bestehenden SkyHub API-Authentifizierung. Die explizit konfigurierbare LAN-Lesefreigabe gilt auch für diese drei begrenzten Endpunkte, sofern sie ohnehin aktiviert ist.

Der neue Backend-Adapter liefert ausschließlich Rolle, Modellname, Topologie-Online-Status, validierten Online-Status, Akkustand und OSD-Alter. Keine Seriennummern, Kennungen, Koordinaten, Roh-Telemetrie, Schlüssel oder sonstige DJI-Payloadfelder. Eine Online-Kennzeichnung setzt alle drei vorhandenen Signale voraus: online, fresh und topologyOnline. Geräteliste auf 100 Einträge begrenzt, Gesamtsumme separat.

Der Simulator ist ein separates rein browserinternes Objekt mit festen synthetischen Frames. Er kann nichts an echte Drohnen versenden. Der JSON-Export trägt synthetic=true, flightReady=false und hardwareVerified=false.

## Tests

Im Backend-Verzeichnis:

    node --test test/cloud-api2-keyless.test.js

Geprüft werden: Feld-Redaktion und Datenbegrenzung; Stale-Status; GET-only-Router; Einbindung hinter Auth-Middleware; same-origin SDK; lokale Simulator-Provenienz; keine externen Skripte oder bekannten DJI-Flugkommandos in den Assets.

Diese Tests sind Offline-/Code-Nachweise, keine Flug- oder Geräteabnahme. Für den produktiven Raspberry Pi gelten weiterhin alle existierenden Compose-Overlays: dort niemals ein unkoordiniertes docker compose up ausführen. Der PR stellt weder Docker-, Broker- noch Geräteparameter um.

## DJI Referenzen und Grenzen

DJI Cloud API 2 V1.1.0 wurde am 05.11.2026 veröffentlicht. Die herstellereigene Implementierung ist ein eigenständiger PaaS-Stack mit nativen Java/JNI-SDK-Bestandteilen. Eine sichere oder unterstützte Übernahme dieser proprietären Komponenten ohne deren Bereitstellung wird nicht behauptet. Besonders die tatsächliche native ARM64-SDK-Lauffähigkeit auf dem Raspberry Pi 5 bleibt ungeprüft.

- https://github.com/dji-sdk/Cloud-API-2/blob/main/docs/cn/00.release-notes.md
- https://github.com/dji-sdk/Cloud-API-2/blob/main/docs/cn/03.deployment/04.mqtt-bridge.md
- https://github.com/dji-sdk/Cloud-API-2/blob/main/docs/cn/09.sdk/01.sdk-intro.md
- https://github.com/dji-sdk/Cloud-API-2/blob/main/docs/cn/12.api1-api2-comparison.md

Achtung: Die Cloud API 2 V1.1.0 ist nicht dieselbe Versionslinie wie die bisherige Cloud API 1.x. Ein vollumfänglicher Cloud-API-1.20-Protokollabgleich oder die hardwareseitige Kompatibilität aller unterstützten Drohnen wurde hier nicht nachgewiesen.

## Integration Explorer: Module und Developer Skills (06.11.2026)

Im Portal gibt es den zusätzlichen Reiter **Module & Skills**. Er verlinkt die bereits im SkyHub-Repository vorhandenen Seiten `/wpml-survey-preview.html`, `/abdeckung.html` und `/thermal.html`. Das sind lediglich Navigationsziele und keine Cloud-API-2-Protokolladapter. Ihre Verfügbarkeit auf einem produktiven Pi wird nicht behauptet. Insbesondere bleiben `flightReady=false` sowie die getrennte Thermal-Genauigkeitsbewertung zwingend.

Die separat dargestellten DJI-Developer-Skills `cloudapi2-sdk-core`, `cloudapi2-device-management`, `cloudapi2-frontend-component`, `cloudapi2-map` und `cloudapi2-troubleshooting` sind **Herstellerreferenzen, nicht installiert**. Die SkyHub-eigene Agent-Regel `.agents/skills/skyhub-cloudapi2-keyless/SKILL.md` beschreibt, wie diese Ressourcen ohne DJI-Key und ohne Flugsteuerung zur Entwicklung herangezogen werden dürfen.

Referenz: https://github.com/dji-sdk/Cloud-API-2/tree/main/devkit/skills ; der Hersteller stellt zusätzlich einen MCP-Server mit Flugfähigkeiten bereit. Dieser wird **nicht** installiert, verbunden oder im Produkt aktiviert.

Zusätzlicher Offline-Test: `node --test test/cloud-api2-module-catalog.test.js`. Der Test prüft die lokalen Links und Sicherheitsgrenzen; weder Pi-/DJI-Laufzeit noch Hersteller-SDK werden dabei ausgeführt.

## Mavic 3 Enterprise & Multispectral (Modellkatalog, Schlüssel-frei)

Ergänzung im Branch `feature/cloud-api2-website-20261106`: Eine eigene Ansicht `Mavic 3 Enterprise` mit folgenden DJI-Herstellerprofilen:

| Modell | Bildsensoren | Fachmodule, nur Referenz / Planung |
| --- | --- | --- |
| Mavic 3E | RGB 20 MP, 4/3 CMOS, mechanischer Verschluss | RGB-Mapping, RTK, WPML-Entwurf |
| Mavic 3T | RGB/Tele/Thermal 640×512 | Thermal, R-JPEG, RGB-Inspektion |
| Mavic 3T Advanced | Thermal 640×512, 8 µm Pixelpitch | separates Advanced-Thermal-Profil |
| Mavic 3M | RGB 20 MP + G/R/RE/NIR je 5 MP | Multispektral / NDVI, RGB-Mapping |

Mavic 3M ist bei DJI eine **separate Multispectral-Produktlinie** und hier als verwandtes Gerät berücksichtigt. Mavic 3D / 3TD gehören zur Dock-Familie und werden nicht mit M3E/T/TA/M verwechselt.

Die JS-Library `frontend/public/cloud-api2-mavic3.mjs` bietet einen statischen Modellkatalog, spezifische Sensor-/Modulhinweise und eine konservative Klassifikation bereits vorhandener, redigierter Registry-Modelle. Kein Import von DJI-Libraries und keine neuen Backend- oder MQTT-Schreibwege. Die Ansicht zeigt **unbekannt**, wenn keine aktuelle Live-Registry-Information vorliegt. Die Fachmodule sind **keine automatische Laufzeitaktivierung**, kein Nachweis einer Cloud API 2 Freigabe und keine Flug-/Missionsfreigabe.

Figma-Design: https://www.figma.com/design/jigezwMCyKOiF0yNQB2pfJ

Herstellerreferenzen:
- https://enterprise.dji.com/mavic-3-enterprise/specs
- https://enterprise.dji.com/mavic-3-m

## Operator-triggered evidence inventory (follow-up)

The new **Nachweise** tab uses a separate, strongly authorized `GET /api/cloud-api2/evidence` endpoint. Unlike the three earlier token-free-LAN read endpoints, **this endpoint is deliberately not in the home-LAN allowlist**. Existing SkyHub view-token authentication is required; the portal does not request or store credentials. HTTP 401 is reported as unavailable, never replaced with synthetic 'real' evidence. The request occurs **only** on explicit operator click; no background polling, automatic cloud queries, token injection or device actions.

Source modules and interpretation:
- `wpmlStore.status()/list({page:1,pageSize:1})`: number of stored WPML revisions. No mission name/ID, target, geolocation or mission release is exposed. These are **not flight approvals**.
- `ppkFlights.list()`: number of available photo flights with at least 2 images, read from the existing PPK inventory. They are **not computed coverage results** and have no proven device correlation.
- `mediaStorage.buckets()/mediaRouter.bucketIndex()`: count of DJI-style `_T.JPG` or `_T.JPEG` filename candidates. These are **not calibrated or verified R-JPEG temperature measurements**.

Results are server-side redacted to fixed status/number enums only; they contain no serial number, object key, bucket, route coordinate or media payload. Inventory queries have bounded reads and fail closed to `unknown` or `unavailable`. The response flags `deviceCorrelation=not-established`, `hardwareVerified=false`, `flightReady=false`, `accuracyVerified=false`, `synthetic=false`.

Files: `backend/cloud-api2-evidence.js`, `frontend/public/cloud-api2-evidence.mjs`, and `backend/test/cloud-api2-evidence.test.js`.

Verification command (backend directory): `node --test test/cloud-api2-evidence.test.js test/cloud-api2-keyless.test.js test/cloud-api2-module-catalog.test.js`. Hardware acceptance, DJI Cloud API 2 bridging, automatic association of mission/media with aircraft, GIS route correctness and thermal accuracy remain explicitly unverified.
