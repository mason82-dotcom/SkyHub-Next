# SkyHub Next – DEDAL-Kalibrierungsauftrag: Offline-Preflight

Stand: 23.10.2026 · Branch: feature/m3m-dedal-preflight-20261023
**Status: nicht ausführender Vorabprüfer, keine automatische Kalibrierung.**

## Evidenz und Versions-Pinning

- Offizieller Software-Datensatz: https://zenodo.org/records/23301986, Datensatz **0.1.1** (11.10.2026).
- Im Datensatz herunterladbare ZIP-Datei: **dedal-calibration-0.1.0.zip** (abweichende Archivbezeichnung).
- Von Zenodo veröffentlichte Datei-MD5: **8d59d0be195d361bca076411b1c6da6e**.
- Quellenformat für das Kalibrierpanel: https://dedal.jic.ac.uk/docs/reference/
- Prozessbeschreibung und Qualitätsgrenzen: https://dedal.jic.ac.uk/calibration/

Der Preflight **lädt keine fremde Software herunter, importiert oder entpackt sie
nicht und startet weder DEDAL noch OpenDroneMap**. Er verlangt die lokale
ZIP-Datei mit dem offiziellen Namen, vergleicht ihren SHA-256 mit einem
**ausdrücklich separat vorgegebenen** Wert und zusätzlich ihre MD5 mit
der bei Zenodo sichtbaren MD5. Eine veröffentlichte MD5 allein bietet
keinen modernen kryptographischen Authentizitätsnachweis. Das Archiv wurde
in dieser Entwicklungsrunde nicht heruntergeladen und nicht als ausführbar
validiert; auch die echte DEDAL-CLI ist noch nicht integriert.

Zusätzlich prüft das Programm die ZIP-Inhaltsstruktur nur anhand der
Verzeichniseinträge auf Traversal, Symlinks, Verschlüsselung und unerwartete
Dekompressionsgrößen. Es führt dabei **keinen ZIP-Code aus**.

## Was der Preflight akzeptiert

- Ein **nicht rekursives**, lokal bereits vorhandenes Verzeichnis mit
  exakt benannten Mavic-3M-TIFFs `DJI_YYYYMMDDHHMMSS_NNNN_MS_{G,R,RE,NIR}.TIF`.
  Bei unbekannten TIFF-Namen, Dubletten, beschädigtem TIFF-Magic oder
  fehlenden Banddateien wird ohne positives Ergebnis abgebrochen.
- Mindestens **eine vollständige Aufnahmegruppe** als vom Bediener
  markierte Reflexionspanel-Aufnahme und mindestens **eine weitere**
  vollständige Aufnahmegruppe für den Feldflug.
- Maximal **2.500 TIFFs**, höchstens **10.000 Verzeichniseinträge** insgesamt,
  höchstens 128 MiB pro TIFF. Dateinamen und SHA-256 werden nur im
  lokalen privaten Manifest abgelegt, nicht auf stdout veröffentlicht.
- Eine lokale Reflexionspanel-JSON nach offiziellem DEDAL-Schema:
  `bands.G/R/RE/NIR.reflectance` als **Fraktionen zwischen 0 und 1**;
  optionale Wellenlängen müssen plausibel sein. Doppelte JSON-Schlüssel
  und ungültige Zahlen werden abgelehnt.

**Wichtige Einschränkung:** Der Check liest pro TIFF nur Dateikopf und
Hash, nicht die Pixel und auch nicht die XMP-Bandmarker. Vollständigkeit
bezieht sich zunächst ausschließlich auf die Dateinamen.
Die Behauptung, welche Aufnahme ein Panel zeigt, wird nicht durch
Bildanalyse bewiesen. Der bisherige TIFF-Payload-Auditor ist dafür ein
separater, nachgelagerter Prüfschritt.

## Sicher lokal ausführen

Ein separater Git-Worktree ist vorgesehen; kein Docker, MQTT, MinIO oder
SkyHub-Webserver muss dafür gestartet werden:

