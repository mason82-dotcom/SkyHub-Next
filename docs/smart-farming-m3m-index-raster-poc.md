# SkyHub Next: M3M experimenteller Index-Raster-Worker (PoC)

Stand: 23.10.2026. Nur isolierter Offline-Prototyp auf dem Branch
`feature/m3m-reflectance-poc-20261023`. **Keine aktive HTTP-Route,
kein DJI-Upload, keine S3-Leseoperation, keine Agras-/ISOXML-Erzeugung und kein Deployment.**

## Funktion und Datenvertrag

`backend/workers/m3m_reflectance_indices.py` verarbeitet **vier getrennte,
einbandige Float32-/Float64-GeoTIFFs**, die vom aufrufenden System bereits
radiometrisch in dimensionslose Reflexionsfraktionen im Bereich **[0,1]**
umgerechnet und räumlich pixelgenau registriert worden sein sollen.
Vorgegebene Eingangsbänder: **Red, Green, Red Edge, NIR**.

Der Worker **kann diese beiden Voraussetzungen nicht beweisen**. Die
Metadatenprüfung aus XMP, ein identisches CRS und ein identischer Affin-Transform
bestätigen weder radiometrische Korrektur noch subpixelgenaue Bandregistrierung
noch reale Mavic-3M-Herkunft. Diese Qualitätsfreigaben bleiben **false**.

**Nicht akzeptiert:** M3M-Original-TIFF-DN-Werte, 16-Bit-skalierte
Reflexionswerte (z.B. 32768 * rho), Einzelbildsets ohne Orthorektifizierung,
verschiedene Koordinatensysteme, verschobene Raster, fehlendes CRS, Mehrbanddateien.
Float-TIFFs mit DN-ähnlichen Werten können nur anhand eines Wertebereichs **nicht
zuverlässig erkannt werden**; Qualitäts-/Provenienzprüfung ist deshalb Pflicht vor
späterer operativer Nutzung.

## Offline ausführen

Python separat vom Node.js-/DJI-Backend in einer eigenen virtuellen Umgebung
installieren (nicht auf einen produktiven Container wirken lassen):

```bash
cd ~/Projekte/SkyHub-Next
python3 -m venv .venv-m3m
. .venv-m3m/bin/activate
pip install -r backend/workers/m3m_requirements.txt

python3 -m unittest discover -s tests -p 'test_m3m_reflectance_indices.py' -v

python3 backend/workers/m3m_reflectance_indices.py \
  --red /daten/geprueft/red-reflectance.tif \
  --green /daten/geprueft/green-reflectance.tif \
  --red-edge /daten/geprueft/rededge-reflectance.tif \
  --nir /daten/geprueft/nir-reflectance.tif \
  --output-dir /daten/analysen/m3m-index-test-001
```

Die Eingabedateien müssen tatsächlich existieren; das Elternverzeichnis des
Ausgabeordners muss existieren. Der Ausgabeordner darf **noch nicht existieren**
und wird nicht überschrieben. Die Beispiele sind Platzhalter und keine
Behauptung über M3M-Daten auf dem Pi.

## Numerische Regeln

- NDVI = (NIR - Red) / (NIR + Red)
- NDRE = (NIR - RedEdge) / (NIR + RedEdge)
- GNDVI = (NIR - Green) / (NIR + Green)
- OSAVI = 1.16 * (NIR - Red) / (NIR + Red + 0.16)

Keine DN-Skalierungsfaktoren werden heimlich angenommen. Float-Reflexionswerte
0..1 sind für OSAVI zwingend relevant; die additive Konstante darf nicht mit
skalierten 16-Bit-Rohwerten kombiniert werden.

Die gemeinsame Eingangsmaske verwirft in allen vier Bändern NoData und nicht
endliche Werte. Für jeden Index werden zusätzlich Nenner kleiner/gleich
1e-6 maskiert. Endergebnis ist ein GeoTIFF (Float32, Deflate, NoData=-9999)
pro Index. Die Berechnung erfolgt mit 256x256-Pixel-Windows und begrenztem RAM.
Abweichende Grid-Geometrie, Integer-Datentypen und gültige Werte außerhalb
0..1 beenden die Auswertung ohne veröffentlichtes Ergebnis.

## Resultate und Sicherheitsgrenzen

Ausgabedateien: `ndvi.tif`, `ndre.tif`, `gndvi.tif`, `osavi.tif`,
`report.json`. Der Report enthält nur Schemainformationen, Pixelzahlen,
Min-/Max-/Mittelwerte und fest codierte Warnungen, keine Eingangspfade,
CaptureUUIDs, Seriennummern oder GPS-Positionen. **Die GeoTIFFs enthalten
geographische Positionen und sind entsprechend geschützt aufzubewahren.**

Immer gesetzt: `operationalUseAllowed=false`,
`calibrationVerified=false`, `bandCoregistrationVerified=false`,
`reflectanceReady=false`, `ndviReady=false`,
`ndreReady=false`. Die existierenden M3M-XMP-/Capture-Gruppen-Flags
werden nicht verändert. Die Ausgabe ist **nur experimentell**, auch wenn
GIS-Programme die Indizes darstellen können.

Dieser PoC produziert keine Düngungsempfehlung, Missionsdatei,
Sprühmenge, TaskData oder Agras-Verordnungskarte. Der ältere
`m3m_agri_processor.py` erzeugt synthetische Daten und bleibt unangetastet.

## Tests und nächste Freigaben

CI-Workflow `m3m-raster-offline.yml` installiert nur im GitHub-runner
die optionalen Bibliotheken und prüft reale GeoTIFF-I/O mit synthetischen Testpixeln:
Formeln, Masken, CRS, Grid-Verschiebung, Roh-DN-Zurückweisung, Wertebereiche,
Duplikate und Schutz bestehender Ergebnisse.

Offen für Phase 2: Mit DJI-Referenzworkflow oder DEDAL bestätigte Kalibrierung,
prüfbarer Bild-Hash/VersionId und S3-Workspace-Bindung, vierbandige vollständige
Capture-Gruppen, multispektrale Orthomosaik-Erstellung, Band-Co-Registrierung
und unabhängige Referenzwerte. Erst nach separater Hardware- und Fachabnahme
dürfen Readiness-Flags oder agronomische Anwendungen freigeschaltet werden.
