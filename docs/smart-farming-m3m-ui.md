# Experimenteller Smart-Farming-Tab (M3M)

**Aktualisiert: 24.10.2026** · Repository
https://github.com/mason82-dotcom/SkyHub-Next

## Neue Oberfläche

Seit dem Merge von [PR #100](https://github.com/mason82-dotcom/SkyHub-Next/pull/100)
sind folgende statische, ohne Frontend-Build lauffähige Dateien **im Repository-Branch `main`** vorhanden:

- `frontend/public/smart-farming.html`: eine getrennte Seite, im
  bestehenden Dashboard als **Smart Farming · Experimentell** verlinkt.
- `frontend/public/smart-farming-ui.js`: validiert die
  API-Schemainhalte und rendert ausschließlich mit `textContent`
  NDVI, NDRE, GNDVI und OSAVI als dimensionslose Kennzahlen.
- `frontend/test/smart-farming-ui.test.js`: isolierte Node-Tests zur
  Indexdaten-Validierung, Informationsminimierung, Tokenbehandlung
  und Vermeidung von Karten-/GIS-Funktionen.

Die Seite fragt nur
`GET /api/smart-farming/candidates/` ab, mit manuell
eingegebenem SkyHub-View-Token im `Authorization: Bearer`-Header.
Das Token wird weder in eine URL noch in Local-/Session-Storage
geschrieben und nach der Anfrage aus dem Eingabefeld gelöscht.
Vor dem Absenden verlangt die Oberfläche HTTPS oder einen lokalen
Loopback-Zugang (`localhost`/`127.0.0.1`/`[::1]`). Unverschlüsselte
LAN-Adressen sind gesperrt. Zusätzlich setzt der Bearer-GET
`redirect: 'error'` und `referrerPolicy: 'no-referrer'`, sodass
HTTP-Weiterleitungen nicht automatisch mit Zugangsdaten verfolgt werden.
Die Frontend-Tests prüfen dafür den wirklichen Klickpfad mit einem
isolierten Browser-/DOM-Testdoppel: Auf unsicherem LAN darf nicht einmal
`fetch()` aufgerufen werden, während HTTPS und SSH-Loopback ohne
Tokenpersistenz funktionieren. Dies ist eine reine Client-Schutzschicht;
Server-Authentifizierung, HTTPS-Terminierung und die bestehenden
Netzwerkgrenzen bleiben weiterhin erforderlich.

Der Browser zeigt unterscheidbare Zustände für:
ungültigen Token (401), noch nicht aktivierte API (404),
nicht verfügbaren Katalog (503), invalides Datenformat und
einen leeren Kandidatenbestand. Die Anfrage ist ausschließlich lesend.

## Voraussetzung / wichtige Schranke

Die API wurde zusammen mit der M3M-Konsolidierung über
[PR #100](https://github.com/mason82-dotcom/SkyHub-Next/pull/100) nach `main` übernommen.
Sie ist ohne `SKYHUB_M3M_CATALOG_ENABLED=true` weiterhin nicht
gemountet; mit dem Flag müssen zusätzlich ein geschützter
Katalogstamm und ein **unabhängig gepinnter** Manifest-SHA256
gesetzt werden. Diese Konfiguration wurde **nicht** am Pi
verändert. Eine bloße Codeänderung oder ein Draft-PR aktiviert
keinen Endpunkt im laufenden System.

Die API verifiziert den Hash einer privaten
Kandidaten-Registrierung, **nicht** jedes Originalraster bei
jedem GET. Die Oberfläche nennt dies ausdrücklich und setzt
keine Kalibrierungs-, Flug- oder Exportfreigaben.

## Lokal prüfen (ohne Deployment)

```bash
cd ~/Projekte/SkyHub-Next
node --check frontend/public/smart-farming-ui.js
node --test frontend/test/smart-farming-ui.test.js
node --test backend/test/smart-farming-catalog.test.js
# Optional im isolierten Node-Lab mit npm ci:
node --test backend/test/smart-farming-catalog-http.test.js
```

Die HTML-Seite wird als statischer Inhalt vom vorhandenen
`express.static(frontend/public)` bereitgestellt. Daraus
folgt **keine** Freischaltung des Katalog-API-Endpunkts.

## Nächste Gates

Die erforderlichen GitHub-Integrations- und TAK-Browserchecks liefen
auf der M3M-Main-Konsolidierung erfolgreich; siehe
[Release- und Teststatus](smart-farming-m3m-release-status-2026-10-24.md).
Zusätzlich prüft `tests/test_m3m_e2e_offline_catalog.py` auf einem
isolierten Runner den gesamten **synthetischen** Datenfluss:
5-Band-GeoTIFF → vier Reflektanzraster → vier Indizes → Pixel-QA →
extern gepinnter SHA-256-Beleg → privater Kandidat → echter Node-Katalog.
Auch absichtlich manipulierte Raster, Kandidaten und Katalogmanifeste
müssen dort blockiert werden. Das ist keine M3M-Radiometrieabnahme.

Danach Browser-/Mobiltests (Chrome Android, Firefox, schmale Screens),
Auth-Review und einen separat versionierten, privaten
Katalog-Testdatensatz abnehmen. Auf realen DJI-M3M-Bildern
sind weiterhin kalibrierte Referenzflächen, Bandregistrierung
und das nachprüfbare DEDAL-Verarbeitungsprotokoll notwendig.

**Keine Kartenkacheln, Geokoordinaten, Sensor-Rohdaten,
Ausbringkarten, Missionssteuerung oder Produktionsfreigabe.**

## Transportschutz des Katalogs (24.10.2026)

Zusätzlich zur schon vorhandenen **Browserprüfung** setzt der neue
`backend/m3m-catalog-transport.js` eine serverseitige Schranke innerhalb des
authentifizierten M3M-Routers durch. Sie lässt nur folgende Wege zu:

- Direkt per TLS am Node-Server (`req.socket.encrypted`).
- Direkt über lokale Loopback-Verbindungen (`127.0.0.0/8`, `::1`),
  beispielsweise durch einen **explizit eingerichteten SSH-Tunnel**.
- Über einen TLS-terminierenden **lokalen** Reverse-Proxy, wenn der
  tatsächliche TCP-Peer Loopback ist, der Proxy
  `X-Forwarded-Proto: https` als **einzelnen** Wert überschreibt und
  Express den Proxy als vertrauenswürdig anerkennt (`req.secure=true`).

**Direktes HTTP aus dem LAN wird auch bei gültigem Bearer-Token mit 403
verweigert.** Behauptete HTTPS-Verbindungen von fremden IP-Adressen,
widersprüchliche oder fehlende Forwarded-Header und Proxy-HTTP werden
ebenfalls verweigert. Diese 403-Antwort enthält keine Token, Dateipfade,
GeoTIFFs oder Geräteinformationen.

Wichtig: Ein Backend kann **nicht nachträglich verhindern**, dass ein
falsch konfigurierter HTTP-Client den Token bereits auf dem Transportweg
im Klartext gesendet hat. Daher weiterhin nur HTTPS-/Loopback-Clients
zulassen und am öffentlich erreichbaren Ingress HTTP auf HTTPS umleiten
**bevor** Authentifizierungsdaten übertragen werden. Ein Reverse-Proxy
muss clientseitige `X-Forwarded-*`-Header ersetzen und darf den privaten
Backend-Port nicht im LAN veröffentlichen. HTTPS-Proxy-Hop über
nicht-lokale private Netze ist hier absichtlich nicht freigegeben.

Offline regression:

```bash
node --test backend/test/m3m-catalog-transport.test.js
node --test backend/test/smart-farming-catalog.test.js \
  backend/test/smart-farming-catalog-http.test.js \
  frontend/test/smart-farming-ui.test.js
```

Die vorhandene M3M-Acceptance-CI enthält diese Tests zusätzlich. Der
opt-in-Katalog bleibt standardmäßig deaktiviert; ein Test-Erfolg ist
**keine** Kalibrierungs-, Agronomie- oder Missionsfreigabe.

## Multispektral-Aufnahmen (seit 01.11.2026)

**Bewertungsvertrag v2:** Die nachfolgende Beschreibung dokumentiert den
ursprünglichen v1-Stand und damalige Bestandsbeobachtungen. Für die aktuelle
Implementierung gelten die strengere [Capture-Bewertung und Manifest-v2-Semantik](smart-farming-m3m-capture-assessment.md).
Die UI unterscheidet eindeutige Bandvollständigkeit von Metadaten-Kandidaten;
„auswertbar“ ist keine aktuelle Freigabebezeichnung. Ein Update ist kein Pi-Nachweis.

Die Smart-Farming-Seite zeigt oberhalb des Katalogs alle **Mavic-3M-Aufnahmen** aus MinIO (`GET /api/smart-farming/captures`, Heimnetz ohne Anmeldung, nur lesend). Jede Band-TIFF wird über ihren XMP-Kopf (erste 64 KB) erkannt, nicht über den Dateinamen. So werden Bänder einer Aufnahme über die **CaptureUUID** zusammengeführt, auch wenn sie aus verschiedenen Quellen stammen (SD-Import `DJI_…_MS_G/RE.TIF` und Pilot-2-Upload `org_<fingerprint>_<ms>.tiff` für R/NIR).

Je Aufnahme: Vollständigkeit der Bänder G/R/RE/NIR, Sonnensensor (Irradiance), GPS, Höhe über Start, Bewertung **auswertbar** (alle vier Bänder, Tageslicht) mit Hinweisen (kein GPS, am Boden aufgenommen), Download der Bänder und – falls vorhanden – die NDVI-Vorschau und Indexwerte (NDVI/GNDVI/NDRE) aus `farming/ms-preview/` der früheren Pipeline (15.10.2026).

`GET /api/smart-farming/captures/manifest` liefert ein JSON-Manifest (`skyhub-m3m-capture-manifest-v1`) mit Objektverweisen, Größe, ETag, Wellenlänge und Irradiance je Band als Eingang für die Orthomosaik-/Kandidaten-Pipeline (DEDAL/ODM → `m3m_smart_farming_candidate.py` → Katalog).

**Bestand am 01.11.2026:** 4 Aufnahmen, alle Bänder vorhanden. 3 auswertbar (15.10.2026, 14:02:40–14:03:06, Gartenszene vom Boden, NDVI-Median 0,56–0,57), 1 nicht auswertbar (01.10.2026, 22:38, Nachtaufnahme ohne Sonnenlicht und GPS). Keine Mapping-Flüge: für Karten und Katalog-Kandidaten ist ein Mavic-3M-Flug mit Überlappung nötig.
