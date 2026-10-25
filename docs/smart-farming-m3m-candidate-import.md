# SkyHub-Next Smart Farming – verifizierte experimentelle Kartenkandidaten

**Sicherheitsnachtrag 24.10.2026 (Draft, noch nicht in `main`):**
Der Python-Kandidatenworker veröffentlicht sein privates Ergebnis unter
Linux jetzt mit `renameat2(RENAME_NOREPLACE)`. Anders als das bisherige
`os.rename()` darf dieser atomare Systemaufruf **auch ein zwischenzeitlich
angelegtes leeres Zielverzeichnis niemals ersetzen**. Der vorherige
`lexists()`-Check allein schloss dieses Race nicht aus.

Die Veröffentlichung findet weiter im selben übergeordneten Verzeichnis
statt. Ist der Linux-Systemaufruf oder die atomare No-Replace-Funktion
des Dateisystems nicht verfügbar, wird **ohne unsicheren Fallback**
abgebrochen. Das setzt für Kandidatenregistrierungen in dieser Fassung
ein unterstütztes Linux-Dateisystem voraus; ein macOS-/Windows-Port
braucht eine eigene fachlich geprüfte atomare Implementierung.

Vier zusätzliche isolierte Tests prüfen eine deterministisch zwischen
Check und Veröffentlichung erzeugte **leere** Zieldirectory, bereits
existierende leere Ziele, erfolgreiche No-Replace-Veröffentlichung
sowie den Fail-Closed-Zweig auf nicht unterstützten Plattformen.
Echter M3M-Hardwarebetrieb, radiometrische Kalibrierung und
Anwendungen im Feld sind weiterhin **nicht freigegeben**.


Stand: 23.10.2026; Entwicklungsbranch:
`feature/m3m-smart-farming-candidate-20261023`.

**Dies ist eine lokale Import-VORSTUFE, keine Dashboard-, API-, MinIO-,
PostGIS- oder Produktivintegration.** Sie vergibt keinerlei agronomische
oder radiometrische Freigaben.

## Datenfluss

1. Ein extern erzeugtes, bereits orthorektifiziertes DEDAL-/ODM-M3M-
   Fünfband-Orthomosaik wird im bestehenden experimentellen Workflow
   in vier Float32-Reflexions- und vier Vegetationsindex-Raster verarbeitet.
2. PR #77 prüft unabhängig Pixelmathematik, NoData, Rastergeometrie und
   Statistik. PR #79 erstellt und verifiziert einen SHA-256-Integritäts-
   beleg für alle acht GeoTIFFs und drei JSON-Berichte.
3. Die neue Datei `backend/workers/m3m_smart_farming_candidate.py`
   **verlangt** das vollständige Ergebnisverzeichnis, den außerhalb
   gespeicherten Beleg und dessen **unabhängig dokumentierten SHA-256**.
   Sie ruft die echte `verify_seal()`-Prüfung einschließlich vollständiger
   Raster-QA erneut auf. Fehlschläge führen zu keiner Registrierung.
4. Zusätzlich wird die Version und SHA-256 des versiegelten
   Index-Berichts geprüft, bevor vier *nichtoperative* Kartenkandidaten
   erzeugt werden: NDVI, NDRE, GNDVI und OSAVI.

Das Resultat ist eine einzelne **private** Datei
`candidate.json` in einem neuen lokalen Verzeichnis mit Modus
0700; die Datei hat Modus 0600. Das ursprüngliche Rasterpaket und
der externe Beleg werden nicht verändert. Ein vorhandenes Ziel wird
niemals überschrieben.

## Sicher im isolierten Worktree verwenden

```bash
cd ~/Projekte/SkyHub-Next
git fetch origin
git worktree add ~/Projekte/SkyHub-SmartFarming-Lab \
  origin/feature/m3m-smart-farming-candidate-20261023
cd ~/Projekte/SkyHub-SmartFarming-Lab

python3 -m venv .venv-m3m
. .venv-m3m/bin/activate
python -m pip install -r backend/workers/m3m_requirements.txt

python -m unittest discover -s tests \
  -p 'test_m3m_smart_farming_candidate.py' -v

# Bestehende /daten/-Pfade hier NUR Platzhalter!
# Ein unabhängig gespeicherter Hash ist zwingend erforderlich.
python backend/workers/m3m_smart_farming_candidate.py \
  --bundle /daten/m3m/experiment-001 \
  --seal /daten/pruefnachweise/experiment-001.seal.json \
  --trusted-seal-sha256 UNABHAENGIG_DOKUMENTIERTER_SHA256 \
  --output-dir /daten/privater-katalog/kandidat-001
```