```bash
cd ~/Projekte/SkyHub-Next
git fetch origin
git worktree add ~/Projekte/SkyHub-DEDAL-Preflight \
  origin/feature/m3m-dedal-preflight-20261023
cd ~/Projekte/SkyHub-DEDAL-Preflight

python3 -m unittest discover -s tests -p 'test_m3m_dedal_preflight.py' -v

# Der SHA-256 muss als erwarteter Wert separat festgelegt werden.
# Die Pfade, IDs und Dateinamen hier sind ausschließlich Platzhalter.
python3 backend/workers/m3m_dedal_preflight.py \
  --archive /daten/software/dedal-calibration-0.1.0.zip \
  --archive-sha256 EXPECTED_SHA256_FROM_TRUSTED_SOURCE \
  --panel /daten/panel/reflectance-certificate.json \
  --images /daten/m3m-originalaufnahmen \
  --panel-capture DJI_20261023070000_0001 \
  --output-dir /daten/analysen/dedal-job-preflight-001
```

Die erwartete SHA-256 darf nicht einfach unkritisch aus dem gerade
heruntergeladenen Archiv übernommen und als unabhängige Authentizitätsprüfung
bezeichnet werden. Fehlen Archiv oder ein unabhängig dokumentierter Hash,
ist der erfolgreiche Abschluss dieses Prüfschrittes noch nicht möglich.

## Ergebnis, Privatsphäre und Betriebsgrenzen

Bei Erfolg entsteht **ein neues privates lokales Verzeichnis (0700)** mit
`private-preflight.json` (**0600**). Das Manifest enthält die Dateinamen,
lokale Pfade, geprüften Dateihashes, Panel-Reflexionsfraktionen und die als
Panelaufnahmen gekennzeichneten Capture-Namen. **Diesen Inhalt nicht ins
öffentliche GitHub-Repository, in Tickets oder in Chat-Nachrichten kopieren.**
Die öffentliche CLI-Antwort enthält nur aggregierte Zähler, feste Statusfelder
und keine Bildnamen/Seriennummern/Koordinaten/Capture-IDs.

Das Ergebnis ist ausdrücklich **kein** DEDAL-Verarbeitungsergebnis:
`dedalExecuted=false`, `calibrationVerified=false`,
`reflectanceReady=false`, `operationalUseAllowed=false`.

Der Job wird **nicht** ausgeführt; weder die Originale noch der produktive
Raspberry-Pi-Stack werden verändert. Ein Preflight-Manifest kann durch
Änderung der Ursprungsdateien später veralten; ein echter Worker muss
sämtliche Dateihashes unmittelbar vor der Ausführung erneut überprüfen.
Dies ist keine Sandbox für feindliche Dateisystem- oder ZIP-Inhalte.

## Tests

`tests/test_m3m_dedal_preflight.py` führt 16 reine Python-Standardbibliothek-
Tests aus (synthetische ZIPs, Dummy-TIFF-Magic und Zertifikate). Die
Tests decken Checksum-Mismatch, vollständige Vierband-Dateigruppen,
Panel-/Flug-Trennung, unerwartete TIFFs, widersprüchliche Banddateinamen,
Symlinks, ungültige Zertifikatswerte, doppelte JSON-Schlüssel,
ZIP-Traversal, Schreibschutz vorhandener Ergebnisse und Pfadredaktion ab.
Die ZIP-MD5-Prüfung wird in positiven **Testfällen explizit injiziert**;
kein Test gibt vor, das tatsächliche Zenodo-Archiv überprüft zu haben.

## Nächste Integrationsstufe

Erst nach Vorliegen eines realen Mavic-3M-Fluges samt Panelaufnahmen und
des unabhängig geprüften offiziellen DEDAL-Archivs die tatsächliche CLI
und Kalibrierungsbericht-Struktur untersuchen. Anschließend einen
isolierten, ressourcenbegrenzten Prozess mit expliziter Dateizugriffsliste
und erneuter Hashprüfung entwickeln; nur der verifizierte
Kalibrierungsbericht darf später den DEDAL-Orthomosaik-Adapter beliefern.
Kein agronomischer Einsatz oder Ausbringkarten-Export vor Geräte- und
Qualitätsabnahme.
