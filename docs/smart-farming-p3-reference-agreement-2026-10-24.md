# SkyHub Smart Farming P3.5a – unabhängiger quantitativer M3M-Referenzvergleich

**Stand 24.10.2026 · isoliertes Draft-Inkrement auf P3.4 #128 → P3.3 #125 → P3.2 #122 → #117 → #116 → #115 → #114 → #113 → #104.** Kein Merge und keine Änderungen an Pi-/DJI-/MQTT-/MinIO-/Agras-Diensten.

## Ziel

Der Offline-Worker `backend/workers/m3m_private_reference_agreement.py` vergleicht die **vier experimentellen Float32-Reflektanzraster** (Red, Green, Red Edge, NIR) eines *unabhängig SHA-256-versiegelten* M3M-Rasterbundles mit vier von außen gelieferten **Referenz-GeoTIFFs** auf exakt demselben Rastergrid. Ausgangslage: die existierende SkyHub-Indexformelprüfung (NDVI/NDRE/GNDVI/OSAVI) validiert mathematische Konsistenz, aber **keine radiometrisch korrekte Aufnahme**. Der neue Quervergleich erlaubt erstmals eine messbare Abweichungsanalyse ohne Eigenkalibrierungsbehauptung.

**Dieser Vergleich bescheinigt ausdrücklich keine unabhängige Herkunft:** Jedes vom Betreiber abgelegte Referenz-TIFF kann theoretisch aus denselben SkyHub-Ausgangspixeln stammen oder gezielt manipuliert worden sein. Ein reiner SHA-256-Pin ist kein signierter Laborbericht, keine DJI-DLS-Verifikation und kein Panelmessprotokoll. Ein bitgenauer Vergleich aller vier Bänder wird als möglicher Zirkelschluss sogar abgewiesen; damit ist Quellunabhängigkeit aber noch nicht bewiesen.

## Privater Eingangsvertrag

Es gibt keine HTTP-Route, kein Dashboard, keinen Netzverkehr, keine Datenbank und keine aktive Flugsteuerung. Erforderlich sind:

- `--bundle` mit acht numerischen TIFFs und drei Reports, die der bisherige M3M-Siegel-Worker vollständig prüfen kann.
- `--seal` und **extern unabhängig gespeicherter** `--seal-sha256` des 11-Artefakte-Siegels. Vor **und nach** dem Vergleich wird die gesamte numerische Formel-/Masken-QA auf diesem Bundle erneut ausgeführt.
- `--reference-dir` als privater lokaler 0700-Ordner, ausschließlich mit `red.tif`, `green.tif`, `red_edge.tif`, `nir.tif` und `reference-manifest.json`.
- `--reference-manifest-sha256` als **getrennt vorher festgehaltener** Hash des Referenzmanifestes. Das Manifest ist kanonisches JSON ohne doppelte Felder; jeder der vier GeoTIFF-Einträge enthält den festen `band`-/`filename`-Namen, Bytes und SHA-256. Vor und nach dem Vergleich müssen sämtliche Dateien und Inhalte übereinstimmen.

### Referenzmanifest – vertragliche Form

~~~json
{"bands":[{"band":"red","bytes":100,"filename":"red.tif","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},{"band":"green","bytes":100,"filename":"green.tif","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},{"band":"red_edge","bytes":100,"filename":"red_edge.tif","sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},{"band":"nir","bytes":100,"filename":"nir.tif","sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}],"classification":"operator-provided-reference-unverified-independence","externallyCalibratedClaim":false,"operationalUseAllowed":false,"provenanceIndependentlyVerified":false,"radiometricCalibrationVerified":false,"schema":"skyhub-m3m-private-reference-manifest-v1"}
~~~

**Nur Schema-Beispiel:** `bytes` und alle Hashes sind Platzhalter, keine realen Referenz-TIFF-Prüfsummen. Das gespeicherte JSON muss als `json.dumps(record, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n'` geschrieben werden und seine eigene SHA-256-Summe getrennt vom Inhalt aufbewahren. Ein aus dem aktuell gelieferten Referenzmanifest beim Aufruf neu errechneter Hash ist **keine unabhängige Vertrauenskette**.

