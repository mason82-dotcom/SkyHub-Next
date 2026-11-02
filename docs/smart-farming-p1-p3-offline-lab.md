# SkyHub-Next Smart Farming – P1–P3 Offline-Entwicklungsstand

Stand: 02.11.2026. Aus Draft #113 isoliert auf die aktuelle `main`-Rasterbasis übertragen. Nur lokale Offline-Worker und synthetische Tests; **nicht auf dem Pi bereitgestellt**.

## P1: echter TIFF-Payload, aber nur lokale Herkunftshinweise

- Neuer Offline-Worker: backend/workers/m3m_source_capture_receipt.py
- Benötigt exakt vier lokale uint16 TIFFs G/R/RE/NIR; bestehender Auditor dekodiert den Payload und prüft begrenzte XMP-/CaptureUUID-Hinweise.
- Hash der unveränderten Eingabebytes je Band; keine Aufnahmezeit, CaptureUUID, GPS, Dateinamen oder Pfade im JSON-Report.
- Optionales JPEG wird nur auf Signatur, Bytezahl und Hash geprüft, nicht decodiert oder einer Aufnahme geometrisch zugeordnet.
- Keine Kopie in MinIO, keine DB-Migration, kein Netzwerk und kein Live-Upload. Alle Kalibrierungs- und Betriebsfreigaben bleiben false.

Offline Beispiel (nur separate Testkopie):

~~~bash
python3 backend/workers/m3m_source_capture_receipt.py \
  --tiff /isoliert/G.tif --tiff /isoliert/R.tif \
  --tiff /isoliert/RE.tif --tiff /isoliert/NIR.tif \
  --rgb /isoliert/RGB.jpg
~~~

Dieser Receipt belegt lokal decodierte Bilddaten und XMP-Gruppenhinweise, aber keine DJI-Authentizität und keine Radiometrie.

## P2: vorhandene experimentelle Rasterpipeline auf `main`

- Die Worker m3m_dedal_ortho_handoff.py und m3m_reflectance_indices.py erzeugen aus einem extern vorbereiteten GeoTIFF vier Bandraster und NDVI/NDRE/GNDVI/OSAVI.
- m3m_raster_bundle_verify.py prüft Pixelmathematik, NoData, CRS/Grid und Reportstatistik unabhängig.
- m3m_raster_bundle_seal.py prüft die SHA-256-Artefakte mit einem unabhängig gepinnten SHA256-Beleg. Hash ist keine Signatur.
- Echte DJI M3M-Kalibrierung (BlackLevel/Gain/Exposure/Vignettierung/DLS/Panel), bandübergreifende physikalische Registrierung, ODM-/Terra-Vergleich und M3M-Hardwarevalidierung fehlen weiterhin.
- Keine Ableitung einer Dünge- oder Spritzmenge und keine operativen Ready-Flags.

## P3: nichtöffentliche numerische Pixel-/ROI-Analyse

- Neuer Worker: backend/workers/m3m_offline_roi.py. Nur lokale Aufrufe; kein HTTP, keine Kartenkacheln, keine externen Zugriffe.
- Input: experimentelles M3M-Bundle, externer Seal und separat aufgezeichneter Seal-SHA256.
- Vor und nach Rasterzugriff muss die vollständige unabhängige Artefakt- und Pixel-QA bestehen.
- Rechteck in 0-basierten Raster-Pixelkoordinaten, Start inklusive, Ende exklusiv, maximal 250.000 Pixel.
- Ergebnis für acht numerische Raster: Valid-/NoData-Zahlen, Mittelwert, Min/Max, Median, P10/P90 und Standardabweichung; keine Koordinaten oder Pfade im Report.
- Bandfraktionen sind operatorbehauptet und nicht absolut kalibriert.

Offline Beispiel:

~~~bash
python3 backend/workers/m3m_offline_roi.py \
  --bundle /isoliert/bundle \
  --seal /extern/receipt.json \
  --seal-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --row0 100 --col0 100 --row1 200 --col1 200
~~~

Den beispielhaften SHA256 unbedingt durch einen tatsächlich unabhängig ermittelten Pin ersetzen. Für ein einzelnes Pixel Ende = Start + 1.

## Tests und offene Abnahme

- Tests: tests/test_m3m_source_capture_receipt.py und tests/test_m3m_offline_roi.py. Synthetic-only; die ROI-Seal-Abstraktion wird in Unit-Tests bewusst gemockt.
- Die bestehende Offline-Testhülle scripts/m3m-offline-verify.sh umfasst beide Dateien wegen des Glob-Musters test_m3m_*.py.
- Testaufruf in isoliertem Worktree nach separater Installation der optionalen Raster-Abhängigkeiten: python3 -m unittest discover -s tests -p 'test_m3m_source_capture_receipt.py' -v; und analog test_m3m_offline_roi.py.
- Für diesen isolierten Übernahme-PR sind `m3m-raster-integration` und der allgemeine Python-Testlauf erforderliche Abnahmebedingungen. Ein bestehender CI-Lauf ersetzt keine echte M3M-Kalibrierung.

Vollständige P1-P3 erfordern weiterhin: persistenten, berechtigten Originaldaten-Upload; echten M3M-/Panel-Datensatz und radiometrischen Nachweis; eigenen Orthomosaik-Worker; abgesicherte serverseitige Punkt-/Feld-API, COG-/Tile-Abruf, mobilen GIS-Editor, numerische GeoTIFF-Exporte und unabhängige Abnahme mit QGIS/GDAL.

Die ausschließlich offline verwendbaren Worker und Tests können nach bestandener CI auf `main` aufgenommen werden. **Kein** Pi-Deployment, keine Änderung von Docker, DJI Cloud, MQTT, S3, PostGIS oder `backend/server.js`; keine Flugfreigabe.
