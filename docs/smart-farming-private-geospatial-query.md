# SkyHub Smart Farming – P3 privater GeoJSON-zu-GeoTIFF-Analyseadapter

**Stand:** 02.11.2026 · **Basis:** isoliert aus Draft #115 auf aktuellen `main` konsolidiert, nach Übernahme der Offline-Worker aus #113 und #114 in PR #229/#230. Ausschließlich Quellcode und synthetische Tests; keine Pi-Dienste verändert.

## Ziel

Der neue Worker `backend/workers/m3m_private_gis_query.py` schließt eine Lücke zwischen rein pixelbasierten Offline-Auswertungen und einer späteren interaktiven Vegetationskarte: Er akzeptiert **private WGS84-Koordinaten als GeoJSON-Point oder einfaches Polygon** und liest die dazugehörigen **numerischen Float32-GeoTIFF-Werte** aus dem bestehenden experimentellen, georeferenzierten M3M-Bundle.

Dies ist **kein** HTTP-/GIS-Layer-Endpunkt und keine wissenschaftlich freigegebene agronomische Analyse.

## Strenger Eingangsvertrag

- Ein lokal gespeichertes GeoJSON-Geometrieobjekt, ausschließlich `{"type":"Point","coordinates":[lon,lat]}` oder `{"type":"Polygon","coordinates":[[[lon,lat],...]]}`.
- WGS84-Koordinaten, geschlossenes nicht selbstüberschneidendes Polygon, **ein Außenring**, keine Löcher, keine Features, keine zusätzlichen Attribute oder nutzerkontrollierten CRS-Einstellungen.
- Maximal 64 KiB privates JSON; höchstens 256 Polygonpunkte; Koordinatenspanne maximal 0,25°; Auswertefenster maximal 250.000 Pixel. Überschreitung führt zu Fehler statt unvollständigen Ergebnissen.
- Ein **extern verwahrter SHA-256-Pin** zum Siegel des unveränderten M3M-Rasterbundles. Vor und nach der Analyse: vollständige Siegel- und unabhängige Pixel-/NoData-/Indexformel-Verifikation.
- Bild-, Kamerakalibrierungs-, DJI-Geräte- und Panelherkunft werden **nicht** durch diesen Adapter bestätigt.

## Ausgaben und Datenschutz

Der Worker liefert ausschließlich einen lokalen JSON-Bericht mit Anzahl beteiligter Pixel und Kennzahlen zu **Red, Green, Red Edge, NIR, NDVI, NDRE, GNDVI, OSAVI**: gültige/maskierte Pixel, Mittel, Min, Max, Median, P10/P90 und Standardabweichung.

Die Ausgabe enthält **keine privaten GeoJSON-Koordinaten, kein originales Georeferenzierungssystem, keine Eingabepfade, Aufnahme-UUIDs, Kartenkacheln oder Zugriffslinks**. Das ist eine Report-Redaktion, kein vollständiger Schutz davor, dass Messwerte selbst vertrauliche Informationen verraten können. Nur innerhalb eines privaten Labors aufrufen.

Die Polygon-Statistik berücksichtigt standardmäßig Pixelmittelpunkte (`all_touched=False`) und berechnet **noch keine** flächengewichteten Hektarwerte, geodätischen Flächen oder zonale Agronomie. Für sehr kleine Polygone ohne eingeschlossene Pixel erfolgt eine Ablehnung. Punktpositionen außerhalb des Orthomosaiks werden nicht automatisch auf den nächstgelegenen Bildpunkt verschoben.

## Beispiel für den isolierten Offline-Aufruf

Privates GeoJSON im Quellkoordinatensystem WGS84, z. B. `/isoliert/privat/auswahl.geojson`, für eine tatsächlich berechtigte Fläche verwenden:

~~~bash
python3 backend/workers/m3m_private_gis_query.py \
  --bundle /isoliert/m3m-experimentelles-bundle \
  --seal /isoliert/gepruefter-seal.json \
  --seal-sha256 <extern-gepinnter-sha256> \
  --geometry-file /isoliert/privat/auswahl.geojson
~~~

Der SHA-Platzhalter ist **nicht** unmittelbar ausführbar und muss durch einen unabhängig ermittelten 64-stelligen Hex-Wert ersetzt werden. Die Geokoordinaten nicht auf der Kommandozeile angeben, sondern in einer berechtigt geschützten Datei.

## Tests, Gates und nächste Architekturentscheidungen

Der synthetische `tests/test_m3m_private_gis_query.py` überprüft echte Rasterio-Geotransformation und -Abfragen, Point, NoData, Polygonfläche, fehlende/duplizierte JSON-Felder, Bounds, ungültige Siegel, manipulierte GeoTIFFs und Mutation der GeoJSON-Anforderung. Er verwendet das vorhandene **echte synthetische** Rasterbundlesiegel und dessen unabhängige Pixel-QA, nicht nur einen gemockten Verifier.

Bei Freigabe für eine spätere HTTP-API sind zusätzliche Schutzmaßnahmen erforderlich: Workspace-/Field-/Asset-Bindung, Authentisierung und Rollenprüfung *vor* Zugriff auf das Objekt, feste und auditierte Rasterkennung statt direkter Pfade, Limits und Quoten pro Nutzer, Rate-Limiting, unkomprimierte Ausgabegrößen, ETag-/VersionId-Pinning und datenschutzbewusste GPS-Koordinatenbehandlung.

Für eine spätere Kartenansicht außerdem nötig: geprüfte COG-/Tile-Pipeline, sichere Rasterprodukte, Android-Browsertests, fachliche Kalibrierungsabnahme mit realen DJI-M3M-/DLS-/Panel-Referenzdaten und unabhängige DJI-Terra-/GDAL-Vergleiche.

**Niemals** aus erfolgreichem Indexpixelzugriff `radiometricCalibrationVerified`, `reflectanceReady`, `ndviReady`, `operationalUseAllowed`, `prescriptionExportAllowed` oder `flightMissionAllowed` auf `true` ändern.
