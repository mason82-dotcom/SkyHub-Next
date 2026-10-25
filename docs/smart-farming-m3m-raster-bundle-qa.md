# SkyHub Next – unabhängige Rasterpaket-Abnahme (offline)

Stand: 23.10.2026; Entwicklungsbranch `feature/m3m-raster-bundle-qa-20261023`.
**Noch keine radiometrische oder landwirtschaftliche Freigabe. Keine Änderungen an Pi-, MQTT-, DJI- oder MinIO-Diensten.**

## Zweck und Integration

Das neue, ausschließlich lesende Modul
`backend/workers/m3m_raster_bundle_verify.py` verifiziert das bereits
vorhandene Analysepaket nach PR #72, statt seine Dateinamen und
Ergebnisberichte unkritisch zu übernehmen. Der Offline-Pipeline-Worker
`m3m_dedal_offline_pipeline.py` ruft diese Prüfung **nach beiden
Rasterstufen, aber vor Veröffentlichung des temporären Gesamtverzeichnisses**
auf. Scheitert die Abnahme, wird das temporäre Paket verworfen und kein
fertiges Produktverzeichnis veröffentlicht.

## Was wirklich geprüft wird

- **Alle acht** Einband-Float32-GeoTIFFs werden vollständig in 256×256-Pixel-
  Fenstern dekodiert. Es gibt feste Datei- und Größenlimits.
- Alle GeoTIFFs müssen in **CRS, Affintransformation, Dimensionen,
  NoData=-9999 und Bandtyp** exakt übereinstimmen.
- Die vier Eingangsreflexionen Red, Green, Red Edge und NIR dürfen im
  gültigen Bereich nur Zahlen zwischen 0 und 1 enthalten; NaN und Inf
  werden auch in den Ausgangsrastern abgelehnt.
- Aus allen vier Reflexionsrastern werden NDVI, NDRE, GNDVI und OSAVI
  unabhängig nachgerechnet. Die Übereinstimmung der erzeugten
  Indizes muss pixelweise innerhalb einer absoluten Toleranz von
  **5×10⁻⁵** liegen. NoData-Masken und Nennergrenze 10⁻⁶ werden kontrolliert.
- Die angegebenen validen Pixel, Mittelwerte sowie Minimum/Maximum
  der Indexraster müssen mit den echten GeoTIFF-Werten übereinstimmen.
- Alle drei JSON-Berichte und die Pipeline-Schema-Version müssen konsistent
  sein. Doppelte JSON-Schlüssel, falsche Freigaben, fehlende oder
  unerwartete Dateien und Symlinks werden abgewiesen.
- Sämtliche Prüfungsergebnisse enthalten nur aggregierte Zähler
  und feste Flags: **keine** lokalen Pfade, CaptureUUID, Bildnamen oder
  Koordinaten werden in die Standardausgabe übernommen.

Ein Prüferfolg bestätigt **nur die technische und mathematische
Konsistenz** des Analysepakets. Er beweist weder DJI-Bildherkunft,
die tatsächliche DEDAL-Panelkalibrierung, eine korrekte
Bandregistrierung noch ausreichende agronomische Messqualität.
Daher bleiben `radiometricCalibrationVerified`,
`reflectanceReady`, `ndviReady`,
`ndreReady` und `operationalUseAllowed`
ausnahmslos `false`.

## Isolierte Nutzung

Für die Offline-Arbeit einen separaten Git-Worktree nutzen; mit
bestehenden produktiven Container-Stacks muss nichts gestartet werden:

```bash
cd ~/Projekte/SkyHub-Next
git fetch origin
git worktree add ~/Projekte/SkyHub-M3M-RasterQA \
  origin/feature/m3m-raster-bundle-qa-20261023
cd ~/Projekte/SkyHub-M3M-RasterQA

python3 -m venv .venv-m3m
. .venv-m3m/bin/activate
python -m pip install -r backend/workers/m3m_requirements.txt

# Unabhängige QA-Tests:
python -m unittest discover -s tests -p 'test_m3m_raster_bundle_verify.py' -v

# Optional: bestehendes experimentelles Analysepaket nachprüfen.
python backend/workers/m3m_raster_bundle_verify.py \
  --bundle /daten/analysen/m3m-experiment-001

# Integrationstests der automatischen Prüfung vor Veröffentlichung:
python -m unittest discover -s tests -p 'test_m3m_dedal_offline_pipeline.py' -v
```

Die als Beispiel genannten Pfade sind Platzhalter. Der QA-Worker führt
keine Schreiboperation aus; die Raster behalten ihre Georeferenzierung
und sind weiterhin als sensible Standortdaten zu behandeln.

## Qualitätssicherung

`tests/test_m3m_raster_bundle_verify.py` umfasst **15 lokale
synthetische GeoTIFF-Tests**, bestanden mit NumPy 2.3.5 und Rasterio 1.5.0.
Unter anderem werden veränderte NDVI-Werte, falsche NoData-Masken,
ungültige Reflexion, CRS-/Transformationsfehler, falsche Statistik,
Doppel-Schlüssel, fehlende Dateien und Freigabe-Manipulationen
abgelehnt. Die Tests prüfen zusätzlich, dass die Prüfung alle Dateien
unverändert lässt.

Der bestehende End-to-End-Testworker erhält einen **weiteren Testfall**:
Eine fehlschlagende unabhängige Abnahme muss die komplette
Veröffentlichung verhindern und temporäre Dateien aufräumen.

Das GitHub-Actions-Workflowfile
`.github/workflows/m3m-raster-offline.yml` installiert die
optionalen Raster-Abhängigkeiten und führt die beiden Testsuiten aus.
Eine erfolgreiche Prüfung im isolierten GitHub-Workflow und die
Abnahme mit echten DEDAL-M3M-Aufnahmen sind separate Anforderungen.

## Wissenschaftliche Grenzen

Die Radiometrie wird **nicht** innerhalb von SkyHub kalibriert.
Ein extern übergebener Status `accepted` ist kein
Kryptographie- oder Kalibrierungsnachweis. Die Pixelprüfung bestätigt
ausschließlich, dass die ausgegebenen Indexwerte zur übergebenen
Reflexionsmatrix passen. Ohne originale Kalibrierungsprotokolle,
Panelbezug und überprüfte Geometrie darf keine Düngekarte oder
Agras-/ISOBUS-Mission erzeugt werden.
