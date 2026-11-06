# Fotoabdeckung: geländekorrigierte AGL- und GSD-Schätzung (P0–P2)

**Stand:** 06.11.2026 – Entwicklungskandidat, kein Pi-/Hardware-Abnahmestatus.
**Referenz:** [Alos-no/DroneDatasetAnalyzer](https://github.com/Alos-no/DroneDatasetAnalyzer) (Apache-2.0; Konzepte verglichen, kein fremder C#-Code eingebettet).
**SkyHub-Pfad:** `/abdeckung.html`, `backend/coverage.js`.

## P0: Höhenbezugssystem und Fehlerverhalten

Die DJI-XMP-Felder `AbsoluteAltitude` und `RtkFlag` reichen allein **nicht** als Nachweis des verwendeten vertikalen Datums.
Ein ungeprüftes `AbsoluteAltitude − DEM` ist unzulässig, weil WGS84-ellipsoidische, EGM96- und EGM2008-Höhen verschieden sind.

Deshalb nutzt die optionale Foto-AGL nur **relative Höhe über dem Startpunkt** und zwei Höhen **aus demselben DEM**:

`AGL(photo) = RelativeAltitude(photo) + DEM(takeoff) − DEM(photo)`

Die Startposition muss ausdrücklich als WGS84-Koordinate eingegeben werden. Der erste Fotostandort, die MRK-Position und der
Mittelwert der Aufnahmen werden **nicht** als Startposition angenommen. `AbsoluteAltitude` wird nur lesend erfasst und **nicht**
zur Korrektur verwendet. Bei fehlendem Geländedienst, unbekannter Startposition im Gelände-Modus, ungültigen Höhen oder
Timeout ist der Modus `unavailable`, **kein** stummer Wechsel zur Höhe über Start.

Der Qualitätszustand lautet `estimated` (nicht `verified`): die Elevation stammt aus einem Oberflächenmodell, das Gebäude,
Vegetation und Hang-Interpolation unzureichend abbilden kann. Referenz- und Genauigkeitsnachweise fehlen.
Bei einzelnen fehlenden DEM-Punkten werden nur diese Bilder ausgeschlossen; der Bericht nennt gültige, fehlende und
unplausible Punkte. Mindestens zwei gültige Schätzungen sind erforderlich. Maximal 5.000 Fotos je Abfrage.
Die Kamera-Fußabdrücke bleiben eine lokale Ebenenapproximation, **keine** 3D-Strahlverfolgung über das DEM.
Der Status ist weder Flugsicherheit noch Freigabe oder Vermessungszertifikat.

## P1: Anbindung und Bedienung

Die vorhandene Open-Topo-Data-Konfiguration `SKYHUB_TERRAIN_URL` / `SKYHUB_TERRAIN_DATASET` wird wiederverwendet.
Die Fotoabdeckung darf Terrain nur über einen explizit zugelassenen **internen Host** anfragen
(`opentopodata`, `localhost`, `127.0.0.1` oder `brix-node`).
Die Verbindung zur Foto-AGL ist unabhängig davon, ob die WPML-Missionsfreigabe aktiviert ist.
Ohne Terrain-Konfiguration oder ohne eingegebenen Startpunkt bleibt die bislang vorhandene Berechnung unverändert
als `uncorrected` ausgewiesen. **Es findet keine automatisch ausgelöste Geländekorrektur statt.**

Eingabe über `POST /api/coverage/run`, wie bisher `flight` (16 Hex-Zeichen) und `minOverlap` (1–20),
optional `takeoff:{lat,lon}` (beide Zahlen in WGS84). Im Ergebnis:

- `altitude.status`: `uncorrected` oder `estimated`; bei Fehler: HTTP 422, `status: unavailable`.
- `altitude.terrainDataset`, `valid`, `missing`, `implausible` und `absoluteAltitudeDatum: not-used` im Gelände-Modus.
- `gsdCmPx`: Min/Median/Max und Probenzahl nur für Nadir-Bilder mit **tatsächlich gelesener** 35-mm-Äquivalentbrennweite
  sowie Breite und Höhe. Fehlende Optikdaten ergeben `null`, **keinen erfundenen 24-mm-Wert**.

Es werden nur Bildköpfe aus dem bestehenden MinIO-Pfad gelesen; weder Objekte noch DJI-Fluggeräte oder WPML-Daten verändert.
Die auf dem Server gespeicherte In-Memory-Zwischenspeicherung beträgt zehn Minuten und schließt die expliziten Startkoordinaten
in den Schlüssel ein. Kein automatischer Pi-Deploy, kein Docker-Neustart, keine DJI-Kommandos.

## P2: M4T-/M3M-Fototypen

| Variante | Behandlung in der Fotoabdeckung | Status |
| --- | --- | --- |
| Matrice 4T `_V.JPG`, `_W.JPG`, `_Z.JPG` | Sichtbild, falls XMP/EXIF-Felder vollständig | synthetisch getestet |
| Matrice 4T `_T.JPG` / R-JPEG | Ausgeschlossen; getrenntes `thermal.js`/DJI Thermal SDK | synthetisch getestet |
| Mavic 3M `_D.JPG` | RGB-Bild, falls Kamera-Metadaten vollständig | synthetisch getestet |
| Mavic 3M `_MS_G/R/RE/NIR.TIF` | Multispektral erkannt, nicht als RGB-Foto behandelt; `ndvi.js` ist zuständig | synthetisch getestet |
| Abweichender Name / fehlende Brennweite | Nicht als geprüfte Fotoabdeckung ausgeben | synthetisch getestet |

Der Parser erkennt `drone-dji:DroneModel`, `ProductName`, `RtkFlag`, `CaptureUUID`, `BandName`,
`ImageSource`, `CalibratedFocalLength` und die Gimbal-/GPS-/Höhenfelder, soweit vorhanden.
Aufnahmen anderer DJI-Modelle benötigen eigene Prüffälle. TIFF-Pixel und R-JPEG-Radiometrie werden nicht neu interpretiert.

## Prüfen, ohne Produktivsysteme zu verändern

```bash
cd ~/Projekte/SkyHub-Next
node --check backend/coverage.js
node --check backend/coverage-altitude.js
node --check backend/dji-photo-metadata.js
node --check frontend/public/abdeckung.js
node --test backend/test/coverage.test.js backend/test/coverage-altitude.test.js backend/test/dji-photo-metadata.test.js
```

**Abnahmegrenze:** Alle Tests sind synthetisch. Es müssen weiterhin echte M4T- und M3M-JPEGs mit unterschiedlichen
Kameras, Höhen, Kamerapositionen und DJI-Firmwareständen verglichen werden. Die eingesetzte DEM-Version und
die tatsächliche Startposition müssen nachvollziehbar sein. `PASS` im Test ist **keine** Hardwareabnahme.
