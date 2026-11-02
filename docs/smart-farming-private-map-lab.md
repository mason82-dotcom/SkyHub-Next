# SkyHub Smart Farming P3.2 – private interaktive Vegetationskarte (isoliertes Labor)

**Stand 02.11.2026.** Separat aus historischem Draft #122 auf dem aktuellen `main`-Stand konsolidiert, nach Übernahme der vorausgehenden P3-Worker in PRs #229–#234. **Nur Quellcode und synthetische Laborprüfung; kein Pi-Deployment und keine aktivierte Raster-/GIS-API.**

## Umfang

Das P3.2-Labor liefert ein **reales, georeferenziertes** Kartenpaket aus der bestehenden numerischen experimentellen M3M-Rasterpipeline. Anders als eine normale PNG-Vorschau trägt das **separat gespeicherte private Manifest** die genaue Web-Mercator-Abbildung des erzeugten Rasterbilds. Kartenklicks werden aus dieser Abbildung nach WGS84 transformiert; es werden keine Koordinaten aus RGB-Farben erraten und keine Pixelwerte aus eingefärbten Bildern rekonstruiert.

### Vertrauenswürdige Ausgangsdaten

`backend/workers/m3m_private_mercator_map_lab.py` liest nur einen vollständig unabhängig gepinnten und bereits mathematisch validierten Rasterbundle auf aktuellem `main`. Vor und nach der Vorschaugenerierung prüft es das 11-Dateien-Siegel sowie die Pixelmathematik erneut. GeoTIFF-Indexwerte werden einzeln nach EPSG:3857 reprojiziert (Rasterio, Nearest, NoData transparent), bei höchstens 512 Bildpunkten je Achse und identischen Layer-Bounds für NDVI/NDRE/GNDVI/OSAVI. Das Web-Mercator-Manifest wird als letzter Commitmarker geschrieben.

Im privaten Zielordner entstehen ausschließlich `ndvi.png`, `ndre.png`, `gndvi.png`, `osavi.png` und `viewport.json`. 0700 Zielverzeichnis, 0600 Dateien, keine Überschreibung. Das Manifest trägt unveränderliche 64-Hex-SHA-256-Pins der vier PNG-Dateien, die Web-Mercator-Bounds, die Bilddimensionen und den unabhängig geprüften Quell-Siegel-Hash. Die Terminalausgabe trägt den SHA-256-Pin des kompletten `viewport.json`.

**Datenschutz:** PNG-Farben können Feldmuster erkennen lassen. `viewport.json` enthält ausdrücklich **sensible Georeferenzierung**. Beide bleiben privat. Nicht in `frontend/public`, GitHub, Cloud-Shares oder ungeschützte Verzeichnisse kopieren. Selbst ein SHA-Pin beweist Integrität unter der gewählten Vertrauensannahme, aber keine DJI-Sensorherkunft und keine wissenschaftliche Kalibrierung.

### Lokale Erzeugung (nur isolierter Entwicklerrechner und nach vorliegendem Bundle)

~~~bash
python3 backend/workers/m3m_private_mercator_map_lab.py \
  --bundle /privat/m3m/experiment-bundle \
  --seal /privat/sha-receipt.json \
  --seal-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --output-dir /privat/geschuetzt/ndvi-map-001 \
  --private-output-ok
~~~

Den **Beispiel-Hash** durch den realen unabhängig festgehaltenen Receipt-SHA ersetzen! `/privat/geschuetzt` muss als 0700-Verzeichnis existieren. Das erzeugte `viewport.json` wird mit dem beim Lauf ausgegebenen `manifestSha256` separat gepinnt. Ergebnisdateien gehören keinesfalls in den statisch ausgelieferten Web-Ordner.

### Interaktive helle Kartenoberfläche

