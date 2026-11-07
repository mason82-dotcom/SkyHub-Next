# SkyHub Smart Farming P3.3 – geschützter numerischer GIS-Export

**Stand 02.11.2026.** Separat aus dem historischen Draft #125 auf aktuellen `main` konsolidiert; die abhängigen P3.2- und P3.1-Laborbausteine liegen bereits in `main` (PRs #236/#234). **Nur lokaler Offline-Code und synthetische Abnahme.** Keine Änderung an Raspberry Pi, `server.js`, Compose, MQTT, PostGIS, Pilot 2, S3, DJI oder Agras.

## Warum dieser Export?

Die P3.2-Karte verwendet bewusst kolorierte, nichtnumerische PNGs. Deren Pixel sind **keine** ursprünglichen NDVI-/NDRE-Messwerte. Das neue Tool `backend/workers/m3m_private_numeric_gis_export.py` liest stattdessen die acht **numerischen Float32-GeoTIFFs** des bereits unabhängig verifizierten Offline-Rasterbundles, schneidet eine **private WGS84-Polygonfläche** aus und erzeugt neue georeferenzierte GeoTIFF-Dateien und eine CSV-Statistik. Keine Crop-Berechnung aus RGB-Pixeln.

## Ein- und Ausgangsvertrag

- Eingaben: experimenteller, unabhängig versiegelter 11-Dateien-Rasterbundle-Ordner; extern verwahrter SHA-256-Pin des Siegels; lokale private GeoJSON-Datei mit **einfacher, geschlossener Polygongeometrie**; neuer leerer Output-Pfad unter einem 0700-Verzeichnis.
- Die GeoJSON- und Polygonvalidierung wird aus `m3m_private_gis_query.py` übernommen. Der Worker begrenzt die Polygon-Koordinatenspanne, die Anzahl der Vertices und das tatsächliche Pixel-Fenster auf **maximal 250.000 Pixel**. Point-/MultiPolygon-/Feature-Objekte oder Polygonlöcher werden abgewiesen.
- Vor und nach den Rasterzugriffen: voller, unabhängig gepinnter 11-Artefakte-Seal- und numerischer Pixel-/NoData-/Indexformel-Check. Geometriebytes werden per SHA-256 ebenfalls nachgeprüft.
- Ausgabe nur nach `--private-output-ok`. Neu angelegtes Verzeichnis 0700 und 0600-Dateien: `red.tif`, `green.tif`, `red_edge.tif`, `nir.tif`, `ndvi.tif`, `ndre.tif`, `gndvi.tif`, `osavi.tif`, `statistics.csv`, `export-manifest.json`.
- Jedes TIFF enthält weiterhin das **echte CRS und den aktualisierten Crop-Geotransform**, genau einen Float32-Datenkanal und `NoData=-9999`. Werte bleiben Pixel für Pixel unverändert, nur außerhalb des Auswahlpolygons werden sie maskiert. DEFLATE-Kompression, numerische Readback-Prüfung und unabhängige SHA-256-Hashes pro Ausgabe.
- `statistics.csv` enthält je Layer valide/maskierte Pixel, Min/Max, Mean/Median/P10/P90/StdDev. Ein maschinenlesbares Manifest trägt die SHA-Pins von TIFF/CSV, Polygon-/Quellbeleg-Hashes, Rastergrößen, `sourceRasterIntegrityRechecked=true`, sensible Geo-Information und **alle Einsatz-/Kalibrierungsflags false**. Das Manifest wird **zuletzt** geschrieben: Ein abgebrochener Export ohne korrekt gepinntes Manifest gilt nicht als abgeschlossen.
- Der CLI-stdout liefert nur den **Manifest-Hash** und eine grobe Zählung; keine georeferenzierten Bounds, private Pfade oder eigentlichen Feldpositionen. Die Dateien selbst enthalten zwangsläufig sensitive Feldkoordinaten und dürfen niemals im öffentlich erreichbaren `frontend/public` oder fremden Cloud-Share liegen.

## Isolierter Aufruf

~~~bash
python3 backend/workers/m3m_private_numeric_gis_export.py \
  --bundle /isoliert/private-m3m-bundle \
  --seal /isoliert/extern-gepinnter-seal.json \
  --seal-sha256 <unabhaengiger-64-stelliger-sha256> \
  --geometry-file /isoliert/private-feldpolygon.json \
  --output-dir /privat/numerischer-export-001 \
  --private-output-ok
~~~

Der SHA-Platzhalter ist ein Beispiel, kein ausführbarer Wert. Ein Export sollte lokal mit **QGIS** oder einem unabhängigen GDAL-Rasterleser geprüft werden. Vor dem Vergleich auf gemeinsame CRS, Masken, Pixelmittelpunkte und die tatsächlich extern behauptete radiometrische Reflektanz-Kalibrierung achten.

## Fachliche und technische Einschränkungen

**Die GeoTIFFs sind nicht als Cloud Optimized GeoTIFF (COG) zertifiziert** und enthalten keine automatisch veröffentlichten HTTP-Kacheln; `cloudOptimizedGeoTiff=false` bleibt ausdrücklich. Die CSV-Statistik berücksichtigt Pixelmittelpunkte (`all_touched=False`) und ist nicht flächengewichtet oder als agronomische Hektarberechnung verwendbar. Der Export enthält keine Dünge-/Agras-Applikationskarten und keine Flugmissionsdaten.

**Nicht als DJI-M3M-Hardwarevalidierung verstehen:** Synthesetests können Pixel- und Georeferenzierungslogik beweisen, aber weder Sensorkalibrierung noch BlackLevel-/DLS-/Panel-/Vignettierungskorrektur, Bandregistrierung oder Originalherkunft der Aufnahmen.

## Qualitätssicherung

`tests/test_m3m_private_numeric_gis_export.py` ergänzt den vorhandenen M3M-Offline-Workflow: Es nutzt tatsächlich erzeugte synthetische Rasterio-GeoTIFFs sowie einen unabhängig erzeugten Seal, prüft alle acht GeoTIFF-/CSV-Ausgaben, CRS, Masken, volle und partielle Feldpolygon-Crops, Dateirechte, Hashes, Nichtüberschreibung, Einwilligung, ungültige geometrische Anfragen und Veränderungen der Quelldaten vor und während des Exports.

**Nächste Gates:** echte Panel-/DLS-kalibrierte M3M-Datensätze, unabhängiger QGIS/GDAL-Reimport gegen Referenzraster, persistentes Workspace-/Asset-RBAC, sicherer Export-Download mit Autorisierung, separater COG-Pipeline mit GDAL-COG-Validierung, Ratenbegrenzung und Reproduzierbarkeits-/Versionsprüfung. Produktives Frontend bleibt bis dahin unverändert.

**Zusätzliche Pfadprüfung:** Die Konsolidierung lehnt vor dem Schreiben verschachtelte Symlink- und nichtkanonische Pfadanteile für Quellbundle, Siegel, GeoJSON und Export-Elternverzeichnis ab. Der Negativtest deckt einen Alias auf ein Verzeichnis im versiegelten Quellbundle ab. Diese Prüfung ist kein Ersatz für eine später nötige betriebssystemseitige `openat`-/Prozessisolation gegen konkurrierende Pfadänderungen.