## Quantitative Metriken

Bei identischer Geometrie/CRS/Geotransform, exakt 1 Float32-Band je Datei und maximal 2 Millionen Rasterpixeln liefert das Labor je Band:

- Anzahl gültiger Vergleichspixel und nur in Quelle bzw. Referenz gültiger Pixel.
- `maskIntersectionOverUnion`: Anteil der Überlappung gültiger Pixel, kein klassischer allgemeiner Orthomosaik-Registrierungsbeweis.
- Vorzeichenbehaftete mittlere Abweichung (`meanSignedError`), absolute mittlere Abweichung (`meanAbsoluteError`), RMSE und 95%-Quantil des Betragsfehlers.
- Labortest-Kriterien MAE ≤ 0,03, RMSE ≤ 0,05, p95 ≤ 0,10 und Maskenüberlappung ≥ 0,95. **Explorative Platzhalter**, keine aus DJI-Handbuch, eigener Panelkalibrierung oder Agronomie abgeleiteten Toleranzen. `allBandsWithinExploratoryLimits` bezieht sich *nur* auf diese numerischen Vergleichsgrößen. Es ist keine generische wissenschaftliche Zulassung.

Die Standalone-CLI gibt weder GeoTIFF-Daten, XMP, GPS-Koordinaten, UUIDs, absolute Dateipfade noch Referenzmanifest-Hashes aus. Alle Verifizierungs-/Integritätsmarker beschreiben nur das lokale Dateisystem. `sourceProvenanceVerified=false`, `referenceProvenanceIndependentlyVerified=false`, `bandCoregistrationVerified=false`, `radiometricCalibrationVerified=false`, `reflectanceReady=false`, `ndviReady=false`, `ndreReady=false`, `operationalUseAllowed=false`, `prescriptionExportAllowed=false` und `flightMissionAllowed=false` bleiben im JSON unveränderlich.

## Isolierter Aufruf

~~~bash
python3 backend/workers/m3m_private_reference_agreement.py \
  --bundle /privat/experiment-m3m-bundle \
  --seal /privat/siegel.json \
  --seal-sha256 <independently-pinned-64-hex> \
  --reference-dir /privat/laborreferenz \
  --reference-manifest-sha256 <separately-pinned-64-hex>
~~~

Das ist ein **read-only**, strikt fail-closed Workflow. Die gezeigten Pfade und Hash-Platzhalter sind nicht ausführbar und müssen durch kontrollierte lokale Eingaben ersetzt werden.

## Abnahme und nächste wissenschaftliche Gates

`tests/test_m3m_private_reference_agreement.py` erzeugt reale synthetische GeoTIFFs, externes Referenzmanifest und Siegel. Geprüft werden normale Pixelabweichungen, zu große Abweichungen, geänderte Masken, Geotransform-Drift, bitgenaue Quellenkopien (möglicher Zirkelschluss), Manipulation der TIFF-/SHA-Daten, Symlink-Angriffe, unbekannte Dateien, manipulierte Ready-Flags und verspätete Eingabeänderungen.

Vor wissenschaftlicher Freigabe fehlen: echte M3M-DNG/TIFF-Originale samt nachvollziehbarer DJI-Herkunft und Firmwarestand, DLS- und Panelreferenzen, reproduzierbare Sensor-/Vignettierungskorrektur, plausibler Kamera-/Bandabgleich, unabhängige Kalibrierungsreferenzen und Feldpunkte, externe QGIS-/GDAL-Validierung der Pixel- und Weltkoordinaten, registrierte Geräte-/Piloten-/Workflow-Audits sowie dokumentierte Stichprobenauswahl und Unsicherheitsbudget. **Der Code schaltet keinen dieser Gates frei**, selbst wenn sämtliche synthetischen Tests grün sind.
