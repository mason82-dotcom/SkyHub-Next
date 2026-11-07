# SkyHub Smart Farming – P3.1: echter HTTP→Python-Rasterio-Adapter (isoliertes Labor)

**Stand:** 02.11.2026 · Quellcode-Konsolidierung aus Draft #117 auf aktuellen `main`, nachdem die ungemountete GIS-HTTP-Vertragsbasis als PR #233 integriert wurde. **Keine produktive API-Aktivierung und keine Bereitstellung auf dem Raspberry Pi.**

## Lieferumfang

`backend/smart-farming-raster-provider.js` ist ein realer, separat injizierbarer Node-Provider für `createSmartFarmingGeoRouter` auf `main`. Er ruft `backend/workers/m3m_private_gis_query.py` per `child_process.execFile` ohne Shell auf. Der Python-Worker verarbeitet **tatsächliche numerische Float32-GeoTIFFs** mit Rasterio und überprüft das komplette unabhängig gepinnte SHA-256-Siegel **vor und nach** dem Lesen; die synthetische Fixture prüft P2-Pixelmathematik und G/R/RE/NIR-, NDVI-/NDRE-/GNDVI-/OSAVI-Statistik.

Das ist erstmals eine **wirklich ausgeführte** HTTP→Python→GeoTIFF→numerische JSON-Antwortkette. Sie verwendet jedoch ausschließlich synthetische Pixel und eine separat gestartete Loopback-Testinstanz – keine DJI-Aufnahmen, keine produktiven User, kein echtes Workspace-RBAC und keine Objektspeicher-/Datenbankanbindung.

## Trust Boundary und private Pfade

- Der Client darf **nur** `candidateId` und WGS84-Point bzw. ein einfaches Polygon übergeben; es gibt weder `--bundle` noch `--seal` oder Dateipfade im HTTP-Body.
- Der Router benötigt vorher `authenticate`, `scopedPrincipal` und `authorizeWorkspaceCandidate`, die unabhängig und serverseitig entscheiden. **Erst danach** wird der Provider aufgerufen.
- `resolveRegisteredAsset({principal,candidateId})` muss vom späteren autoritativen Workspace-/Asset-Repository bereitgestellt werden. Der Provider akzeptiert nur ein strukturell exaktes, servereigenes Ergebnis mit `candidateId`, `workspaceId`, `bundleDir`, `sealFile`, `sealSha256`; Workspace-/ID-Gleichheit und der Hash-bezogene Kandidatenname müssen stimmen. Fehlende oder manipulierte Einträge werden abgewiesen.
- Drei separate, private Rootverzeichnisse (`sourceRoot`, `sealRoot`, `scratchRoot`) mit eingeschränkten Zugriffsrechten; nur kanonische absolute Pfade und nur erlaubte Dateien darunter. Symlink-/Ausbruchsmuster sowie überschreibbare Pfadnamen werden abgewiesen. Der Python-Prozess erhält keine vom Browser zusammengebauten Shell-Befehle.
- Die GeoJSON-Anfrage liegt für die Dauer eines Aufrufs in einem exklusiven privaten temporären Ordner. Datei mit 0600 und Verzeichnis 0700; anschließend werden temporäre Daten entfernt. `timeoutMs` 1–30 Sekunden, Standard 15 Sekunden; begrenzter Standardoutput; eingeschränkte Python-/GDAL-Umgebung ohne Kopie des gesamten Node-Umgebungsvariablensatzes.
- Der Provider gibt einen Python-Bericht nur an den aufrufenden, weiter validierenden Router zurück. Der Router veröffentlicht ausschließlich Whitelist-Statistiken und nie private Pfade, Pixelkoordinaten oder Eingangsgeometrien.

**Sicherheitsbegrenzungen:** Dieser Prototyp implementiert selbst **keine persistente Workspace-RBAC-Registry**, keine unabhängige Benutzerverwaltung, keine Prozess-/Speicherisolation per cgroup/Container, keine Netzwerkisolation des Child-Prozesses, keine vollständige Symlink-/Race-Proof-Openat-Strategie und keinen anwendungsübergreifenden Rate-Limiter. Die bestehende Router-Parallelitätsbegrenzung ist nur pro Routerinstanz wirksam. Er darf deshalb **nicht** in die laufende Express-App eingehängt werden.

## Reale Datenverarbeitung im synthetischen Integrationstest

Die Fixture `tests/m3m_geo_http_fixture.py` erzeugt acht tatsächlich geschriebene GeoTIFF-Dateien (G/R/RE/NIR/NDVI/NDRE/GNDVI/OSAVI), Qualitätsreports und ein neues SHA-256-Siegel. Anschließend werden in `backend/test/smart-farming-python-provider.integration.test.js` über den echten lokalen Express-Server HTTP-Abfragen an den Node-Provider gesendet. Dieser startet den realen Python-Worker und liefert ausgefilterte statistische Ergebnisse.

Die Tests umfassen unter anderem: autorisierten WGS84-Punkt mit NDVI≈0,5 und NDRE≈0,2, Polygon mit sechs abgedeckten und fünf gültigen Pixeln, verweigerte Workspace-/Token-Zugriffe, fehlende oder veränderte Belege, manipulierte GeoTIFFs, symlink-basierte Pfadmanipulation sowie verlässlich geleerte temporäre Query-Verzeichnisse.

Der allgemeine Node-/Main-CI-Lauf **überspringt** die optionalen echten Raster-Subprozesstests; ausschließlich der isolierte M3M-Rasterjob installiert Python 3.12 + NumPy/Rasterio und Node 22 und aktiviert den Lauf mit `SKYHUB_M3M_REAL_RASTER_PROVIDER_TEST=1`. Eine erfolgreiche CI beweist genau diesen synthetischen Datendurchlauf, **nicht** die Mavic-3M-Rohdatenkalibrierung.

## Fehlende produktive Freigabegates

1. Authentisierte, serverseitig gepflegte Workspace-/Feld-/Asset-Registry mit unabhängigen Lese- und Freigaberechten sowie festen, versionierten und schreibgeschützten Objektidentitäten.
2. Isolierter Jobdienst/Container mit CPU-/RAM-/Datei-/Netzwerkquoten, Retry-/Queue-/Audit-System, konsistenten Asset-/Seal-Pins und kontrolliertem Cache.
3. Validierung echter Mavic-3M-TIFFs inklusive DJI-Kalibrierungsmetadaten, DLS und Referenzpanel sowie unabhängiger Bandregistrierungs-/Orthomosaik-Qualität.
4. Geprüfte COG-/Tile-Ausgabe (GPS-Metadaten als vertraulich behandeln), browserseitige Karteninteraktion und Android-/HTTPS-/CSRF-/CSP-Sicherheitstests.
5. GIS-Export mit QGIS-/GDAL-Wiederimport, reproduzierbarem Raster- und Quellenmanifest. Agras-/Dünge-/Missionsfunktionen bleiben bis zum gesonderten Agronomie-Gate gesperrt.

**Live-Verhalten:** `backend/server.js`, `.env`, Docker Compose, PostgreSQL, MQTT, DJI Cloud API, Pilot 2 und Smart-Farming-Webfrontend bleiben unverändert. Die Laborintegration darf weder automatisch auf dem Pi deployed noch in `backend/server.js` eingebunden werden. Das isolierte CI prüft den echten HTTP→Python→Rasterio-Testweg mit synthetischen Daten explizit; die normale Backend-CI führt ohne optionale Rasterpakete nur die statische Nicht-Mount-Prüfung aus.
