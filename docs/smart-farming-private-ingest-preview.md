# SkyHub Smart Farming: P1 privater Originaldatei-Snapshot und P3 geschützte Vegetationsvorschau

Stand 02.11.2026 · **Offline-Labor, Quellcode-Konsolidierung aus Draft #114**. Die isolierten TIFF-/ROI-Worker aus #113 sind bereits auf `main` (PR #229); die hier beschriebenen lokalen P1-Snapshot-/P3-PNG-Worker und synthetischen Tests werden separat auf aktuellem `main` überprüft. Kein Pi-Deployment, kein HTTP, kein DJI-Publish oder produktiver Medienzugang.

## P1 – lokale Erfassung, Originalbytes unverändert

`backend/workers/m3m_private_snapshot.py` ergänzt den bestehenden `m3m_source_capture_receipt.py`. Erwartet **vier echte lokal vorhandene** TIFF-Spektralbänder G/R/RE/NIR mit privaten XMP-Übereinstimmungshinweisen. Exakt diese Bytes werden unverändert in ein neu reserviertes, privates Zielverzeichnis kopiert. Fest benannte Dateien `G.tif`, `R.tif`, `RE.tif`, `NIR.tif`, optional `RGB.jpg`; Rechte Zielordner 0700 und Dateien 0600. Nach SHA-256/Größen-/Dateistabilitäts- und neuerlicher Quellauditprüfung wird `manifest.json` als letzter, vollständiger Commit-Marker veröffentlicht. Bei einem regulären Fehler wird das neu angelegte Verzeichnis entfernt; ein unerwarteter Prozessabbruch kann einen unvollständigen Ordner hinterlassen, der **ohne manifest.json nicht als importiert gilt**. Vorbestehende Ziele werden abgewiesen, niemals überschrieben.

Das JPEG wird nur auf Header/Bytes/Hash geprüft; **keine vollständige JPEG-Decodierung oder RGB/Multispektral-Co-Registrierung**. Die XMP-Band-/Capture-Übereinstimmung ist kein unabhängiger DJI-Sensor-Herkunftsnachweis und keine Reflektanzkalibrierung.

Beispiel in eigenständiger, privater Testumgebung (nur wenn echte Dateien bereits vorhanden sind):

~~~bash
python3 backend/workers/m3m_private_snapshot.py \
  --tiff /privat/m3m/G.tif --tiff /privat/m3m/R.tif \
  --tiff /privat/m3m/RE.tif --tiff /privat/m3m/NIR.tif \
  --rgb /privat/m3m/D.JPG \
  --output-dir /privat/skyhub-captures/capture-001
~~~

Diese lokale Kopie ist keine Cloud-/MinIO-Einbindung und implementiert keine allgemeine Batch-Queue. Objektstore, Backup/Restore, Auth und Quotas bleiben gesonderte Arbeiten.

## P2 – numerischer Rasterkern weiterhin nur experimentell

Alle Datenherkunfts-/Kalibrierungs-/Flug-/Agras-/Applikationsbereitschaftsflags verbleiben strikt auf `false`. Das Snapshot-Manifest kann nicht als Eingabe einer DN→Reflektanz-Kalibrierung missverstanden werden. Radiometrische Korrektur mit BlackLevel, Gain, Exposure, Vignettierung, DLS/Panel, Bandregistrierung und Orthomosaik-Rekonstruktion bleibt durch reale DJI-M3M-Fixtures nachzuweisen. Die experimentelle extern vorverarbeitete Float32-GeoTIFF-Kette und die lokalen Pixel-/ROI-Worker liegen bereits auf `main`; das beweist weiterhin keine echte Kalibrierung.

## P3 – private visuelle Preview, keine quantitative Quelle

`backend/workers/m3m_private_index_preview.py` erstellt aus einem **vollständig unabhängig gepinnten**, acht Raster umfassenden, experimentellen Bundle auf `main` eine NDVI-/NDRE-/GNDVI-/OSAVI-Vorschau als **PNG RGBA**. Keine Georeferenz-/EXIF-/GPS-Metadaten in der PNG-Datei. Vor und nach dem Rasterzugriff erfolgen die vollständigen Seal-/Pixelprüfungen. Der SHA-256 des Siegels **muss unabhängig vom Bundle** bestimmt sein. Die Funktion ist nur nach `--private-output-ok` aktiv, liefert maximal 512 Pixel Kantenlänge, feste konservative Farbpalette, transparentes NoData und eine 0600-Bilddatei. Die Original-GeoTIFFs werden nicht verändert. Die Farben sind rein visuell; aus RGB-Pixeln werden **keine** quantitativen NDVI-Werte rückgerechnet. Feldmuster in der PNG sind weiterhin vertrauliche Betriebsinformationen.

~~~bash
python3 backend/workers/m3m_private_index_preview.py \
  --bundle /isoliert/experimentelles-raster-bundle \
  --seal /vertrauensquelle/receipt.json \
  --seal-sha256 <wirklich-unabhaengig-ermittelter-64-hex-hash> \
  --index ndvi \
  --output-file /privat/ansichten/ndvi-vorschau.png \
  --private-output-ok
~~~

Die Klammer für den SHA ist nur Platzhaltertext, **kein ausführbarer Wert**.

## Abnahme und Grenzen

Neu: `tests/test_m3m_private_snapshot.py` (Originalbytes, Rechte, Manifest, Unveränderlichkeit, Rollback, JPEG-Hinweis) und `tests/test_m3m_private_index_preview.py` (echte synthetische Float32-GeoTIFF/Seal-Fixture, PNG-RGBA, explizite Privatfreigabe, Tamper-Negativtests). Ausführung via vorhandene `test_m3m_*.py`-Tests im GitHub Actions Rasterjob. Die M3M-Raster-CI muss für diesen neuen PR komplett erfolgreich sein. Auch eine grüne CI beweist nicht, dass echte Mavic-3M-Aufnahmen oder eine quantitative Kalibrierung validiert wurden.

**Nächste reale Schritte:** (1) M3M-Vollaufnahme inklusive Kalibrierungsmetadata/Panel als vertrauliche Lab-Fixture; (2) DJI-/ODM-/Terra-Vergleich und quantitativer Korrektheitsbericht; (3) autorisierte Tile-/Pixel-API mit Raster- und Workspace-Pinning sowie Android-Browser-Hardwaretest; (4) echte GIS-GeoTIFF/COG-Exportabnahme. Alle Schritte nur isoliert und ohne Flugbefehle.
