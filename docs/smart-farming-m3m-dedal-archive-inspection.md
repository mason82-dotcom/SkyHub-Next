# SkyHub Next – DEDAL-Archivinspektion und private Manifest-Nachprüfung

Stand: 23.10.2026 · Branch: feature/m3m-dedal-archive-inspection-20261023

**Status: rein offline, keine DEDAL-/OpenDroneMap-Ausführung, kein Pi-Deployment, keine API oder S3-Verbindung.**

## Warum diese Phase notwendig ist

Die offizielle Zenodo-Veröffentlichung
https://zenodo.org/records/23301986 bezeichnet den Datensatz als **v0.1.1**;
die darin enthaltene Softwaredatei heißt
`dedal-calibration-0.1.0.zip` und hat laut Zenodo die MD5
`8d59d0be195d361bca076411b1c6da6e`. Der Name des ZIP-Archivs
ist damit kein sicherer Beleg für die Softwareversion oder die CLI.

Diese Phase ergänzt PR #59 und führt **keinen** unbekannten Fremdcode aus.
Eine reale DEDAL-CLI wird erst nach Prüfung des tatsächlich lokal
vorliegenden Archivs und seiner Lizenz-/Abhängigkeitsdateien spezifiziert.

## 1. Statische Archivinspektion

`backend/workers/m3m_dedal_archive_inspect.py` liest ein lokal
vorhandenes ZIP, dessen Dateiname exakt dem veröffentlichten Namen
entspricht. Es akzeptiert nur ein Archiv, dessen SHA-256 mit einem
**separat vorgegebenen Pin** und dessen MD5 mit dem auf Zenodo
veröffentlichten Wert übereinstimmen.

Weitere Checks:

- ZIP-Einträge müssen unter `dedal-calibration-0.1.0/` liegen.
- Pfadtraversal, Symlinks, verschlüsselte Einträge und doppelte Namen
  werden abgelehnt.
- Es gelten restriktive Grenzen für Archivgröße (20 MiB),
  höchstens 300 Einträge, entpackte Gesamtgröße (150 MiB) und
  komprimierte Quelltext-Metadaten.
- Für diesen konservativen Profilentwurf werden u. a.
  `pyproject.toml`, `README.md`, `LICENSE`,
  `panelcal/calibrate.py`, `panelcal/radiometry.py`,
  `panelcal/panels.py` und `panelcal/task.py` verlangt.
  **Das Vorhandensein dieser exakten Pfade wurde noch nicht anhand der
  heruntergeladenen Originaldatei abgenommen**. Abweichungen sollen
  zunächst fail-closed sichtbar werden, nicht geraten werden.
- `pyproject.toml` wird mit `tomllib` und
  `panelcal/calibrate.py` mit `ast` **nur statisch**
  geparst. CLI-Definitionen werden nach Syntax geprüft, aber nicht
  importiert oder ausgeführt.

Der JSON-Output enthält nur aggregierte Befunde, keine Quelltexte,
keine dynamischen CLI-Befehle und keine lokalen Pfade.
`cliRuntimeVerified=false`, `dedalExecuted=false`,
`calibrationVerified=false` und
`operationalUseAllowed=false` bleiben fest ausgeschaltet.

## 2. Private Manifest-Nachprüfung

`backend/workers/m3m_dedal_manifest_recheck.py` nimmt ausschließlich
eine bereits lokal erzeugte `private-preflight.json` aus PR #59
sowie deren separat festgehaltenen SHA-256 als Eingabe.

Es prüft erneut:

- Manifest-Hash und eindeutige JSON-Schlüssel
- alle TIFF-Datei-Hashes und Dateigrößen für die gespeicherten
  vierbandigen Capture-Gruppen
- SHA-256 des Reflexionspanel-Zertifikats
- SHA-256 und veröffentlichte MD5 der DEDAL-ZIP-Datei
- reguläre Dateien, No-Symlink-Regeln, harte Links, Pfadflucht,
  einmalige Capture-Gruppen und Panel-Gruppe als Teil des Inventars
- alle unverändert auf `false` gesetzten Freigaben

Es wird **nichts geschrieben**, und die standardmäßig ausgegebene
JSON-Zusammenfassung enthält keine privaten Pfade, Bildnamen oder
CaptureUUIDs. Die private Manifest-Datei selbst enthält dagegen
identifizierbare Aufnahmedaten und darf nur in einer geschützten
Arbeitsumgebung liegen.

Diese Nachprüfung verhindert die unbemerkte Verwendung einer inzwischen
veränderten Datei beim späteren Jobstart, sofern die Daten während der
Prüfung stabil bleiben. Sie ist **keine** kryptografische Signatur und
keine Dateisystem-Sandbox; Prozessstart und Verarbeitung müssen die
Hashbindung erneut beziehungsweise über unveränderliche Snapshots absichern.

## Offline-Nutzung (separater Worktree)

```bash
cd ~/Projekte/SkyHub-Next
git fetch origin
git worktree add ~/Projekte/SkyHub-Dedal-Inspection \
  origin/feature/m3m-dedal-archive-inspection-20261023
cd ~/Projekte/SkyHub-Dedal-Inspection

python3 -m unittest discover -s tests -p 'test_m3m_dedal_archive_inspect.py' -v
python3 -m unittest discover -s tests -p 'test_m3m_dedal_manifest_recheck.py' -v

# Platzhalter: offizielles ZIP zunächst separat beschaffen und prüfen.
python3 backend/workers/m3m_dedal_archive_inspect.py \
  --archive /daten/software/dedal-calibration-0.1.0.zip \
  --archive-sha256 VERIFIZIERTER_UNABHAENGIGER_SHA256

# Private Manifest-Prüfung vor einem späteren Workerstart.
# Den Manifest-SHA256 zuvor unabhängig im lokalen geschützten
# Jobverzeichnis ermitteln und dort als freigegebenen Pin dokumentieren.
python3 backend/workers/m3m_dedal_manifest_recheck.py \
  --manifest /daten/jobs/auftrags-id/private-preflight.json \
  --manifest-sha256 PRIVAT_FESTGEHALTENER_SHA256
```

Bei einem Fehler geben beide Tools nur eine feste Fehlerklasse und
Exit-Code 2 aus, keine privaten Quelldaten oder Dateipfade.

## Abnahme und Grenzen

Die beiden zusätzlichen Testmodule enthalten jeweils **14 Tests** mit
rein synthetischen Testdateien, zusammen **28 Tests**.
Einschließlich der bestehenden **16 Preflight-Tests** wurden lokal
**44 von 44** Standardbibliothek-Tests erfolgreich ausgeführt.

Die Tests weisen **nicht** nach, dass die echte ZIP-Datei die hier
angenommene Quelltextstruktur besitzt. Die Paketinspektion behauptet
auch keine ausführbare oder sichere CLI. Das verwendete Testarchiv
enthält ausschließlich künstliche, nicht ausgeführte Inhalte; die
Test-MD5 wird im Testlauf gesondert ersetzt.

Zur tatsächlichen Kalibrierungsabnahme fehlen weiterhin:
unabhängig dokumentierter SHA-256 des offiziellen DEDAL-ZIPs,
Lizenz-/Abhängigkeitsprüfung, CLI-Vertrag, reale Mavic-3M-
Originalaufnahmen samt Panelreferenzen sowie eine wissenschaftliche
Prüfung von Reflektanz und räumlicher Bandregistrierung.

**Keine agronomischen Entscheidungen, NDVI-Bereitschaft oder
Agras-/ISOBUS-Verordnungen werden damit freigeschaltet.**
