# SkyHub Next – Integritätsbeleg für M3M-Analyseraster (offline)

Stand 23.10.2026. Entwicklungsbranch: `feature/m3m-raster-integrity-seal-20261023`.
**Kein DJI-Kalibrierungsnachweis, keine digitale Signatur, keine operative Freigabe.**

## Problem und Abgrenzung

Die bisherige Rasterpaket-QA verifiziert GeoTIFF-Pixel, NoData, Geometrie und
NDVI/NDRE/GNDVI/OSAVI. Um ein Analysepaket später im Smart-Farming-Dashboard
einzubinden, brauchen wir zusätzlich einen überprüfbaren Beleg, dass seit der
Abnahme keine Datei unbemerkt verändert wurde.

`backend/workers/m3m_raster_bundle_seal.py` erstellt einen
deterministischen **SHA-256-Inventarbeleg für genau elf Dateien**:

- vier GeoTIFFs aus `reflectance/`
- vier GeoTIFFs aus `indices/`
- `reflectance/report.json`, `indices/report.json` und `bundle-report.json`

Vor der Versiegelung und bei jeder späteren Prüfung wird die
vollständige unabhängige Raster-QA erneut ausgeführt. Die Dateien werden
vor und nach dieser QA gehasht. Nur wenn beide Inventare bytegleich sind
und die Pixel- und Berichtprüfung erfolgreich ist, wird der Beleg
erzeugt beziehungsweise als gültig bestätigt.

Die Dateinamen im Beleg sind feste relative Pfade. **Keine** lokale
Absolutpfade, CaptureUUID, Koordinaten oder Originalbild-Metadaten werden
darin gespeichert. Dennoch sind Inhaltshashes gegebenenfalls
personen- oder standortbeziehbar und dürfen nicht unkontrolliert
veröffentlicht werden.

## Zwei getrennte Befehle

Die Komponente nimmt **keine Änderungen am Rasterpaket** vor.
Der Integritätsbeleg wird ausdrücklich *außerhalb* des Pakets und
mit restriktivem Dateimodus 0600 in einem neu anzulegenden Dateipfad
geschrieben. Bereits vorhandene Belege werden nicht überschrieben.

```bash
cd ~/Projekte/SkyHub-Next
git fetch origin
git worktree add ~/Projekte/SkyHub-M3M-IntegrityLab \
  origin/feature/m3m-raster-integrity-seal-20261023
cd ~/Projekte/SkyHub-M3M-IntegrityLab

python3 -m venv .venv-m3m
. .venv-m3m/bin/activate
python -m pip install -r backend/workers/m3m_requirements.txt
python -m unittest discover -s tests \
  -p 'test_m3m_raster_bundle_seal.py' -v

# Das Bundle ist ein zuvor separat erzeugtes, fertiges M3M-Analysepaket.
python backend/workers/m3m_raster_bundle_seal.py create \
  --bundle /daten/analysen/m3m-experiment-001 \
  --seal /daten/pruefnachweise/m3m-experiment-001.seal.json

# Der erste Aufruf gibt ein sha256OfSeal aus. DIESEN HASH UNABHÄNGIG
# festhalten, z. B. in einem kontrollierten, schreibgeschützten Jobregister.
python backend/workers/m3m_raster_bundle_seal.py verify \
  --bundle /daten/analysen/m3m-experiment-001 \
  --seal /daten/pruefnachweise/m3m-experiment-001.seal.json \
  --seal-sha256 ZUVOR_UNABHAENGIG_FESTGEHALTENER_SHA256
```

Der SHA-256-Wert darf bei der späteren Prüfung **nicht einfach aus dem
momentan vorliegenden Beleg als angeblich unabhängige Referenz
übernommen werden**. Ein Angreifer könnte andernfalls zugleich Beleg
und Raster verändern.

## Was die Prüfung bestätigt

- Alle elf Artefakte stimmen bytegenau mit der unabhängig gepinnten
  Belegdatei überein.
- Die erneute unabhängige Raster-QA akzeptiert alle acht
  mathematisch und geometrisch konsistenten GeoTIFFs und die drei Berichte.
- Alle Readiness-Flags bleiben `false`; Manipulationen wie
  `operationalUseAllowed=true` werden auch bei neu berechnetem Beleg-Hash
  abgelehnt.
- Fehlende, zusätzliche, umbenannte und als Symlink eingebundene
  Dateien werden verweigert.

**Nicht nachgewiesen:** originale DJI-M3M-Herkunft, DEDAL-Lizenz
und Laufzeit, Reflexionspanel-Echtheit, korrektes Band-Coregistration,
signierte Audit-Trails oder radiometrisch gültige Vegetationskarten.
Die Prüfung ist kein Schutz gegen bösartige gleichzeitige Dateisystem-
Mutationen und ersetzt kein schreibgeschütztes oder content-addressed
Archiv. Diese Anforderungen gehören zur späteren Backend-Anbindung.

## Tests und CI

Mit synthetischen echten GeoTIFFs wurden die bisherigen **15 Tests der
Rasterpaket-QA** sowie **13 neue Integritätsbeleg-Tests** lokal ausgeführt:
**28 von 28 erfolgreich** (Python 3.13, NumPy 2.3.5, Rasterio 1.5.0).

Belegt werden unter anderem korrekte Versiegelung und Nachprüfung,
Dateimanipulation, Berichtänderung, falsche Prüfsummen, fehlende
Raster, Symlinks, unzulässige Freigabeflags, Pfad-Injektion,
doppelte JSON-Schlüssel und der Schutz bestehender Belege.
Der isolierte M3M-Actions-Workflow installiert die optionalen Rasterpakete
und führt beide Testsuiten aus. GitHub-CI-Abnahme sowie ein Test auf
echten M3M-Aufnahmen bleiben zusätzliche Freigabeschritte.

**Es gibt keinen Pi-Deploy, keine neuen Endpunkte, keine MQTT-/MinIO-
Aktionen und keine automatisierten Düngungsempfehlungen.**
