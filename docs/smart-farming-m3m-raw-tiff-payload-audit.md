# SkyHub Next – M3M Raw-TIFF-Payload-Audit (offline)

Stand: 23.10.2026. Stacked Draft auf dem experimentellen Index-Raster-Worker.
**Keine Live-Route, kein Zugriff auf MinIO/DB/MQTT, kein DJI-Steuerbefehl und kein Raspberry-Pi-Deployment.**

## Zweck

`backend/workers/m3m_raw_tiff_audit.py` dekodiert bis zu **vier explizit genannte,
lokal verfügbare klassische TIFF-Dateien** (16-Bit unsigned, ein Band,
maximal 128 MiB pro Datei und maximal 16.777.216 Pixel pro Bild)
vollständig, aber in 256×256-Pixel-Fenstern.

Im TIFF-IFD wird nur der auf 32.768 Byte begrenzte XMP-Tag 700
für DJI-Bandhinweise `BandName` / `ImageSource` und
`CaptureUUID`/`CaptureUuid` ausgewertet. Die XML-Verarbeitung
verwendet `defusedxml` und akzeptiert nur DJI-Namespacewerte aus
festen Enumerationen. Doppelte/widersprüchliche Angaben verhindern die
positive Bandklassifikation. Gleichheit einer UUIDv4 über zwei bis vier
Bandbilder ist **nur ein unbestätigter Aufnahmegruppen-Hinweis**.

Für jede Eingabedatei wird SHA-256 vor und nach dem Dekodieren im Prozess
berechnet. Damit werden bei unverändertem lokalen Dateisystem versehentliche
Dateiänderungen während der Prüfung und byte-identische Dubletten erkannt.
**Der Digest wird nicht ausgegeben und belegt weder die DJI-Herkunft noch
eine unveränderte S3-Objektversion oder manipulationssichere Provenienz.**

## Aufruf in separatem Worktree, ohne Deployment

```bash
git -C ~/Projekte/SkyHub-Next fetch origin
git -C ~/Projekte/SkyHub-Next worktree add \
  ~/Projekte/SkyHub-M3M-Payload-Test \
  origin/feature/m3m-raw-tiff-payload-audit-20261023
cd ~/Projekte/SkyHub-M3M-Payload-Test
python3 -m venv .venv-m3m
. .venv-m3m/bin/activate
python -m pip install -r backend/workers/m3m_requirements.txt
python -m unittest discover -s tests -p 'test_m3m_raw_tiff_audit.py' -v

# Plätzhaltende Pfade: nur echte, bereits lokal gespeicherte TIFFs einsetzen.
python backend/workers/m3m_raw_tiff_audit.py \
  --tiff /daten/lokal/red.tif \
  --tiff /daten/lokal/nir.tif
```

Bis zu vier `--tiff`-Argumente sind möglich. Der Auditor unterstützt
ausdrücklich auch unvollständige Sammlungen (z.B. Red + NIR), ohne daraus
eine NDVI-Freigabe abzuleiten. Die Dateien müssen lokale reguläre TIFFs
sein; direkte Symlinks und wiederholte Inodes werden abgewiesen.
Bitte **keine** privaten Pfade, XMP-IDs oder Objektschlüssel im Chat
veröffentlichen.

## Ausgegebener Bericht

Ein einziges JSON mit **nur aggregierten** Daten: Anzahl vollständig
dekodierter Bilder, Pixel-, NoData-, Nichtnull- und Sättigungszähler,
Bandhinweis-Anzahlen, XMP-Status-Anzahlen, Übereinstimmung der Dimensionen
und optionaler `redNirPairHint`/`fullFourBandHint`.

CaptureUUID, Dateinamen, lokale Pfade, Geo-Koordinaten, Seriennummern
und XMP-Rohtext bleiben außerhalb des JSON. **Die Quelldateien selbst
können ortsbezogene und private Daten enthalten**. Der Code führt keine
Schreiboperation aus; Python-Bibliotheken dürfen jedoch nicht als
uneingeschränkt gegen bösartige TIFF-Dateien gehärtete Sandbox betrachtet
werden. Er ist für isolierte Offline-Tests mit vertrauenswürdig
bereitgestellten Testdateien gedacht.

## Status und Grenzen

Alle Freigaben bleiben fest auf `false`:
`sourceVerified`, `imageContentVerifiedAsDjiM3M`,
`radiometricCalibrationVerified`, `bandCoregistrationVerified`,
`reflectanceReady`, `ndviReady`, `ndreReady`,
`operationalUseAllowed`. Ein wahres
`fullFourBandHint` bedeutet nur gleicher XMP-CaptureUUID-Text,
vier verschiedene Bandmarker und dekodierbare TIFF-Pixel.

**Weder radiometrische Korrektur noch Orthorektifizierung werden ausgeführt.**
Die originalen DJI-Werte sind DN, keine Float-Reflexionswerte. Eine spätere
Freigabe erfordert die Prüfung des DJI-Sensors, der Kalibriermetadaten,
eines Referenzpanels, der Pixelregistrierung und der Dateiidentität
entlang der Medienpipeline.

## Abnahme

14 Tests mit synthetischen TIFF-Payloads:
vollständiger Vierbandhinweis, Teilgruppe R/NIR, abweichende CaptureUUID,
widersprüchliche Bandangabe, fehlendes/gefährliches XMP, nicht-uint16,
leeres Signal, byteidentische Dubletten, wiederholter Pfad, Symlink,
ungültiger TIFF-Magic, maximal vier Dateien und Einbildfall.
Der M3M-CI-Workflow installiert die optionalen Abhängigkeiten
`numpy`, `rasterio`, `tifffile`, `defusedxml`.
Der bestehende Haupt-CI-Testlauf ohne diese Abhängigkeiten überspringt
die optionalen TIFF-Payload-Tests und bleibt unverändert.

**Keine reale M3M-Bilddatei wurde im Rahmen dieses Changes ausgelesen.**

Referenzen:
- DJI Mavic 3M Image Processing Guide: https://dl.djicdn.com/downloads/DJI_Mavic_3_Enterprise/20230829/Mavic_3M_Image_Processing_Guide_EN.pdf
- DEDAL v0.1.1: https://zenodo.org/records/23301986