`frontend/public/smart-farming-map-lab.html` und `frontend/public/smart-farming-map-lab.js` sind eine eigenständige, helle Oberfläche, über den Metadaten-Smart-Farming-Tab verlinkt. Die Seite lädt **keine Kartenquelle automatisch**. Der Betreiber wählt alle fünf Dateien als lokale Browser-Dateien aus und trägt den Manifest-SHA aus einer unabhängig aufbewahrten Quelle ein. Der Browser prüft SHA-256 jedes Byte-Payloads, Dateisignatur und Bildmaße; Daten werden nicht an einen Server gesendet.

Die Meta-`Content-Security-Policy` begrenzt `connect-src` auf `none`, erlaubt nur gleichursprüngliche Skripte und die geprüften Bilder als `blob:`. Ein `frame-ancestors`-Schutz muss bei einer späteren Bereitstellung als **HTTP-Response-Header** gesetzt werden; eine Meta-CSP kann dies nicht leisten. Keine Tile-Requests, kein lokaler Storage, kein Cookie-/Token-Verbrauch, keine MinIO-Links, kein GPS-Logging. Über die vier Layer kann gewählt werden. Punkt- und Polygonwerkzeug erzeugen einen lokalen JSON-Entwurf des API-Schemas `skyhub-m3m-geospatial-request-v1`, mit korrekt inverser Web-Mercator/WGS84-Umrechnung. Nutzer können GeoJSON explizit kopieren, ohne eine API-Aktion auszulösen.

Das Zeichnen von Polygoneckpunkten ist zunächst ein **Geometrieentwurf**, keine Agrarflächenmessung. Die Backend-Seite (#115) führt ihre eigene vollständige Polygonvalidierung aus. Die spätere HTTP-Verbindung (#116/#117) bleibt ohne echte Workspace- und Datenasset-Berechtigung **nicht eingebunden**.

## Prüfung und Grenzen

- `tests/test_m3m_private_mercator_map_lab.py`: echte synthetische GeoTIFFs, Web-Mercator-Rasterio-Reprojektion, Bild-/Manifest-/Dateihashes, Zielrechte, keine Überschreibung, manipulierter Quell-Seal, Mutation nach erster QA und Ablehnung ohne private Freigabe.
- `frontend/test/smart-farming-map-lab.test.js`: Modell-/CSP-Verträge, fehlerhafte Readiness, Projektion, WGS84-Point/Polygon-Mathematik, SHA-Prüfung von Manifest und PNG sowie fehlender externer Datenverkehr. **Noch keine echte Chrome-/Android-Browser-E2E-Abnahme.**
- Die isolierte M3M-CI prüft die Tests; ein grüner CI-Lauf belegt nur die synthetische Kette und kein DJI-Kalibrierungszertifikat.

## Noch offen vor produktiver Karte

Die Schicht aus Field-/Workspace-RBAC, Asset-/Raster-Pinning, geschützten Kartenkacheln oder signierten privaten API-Downloads, OpenLayers/Leaflet-Map-Rendering mit Basiskarten-Lizenzen und gesperrtem Drittanbieterverkehr, Touch-/Android-A11y, CSP/CSRF, Projektions-Sonderfälle sowie echte Pixelvergleiche mit kalibrierten M3M-Aufnahmen und DJI Terra/ODM fehlt weiterhin. Numerische ROI-Werte liefert nur der separat geschützte Python-Worker, niemals die PNG-Datei. Geplante GIS-Exporte benötigen eine unabhängige Abnahme.

**Alle operativen Freigaben bleiben `false`:** keine Dünge-, Spritz-, Agras-, Flug- oder Fernsteuerungsfunktion. Keine Änderungen an `backend/server.js`, Docker, MQTT, DJI Cloud API, Pilot 2, MinIO oder PostGIS.

**Zusätzliche Absicherung dieser Konsolidierung:** Der Offline-Worker verweigert nichtkanonische und über verschachtelte Symlinks aufgelöste Quell-, Siegel- und Ausgabepfade, bevor das Zielverzeichnis erstellt wird. Ein synthetischer Regressionstest prüft den Alias auf ein privates Unterverzeichnis des versiegelten Rasters.