## Schema für spätere Anzeige

Auszüge aus dem privaten `candidate.json`:

- `schema=skyhub-m3m-smart-farming-candidate-v1`
- `candidateId`: stabiler, pseudonymer Identifier, aus dem
  bereits gepinnten Beleg-Hash abgeleitet. Der Hash kann
  datensatzübergreifende Korrelation ermöglichen; deshalb
  auch den Kandidaten vor unbefugtem Zugriff schützen.
- `state=experimental_candidate`, keine automatische Hochstufung
  zu einem einsatzbereiten Vegetationsprodukt
- `indexLayers`: vier fest vorgegebene Kategorien mit
  dimensionslosen `mean/min/max`-Werten und `validPixels`;
  es werden **keine** Raster-URLs, lokalen Dateipfade, GPS-Positionen
  oder DJI-Gerätekennungen veröffentlicht
- `integrity.rasterQaPassedAtRegistration=true` dokumentiert nur
  den erfolgreichen **zeitpunktbezogenen** Read-only-Nachweis
- `geolocationPublished=false`, `tileUrlsPublished=false`,
  `mapTilesAvailable=false` für jeden Index
- `cameraProvenanceVerified=false`,
  `radiometricCalibrationVerified=false`,
  `bandCoregistrationVerified=false`,
  `reflectanceReady=false`, `ndviReady=false`,
  `ndreReady=false`, `operationalUseAllowed=false`,
  `prescriptionExportAllowed=false`,
  `flightMissionAllowed=false`

Das Format eignet sich später für eine **interne, gekennzeichnete
experimentelle Kartenliste**, nicht für eine Kartendarstellung:
Ein authentifizierter Tile-Dienst, Autorisierung, Zugriffskontrolle,
serverseitige Pfad- und Datensatzauflösung und eine erneute
Integritätsprüfung *am Nutzungszeitpunkt* müssen dafür separat
implementiert und abgenommen werden.

## Tests und wissenschaftliche Grenzen

Das Modul ist lokal unter Python 3.13 mit **18 von 18
Standardbibliothek-Unit-Tests** getestet. Zwei zusätzliche
Integrationstests nutzen auf einem vollständigen Repository-Checkout
echte synthetische GeoTIFFs und den **nicht gemockten** Seal-/QA-Worker.
Sie werden bei fehlendem Raster-Worker bzw. fehlenden optionalen
Paketen lokal übersprungen und über den isolierten GitHub-Actions-
Workflow auf dem Gesamt-Repository ausgeführt. Ein bestandener
GitHub-CI-Test ist gesondert nachzuweisen.

Die Unit-Tests prüfen korrumpierte Pins und Berichte, doppelte
JSON-Felder, gefälschte Freigaben, nichtfinite Kennzahlen,
ungültige Rasterkennungen, Zielverzeichnisschutz, Symlinks,
Informationsminimierung und Ablehnung unbestätigter
Integritätsprüfungen.

**Weder die neue Kandidatenregistrierung noch ein SHA-256-Nachweis
bestätigen DEDAL-Kalibrierung, Mavic-3M-Bildherkunft, exakte
Bandregistrierung oder wissenschaftliche Qualität.** Es werden keine
Dünge- oder Spritzkarten, ISOBUS-Dokumente oder DJI-Flugmissionen
erzeugt.

## Nächste Schritte

Erst bei erfolgreicher CI und geprüften M3M-Originaldaten:
1. Authentifizierten, nur lesenden Kandidaten-Katalog entwerfen,
   niemals beliebige `candidate.json`-Pfade aus Client-Requests öffnen.
2. Private Registerzuordnung zu unveränderlichen Artefaktversionen,
   Autorisierungsprüfungen und erneute Receipt-Verifikation vor
   jeder Kartenkachel bereitstellen.
3. Einen ausdrücklich als **experimentell** gekennzeichneten
   Smart-Farming-Tab hinzufügen; GIS-Vorschauen bleiben bis dahin aus.
