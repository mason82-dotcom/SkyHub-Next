# SkyHub Next – M3M DEDAL/ODM → Indexraster: Offline-End-to-End-PoC

Stand 23.10.2026; Branch: `feature/m3m-dedal-offline-pipeline-20261023`.
**Experimenteller Offline-Workflow, keinerlei produktiver Einsatz.**

## Neu: verknüpfte Rasterstufen

`backend/workers/m3m_dedal_offline_pipeline.py` verbindet zwei **bereits im
SkyHub-Code enthaltene** Werkzeuge in einem einzigen lokalen Auftrag:

1. `m3m_dedal_ortho_handoff.py`: Ein bereits extern kalibriertes
   und orthorektifiziertes ODM-Fünfband-GeoTIFF (UInt16,
   Red/Green/NIR/RedEdge/Alpha, Reflexionsfaktor 32768) in vier
   Float32-Reflexionsfraktionen umwandeln.
2. `m3m_reflectance_indices.py`: Daraus pixelbasierte NDVI-,
   NDRE-, GNDVI- und OSAVI-GeoTIFFs berechnen.

Das Skript **führt DEDAL selbst weiterhin nicht aus**. Die tatsächliche
Kalibrierung, Panelanalyse und Photogrammetrie erfolgen weiterhin
außerhalb dieses Codes. DEDAL-Dokumentation zu den Formaten:
https://dedal.jic.ac.uk/docs/reference/ und
https://dedal.jic.ac.uk/docs/processing/.

## Eingabeschutz und Freigaben

- Der Bediener muss den **SHA-256 des vollständigen ODM-Geotiffs**
  explizit vorgeben. Der Inhalt wird vor Beginn und nach Abschluss
  nochmals gehasht.
- Der Eingabepfad muss eine lokale, reguläre TIFF-Datei sein. Direkte
  Symlinks, ungültige Prüfsummen und zu große Dateien werden verweigert.
- Der noch nicht vorhandene Zielordner wird zunächst innerhalb des
  übergeordneten Verzeichnisses als privater temporärer Arbeitsordner
  vorbereitet. Beide Rasterstufen müssen erfolgreich sein und positive
  valide Pixelzahlen für sämtliche Bänder/Indizes liefern, bevor das
  vollständige Ergebnis durch Umbenennen veröffentlicht wird.
- Bei Fehlern löscht der Code die temporären Ergebnisse, nicht
  etwa vorhandene Zielverzeichnisse.
- `--calibration-status accepted` ist **nur eine unverifizierte
  Bedienerangabe**. Bei `flagged` ist zusätzlich
  `--allow-flagged` notwendig. `not_calibrated` wird abgelehnt.
- **Immer falsch:** `radiometricCalibrationVerified`,
  `bandCoregistrationVerified`, `reflectanceReady`,
  `ndviReady`, `ndreReady`,
  `operationalUseAllowed`.

Die SHA-256-Prüfung belegt **Bytegleichheit**, nicht die Herkunft,
wissenschaftliche Korrektheit oder tatsächliche DEDAL-Kalibrierung.
Es besteht weiterhin keine kryptographisch verifizierte Verknüpfung
zwischen DEDAL-Kalibrierungsbericht, Kameraoriginalen und Orthomosaik.

## Ausführung im separaten Worktree

```bash
cd ~/Projekte/SkyHub-Next
git fetch origin
git worktree add ~/Projekte/SkyHub-M3M-PipelineLab \
  origin/feature/m3m-dedal-offline-pipeline-20261023
cd ~/Projekte/SkyHub-M3M-PipelineLab

python3 -m venv .venv-m3m
. .venv-m3m/bin/activate
pip install -r backend/workers/m3m_requirements.txt

python3 -m unittest discover -s tests \
  -p 'test_m3m_dedal_offline_pipeline.py' -v

# Dies ist ein Platzhalterpfad; reale GeoTIFFs werden nicht mitgeliefert.
sha256sum /daten/extern-kalibriert/orthophoto.tif

python3 backend/workers/m3m_dedal_offline_pipeline.py \
  --orthophoto /daten/extern-kalibriert/orthophoto.tif \
  --orthophoto-sha256 HIER_UNABHAENGIG_FESTGEHALTENEN_SHA256_EINSETZEN \
  --calibration-status accepted \
  --output-dir /daten/m3m-versuche/experiment-001
```

Das Ausgabeverzeichnis darf vorher **nicht existieren**.

Ergebnis:

```text
experiment-001/
  reflectance/
    red.tif
    green.tif
    red_edge.tif
    nir.tif
    report.json
  indices/
    ndvi.tif
    ndre.tif
    gndvi.tif
    osavi.tif
    report.json
  bundle-report.json
```

Alle Rasterdateien enthalten geographische Daten. Der
`bundle-report.json` enthält dagegen ausschließlich
Status-, Pixelzähler- und Schemainformationen und keine Quellpfade,
Aufnahme-UUIDs oder GPS-Positionen.

## Tests, Grenzen und nächster Schritt

Zwölf synthetische Rastertests in
`tests/test_m3m_dedal_offline_pipeline.py` prüfen die **echte**
Verkettung der beiden Worker, NDVI/OSAVI-Zahlen, CRS, Alpha-NoData,
Dateihash, nicht kalibrierte/markierte Daten, den Schutz vor
Überschreibungen, Symlinks, fehlendes Signal sowie Stufen- und
Prüfsummenfehler mit anschließendem Aufräumen. Der isolierte
GitHub-Actions-Workflow soll alle optionalen Rasterbibliotheken
installieren und auch diesen End-to-End-Lauf ausführen.

**Noch offen:** durchgängige reale Mavic-3M-Flugdatentests, eine
nachweisbare DEDAL-/Panel-Report-Bindung an das Orthomosaik,
subpixelgenaue Bandregistrierungsabnahme, wissenschaftliche
Referenzdaten und der Produktivbetrieb in einer dedizierten
SkyHub-Worker-Umgebung. Diese Checks dürfen ausdrücklich
**keine** Düngungsempfehlung oder Agras-Mission aktivieren.
