# SkyHub Smart Farming P3.4 – private COG-Konvertierung, strukturierte Abnahme, zweiter TIFF-Decoder

Stand: 24. Oktober 2026. **Isoliertes P3.4-Labor, Draft auf P3.3 #125 → P3.2 #122 → #117 → #116 → #115 → #114 → #113 → #104.** Keine Änderungen an `main`, Pi, Server-HTTP, MQTT, DJI, Agras oder Frontend.

## Zweck und Grenzen

`backend/workers/m3m_private_cog_export.py` konvertiert **ausschließlich** eine unabhängig per SHA-256 gepinnte und geprüfte Ausgabe des P3.3-Polygonschnitts in acht verlustfreie, numerische GeoTIFFs im **Cloud Optimized GeoTIFF (COG)**-Layout. Das ist keine radiometrische DJI-Sensorvalidierung, kein automatischer QGIS-/Agras-Workflow und kein freier oder signierter Download.

**COG ≠ freigegebene Messung.** `cloudOptimizedGeoTiff=true` bestätigt in diesem Manifest nur GDAL-COG-Layout, Tiling, Pixel-/CRS-Readback und IFD-Dekodierung. `radiometricCalibrationVerified=false`, `reflectanceReady=false`, `ndviReady=false`, `ndreReady=false`, `operationalUseAllowed=false`, `prescriptionExportAllowed=false` und `flightMissionAllowed=false` bleiben ausdrücklich bestehen.

## Vertrauenskette und privater P3.3-Export

1. Ein **unabhängig gespeicherter** 64-stelliger `sourceManifestSha256` bindet das exakte JSON von `export-manifest.json` aus dem vorherigen P3.3-Export. Den Pin **niemals aus dem gerade gelieferten Manifest selbst ableiten**.
2. Die Eingangskontrolle erfordert kanonisches JSON ohne doppelte Schlüssel und nur bekannte Felder. Sie prüft die Quelle als privates 0700-Verzeichnis, genau acht unveränderte Float32-GeoTIFFs, `statistics.csv` und `export-manifest.json`; bekannte Hashes und Größen müssen vor Beginn übereinstimmen.
3. Der GDAL-COG-Treiber (`rasterio.shutil.copy(..., driver='COG')`) erzeugt DEFLATE-komprimierte 256er-Kacheln mit den nötigen Pyramid-/Overview-Ebenen großer Raster. Es findet **keine** Palette-/PNG-Quantisierung und keine CRS-Reprojektion statt. Numerische Werte bleiben bitgenau.
4. **Zwei voneinander getrennte Decoder:** GDAL/Rasterio verlangt `IMAGE_STRUCTURE.LAYOUT=COG`, rechteckige Georeferenzierung, identischen CRS/Transform/NoData und Pixelidentität. `tifffile` prüft die TIFF-Tile-Tags und dekodiert denselben ursprünglichen Float32-Datenblock unabhängig. Die COG-Quelldaten verwenden DEFLATE ohne TIFF-Float-Predictor, um den zweiten Decoder ohne zusätzliche `imagecodecs`-Abhängigkeit betreiben zu können.
5. Nach der Konvertierung werden alle Eingangsdateien samt unabhängigem Manifestpin **erneut** geprüft. Jeder neue COG erhält eine eigene SHA-256-Prüfsumme im letzten, kanonisch geschriebenen `cog-manifest.json`. Sämtliche Dateien sind 0600, der Zielordner 0700. Ein bereits vorhandenes Ziel wird nicht überschrieben; normale Fehler löschen den unvollständigen Zielordner.

## Lokaler, rein privater Operator-Aufruf

~~~bash
python3 backend/workers/m3m_private_cog_export.py \
  --input-dir /privat/gepruefter-p3.3-polygonexport \
  --source-manifest-sha256 <unabhaengiger-64-stelliger-sha256> \
  --output-dir /privat/neue-cog-ausgabe \
  --private-output-ok
~~~

Das Platzhalter-Token ist kein realer Pin. Quelle und Ziel müssen getrennte, zugriffsgeschützte Verzeichnisse sein. Der neue Ausgabeordner darf nicht bereits existieren. Ausgangsdateien sind `red.cog.tif`, `green.cog.tif`, `red_edge.cog.tif`, `nir.cog.tif`, `ndvi.cog.tif`, `ndre.cog.tif`, `gndvi.cog.tif`, `osavi.cog.tif` und `cog-manifest.json`.

Der Terminal-Report gibt nur Anzahl, einen extern verwahrbaren Manifest-Hash und bewusst nicht freigegebene Einsatzflags aus. Im JSON-Manifest stehen Hashes für Quellmanifest und Quell-Siegel, Polygonauswahl, acht COGs, Abmessungen und Struktur-/Readback-Prüfungen; keine privaten absoluten Dateipfade. Die TIFFs enthalten dagegen **sensible Georeferenzierung** und müssen unter den Zugriffsrechten des Workspace bleiben. Sie dürfen nicht in `frontend/public/`, freie Browser-Verzeichnisse, GitHub oder öffentliche S3-Buckets gelangen.

## Testumfang

`tests/test_m3m_private_cog_export.py` baut seinen Input wirklich über den bestehenden P3.3-Exporter auf einem synthetischen, unabhängig versiegelten M3M-Bundle. Es prüft acht numerische COGs inklusive float32, CRS, GeoTransform, NoData, Hashes, Dateirechten und zweifachem TIFF-Decoding. Zusätzliche Testfälle: keine Privatsphärenfreigabe, vorhandener Zielordner, falscher Manifestpin, manipulierte TIFF-Datei, unerwartete Dateien, Symlinks, gefälschte Betriebsfreigabe, Änderung nach Konvertierung und ein größeres 768×768-Testbild mit tatsächlich erzeugten GDAL-Overviews.

## Externe/noch offene Abnahme

Der Laborcheck ist **noch keine externe QGIS-GUI-Abnahme**. Für das spätere Release muss zusätzlich ein unabhängiger QGIS-Import und – falls auf dem Zielsystem vorhanden – `gdal driver cog validate --full-check yes` bzw. ein zur installierten GDAL-Version passender COG-Validator durchgeführt werden. GDAL <3.13 hat noch nicht den neuen `gdal driver cog validate`-Befehl. Die neu hinzugefügte lokale Validierung ersetzt auch keine Rechte-/Workspace-/Field-ACL, keinen cgroup-isolierten Worker und keine realen DJI-M3M-Originaldaten mit DLS-/Panelreferenz und Bandregistrierungsprüfung.

Die CI des isolierten M3M-Projekts führt Python-Synthetiktests und Node-HTTP-Verträge weiter aus. **Keine Bereitstellung** auf dem Pi oder Aktivierung einer GIS-/Karten-URL durch diesen PR.
