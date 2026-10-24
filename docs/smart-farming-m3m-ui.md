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
