# SkyHub Next – DEDAL/ODM-Orthomosaik-Übergabe (offline)

Stand 23.10.2026, Entwicklungsbranch `feature/m3m-dedal-ortho-handoff-20261023`.
**Kein DJI-Rohbildkalibrator, keine aktive SkyHub-Route, kein S3-Zugriff und kein Pi-Deployment.**

## Datenvertrag

Offizielle DEDAL-Referenz:
- https://dedal.jic.ac.uk/docs/reference/
- https://dedal.jic.ac.uk/docs/processing/
- https://dedal.jic.ac.uk/calibration/
- https://zenodo.org/records/23301986 (v0.1.1; gezeigtes Softwarearchiv ist weiterhin als 0.1.0 bezeichnet)

Die hier implementierte Komponente `backend/workers/m3m_dedal_ortho_handoff.py`
erwartet ein **bereits extern kalibriertes und orthorektifiziertes**
fünfbandiges ODM-GeoTIFF (alle Bänder UInt16):

| GeoTIFF-Band | Inhalt | Zieldatei |
|---|---|---|
| 1 | Red | `red.tif` |
| 2 | Green | `green.tif` |
| 3 | NIR | `nir.tif` |
| 4 | Red Edge | `red_edge.tif` |
| 5 | Alpha (Gültigkeit) | Maske, keine Reflexionsdatei |

Bei gültigem Alphapixel wird `Reflexionsfraktion = UInt16 / 32768.0` gebildet,
als Float32 GeoTIFF geschrieben und das affine Pixelraster samt CRS beibehalten.
Ein gültiger Quellpixel >32768 wird konservativ abgelehnt statt unbemerkt
über 100 % Reflexion einzutragen. Alpha=0 sowie vorhandene GDAL-Bandmasken
werden zu NoData=-9999. Dieser Filter kann bei echten Daten zu restriktiv
sein und muss anhand realer DEDAL-Ausgaben abgenommen werden.

**Wichtig:** Die Bandreihenfolge und Skalierung stammen aus der veröffentlichten
DEDAL-QGIS-/ODM-Dokumentation. Der Adapter identifiziert nicht selbst,
ob ein beliebiges TIFF wirklich von DEDAL erzeugt oder korrekt kalibriert wurde.

## Kalibrierungsstatus

Der übergebene `--calibration-status` ist eine *unverifizierte Angabe
des Operators*, kein aus einem signierten DEDAL-Report ausgelesenes Ergebnis:

- `accepted`: experimentellen Import erlauben; die Freigabeflags bleiben dennoch false.
- `flagged`: nur zusammen mit explizitem `--allow-flagged` importieren,
  im Bericht weiterhin als auffällig markieren.
- `not_calibrated`: immer ablehnen.

Ein externes DEDAL-Qualitätsresultat wird **nicht** zur automatisch bestätigten
SkyHub-Messqualität hochgestuft. Auch bei `accepted` bleiben
`sourceProvenanceVerified=false`,
`radiometricCalibrationVerified=false`,
`bandCoregistrationVerified=false`, `reflectanceReady=false`,
`ndviReady=false`, `ndreReady=false` und
`operationalUseAllowed=false`.

## Isoliert lokal ausführen

Vorher den DEDAL-/ODM-Job separat abschließen, das Kalibrierungsprotokoll
manuell überprüfen und dessen Orthomosaik **lokal** verfügbar machen.
Das folgende Beispiel verwendet Platzhalterpfade und installiert **nicht**
DEDAL/ODM auf dem produktiven Pi:

```bash
cd ~/Projekte/SkyHub-Next
git fetch origin
git worktree add ~/Projekte/SkyHub-Dedal-Lab origin/feature/m3m-dedal-ortho-handoff-20261023
cd ~/Projekte/SkyHub-Dedal-Lab

python3 -m venv .venv-m3m
. .venv-m3m/bin/activate
python -m pip install -r backend/workers/m3m_requirements.txt
python -m unittest discover -s tests -p 'test_m3m_dedal_ortho_handoff.py' -v

# 1. DEDAL/ODM-5-Band-Orthomosaik -> Float32-Fraktionen.
python backend/workers/m3m_dedal_ortho_handoff.py \
  --orthophoto /daten/extern-geprueft/orthophoto.tif \
  --calibration-status accepted \
  --output-dir /daten/analysen/m3m-handoff-01

# 2. Bestehender experimenteller Indexworker verarbeitet diese vier Raster.
python backend/workers/m3m_reflectance_indices.py \
  --red /daten/analysen/m3m-handoff-01/red.tif \
  --green /daten/analysen/m3m-handoff-01/green.tif \
  --red-edge /daten/analysen/m3m-handoff-01/red_edge.tif \
  --nir /daten/analysen/m3m-handoff-01/nir.tif \
  --output-dir /daten/analysen/m3m-indices-01
```

Beide Ausgabeordner dürfen noch nicht existieren. Die Eingabedateien
werden nicht überschrieben, die vier Ausgabebänder werden nur auf dem
gewählten lokalen Datenträger angelegt. Die GeoTIFFs sind georeferenziert
und können ortsbezogene Informationen enthalten; sie gehören in eine
geschützte Datenablage. Der JSON-Bericht enthält keine Quelldateipfade
oder Koordinaten.

## Tests und Akzeptanzgrenzen

Die Testdatei `tests/test_m3m_dedal_ortho_handoff.py` umfasst 11
synthetische Offline-Tests: Bandreihenfolge, 32768-Skalierung, Alpha-NoData,
CRS-Übernahme, fehlendes CRS, falsche Bandanzahl und Datentypen,
fehlende/auffällige Kalibrierung, Werte >1, unveränderte Zielverzeichnisse,
Symlink-Ablehnung und komplett transparente Mosaike.

Die bestehende CI bleibt ohne Rasterpakete ausführbar; der isolierte
M3M-CI-Workflow installiert die optionalen Bibliotheken und führt die
Adaptertests mit durch. Eine reale DEDAL-Ausgabe und echte M3M-Rohbilder
wurden **nicht** geprüft.

## Nächste getrennte Integrationsschritte

1. Originale M3M-Vierbandgruppen und Panelaufnahmen tatsächlich nachweisen.
2. DEDAL-Paket/versioniertes Artefakt, Lizenz und SHA256 unabhängig prüfen.
3. DEDAL-Job in einem ressourcenbegrenzten Worker ausführen, nicht im
   Pi-MQTT-/Express-Backend.
4. Den DEDAL-Kalibrierungsbericht maschinell validieren und mit Originaldateien,
   Aufnahmegruppen und Software-/Parameterständen revisionssicher verknüpfen.
5. ODM-Orthomosaik-Geometrie und quantitative Ergebnisse gegen unabhängige
   Referenzwerte testen.
6. Erst nach separater wissenschaftlicher und agronomischer Freigabe
   einen operativen Smart-Farming-Datenstatus diskutieren.
