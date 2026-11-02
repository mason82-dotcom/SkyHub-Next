# FH-Clone → SkyHub-Next P0–P2 (FC0)

Stand 02.11.2026. FH-Clone-Referenz: c649c53b69cbef7b31e65ca610c4b85654cd3657.
SkyHub-Basis: bcc06808408555780ccfbd37fab28c2f1a60a479.

## P0 — Architektur und Safety
Kein Full-Merge, zweiter MQTT-Client, neuer Broker, Datenbank-Stack, Cesium/paas.js
oder DRC. Aktueller SkyHub DJI Cloud API 1.18 Ingest bleibt alleiniger
MQTT-Consumer. Nur nach classifyMessage und registry.ingest akzeptierte
nicht-retained OSD-/State-Pakete werden in-memory analysiert. FC0 ist verbindlich.
Kein Publish, Steuer-Downlink, DJI-Action, MinIO/Postgres-Schreiben.

## P1 — Implementierte Beobachter
backend/fh-observer.js: RTK-Fix (is_fixed=2), Lost/Acquired-Übergänge,
Zeitverifikation, 5-Sekunden-Stale, Flugmodi-/Timeout-basierte Flugsitzungen
und pro-Adapter Telemetrie-Herkunft. Alle Grenzen ausdrücklich observational:
kein mission.ready, kein flight.ready, kein Flighttask-Senden. Bounded memory
(128 Geräte, 256 Events); nach Serverneustart kein historischer Backfill.
Ein stale/unverified Wert wird nicht zur ausgewählten Quelle.

Geschützte GET-APIs:
- /api/diagnostics/fh/rtk
- /api/diagnostics/fh/flights
- /api/diagnostics/fh/events
- /api/diagnostics/fh/sources/:sn

Der bestehende View-Token bleibt erforderlich; es gibt keine neue LAN-Ausnahme.

## P1 — MSDK FC0 Vertragsadapter
POST /api/adapters/msdk/observe ist per Default aus. Aktivierung mit
SKYHUB_FH_MSDK_OBSERVER_ENABLED=true und einem separaten
SKYHUB_FH_MSDK_OBSERVER_TOKEN (mindestens 32 Zeichen). Nur HTTPS, Bearer,
gültige Cloud-Gateway/Aircraft-Topologie und numerische Werte aus Allowlist.

Beispiel: {"gatewaySn":"RC_SN","aircraftSn":"AIRCRAFT_SN",
"sampledAt":1700000000000,"values":{"battery":52,"rtkFixState":2}}

Die Original-FH-Clone-Android-App ist NICHT read-only. Sie enthält Kamera-,
Gimbal-, Virtual-Stick- und KMZ-Upload-Actions. Keine unveränderte APK
übernehmen! Der SkyHub-Endpunkt ist ein abgesicherter Adaptervertrag;
ein kompatibler RC-Client und reale Geräteabnahme sind separat nötig.
Pilot 2 und native MSDK-App können sich als Betriebsmodus ausschließen.

## P2 — UgCS, Prometheus
SKYHUB_FH_UGCS_URL ist standardmäßig leer und deaktiviert. Optionaler interner
UgCS-UCS-Reader (HTTP GET, begrenzt, Allowlist und Redaction):
- /api/diagnostics/fh/ugcs/health
- /api/diagnostics/fh/ugcs/vehicles
- /api/diagnostics/fh/ugcs/routes
- /api/diagnostics/fh/ugcs/telemetry

Benötigt einen separaten UgCS-UCS-Bridge-Prozess im internen Netz, keine
Missionsschreibfunktionen.

Prometheus ohne Geräte-/Seriennummern-Labels:
GET /api/diagnostics/fh/metrics — bestehende View-Token-Authentifizierung.
Prometheus muss hierfür gesondert mit einem autorisierten Scrape konfiguriert
werden. Keine ungeschützte /metrics-Route oder neuer Pi-Port.

## Abnahme
- node --test backend/test/fh-*.test.js
- node --test backend/test/*.test.js
- CI, Repo- und Compose-Checks; keine Änderung an Produktivdiensten
- Echte Pi-/Pilot-2-RTK-/Flight-Evidence bleibt offen
- MSDK-/UgCS-Hardware- und Netzabnahme bleibt offen

Rollback: Feature-Branch nicht mergen oder Commit zurücknehmen.
