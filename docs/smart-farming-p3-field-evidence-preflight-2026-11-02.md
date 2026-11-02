# Smart Farming P3.6 – privater Mavic-3M-Feldbeleg-Preflight

Stand: 02.11.2026. Branch: feature/smart-farming-p3-field-evidence-preflight-20261102. Draft gestapelt auf #232 (P3.5b), #131 (P3.5a), #128 (COG P3.4). **Keine automatische Kalibrierung, DJI-Attestierung, Cloud-API-Routen oder Pi-Deployment.**

## Fachliche Einordnung

Die Mavic 3 Multispectral liefert vier spektrale Einzelbilder (Green, Red, Red Edge, NIR). Ihr integrierter Sonneneinstrahlungssensor erfasst Werte für eine nachgelagerte Lichtkompensation. Der DJI Mavic 3M Image Processing Guide beschreibt, dass eine radiometrische Umrechnung Sensor- und Sonnensensorwerte sowie Kalibrierkonstanten berücksichtigen muss. Der öffentlich dokumentierte DEDAL-Kalibrierungsweg korrigiert unter anderem Dunkelwert, Vignettierung, Belichtung/Gain und verwendet ein dokumentiertes Reflektanzpanel. Das bloße Vorhandensein einer Datei beweist **keinen** dieser Vorgänge.

Referenzen:
- DJI Produktdaten: https://enterprise.dji.com/mavic-3-m
- DJI Mavic 3M Image Processing Guide: https://dl.djicdn.com/downloads/DJI_Mavic_3_Enterprise/20230829/Mavic_3M_Image_Processing_Guide_EN.pdf
- DEDAL Kalibrierungsbeschreibung: https://dedal.jic.ac.uk/calibration/

## Technischer Vertrag

Der neue lokale, rein lesende Worker `backend/workers/m3m_field_evidence_preflight.py` verwendet zwei **vorher unabhängig gespeicherte SHA-256-Pins**:

1. **Originalaufnahme**: vier explizite TIFF-Pfade, ein separat gespeicherter, nicht veränderbarer `m3m_source_capture_receipt.py`-Bericht (`--source-receipt`) und dessen externer SHA-256-Wert. Der Worker dekodiert alle vier tatsächlichen TIFFs einschließlich der begrenzten XMP-CaptureUUID-/Bandhinweise erneut und vergleicht jeden Wert und ursprünglichen Datei-Hash mit dem angehefteten P1-Bericht. RGB ist aktuell **nicht Teil** dieses Preflight-Protokolls; seine eigene P1-Kandidatenprüfung ist davon unabhängig.
2. **Feldnachweise**: ein privates, kanonisches `field-evidence-manifest.json` und dessen extern gespeicherter SHA-256-Wert. Dieses Manifest beschreibt exakt fünf Kategorien und ihre unveränderlichen Namen. Für jede Kategorie wird entweder explizit `provided=false, filename=null, sha256=null, bytes=null` oder `provided=true` mit dem festen Dateinamen, einem begrenzten Datei-Hash und der Größe verlangt. Auch hier ist `contentScientificallyVerified=false` zwingend.

Die fünf getrennten Kategorien und Dateinamen:
- `sunlightSensor` → `sunlight-sensor-evidence.bin`: unvalidierte Sonnenlichtsensor-/DLS-Aufzeichnung
- `panelImage` → `panel-image-evidence.bin`: unvalidierte Aufnahme des Reflektanzpanels
- `panelCertificate` → `panel-certificate-evidence.bin`: unvalidierter Zertifikatsbeleg
- `bandRegistration` → `band-registration-evidence.bin`: unvalidierte Geometrie-/Registrierungsprüfung
- `independentReference` → `independent-reference-evidence.bin`: unvalidierte unabhängige Referenz

**Wichtig:** Die Dateien sind hier absichtlich undokumentierte Binär-/Textcontainer und werden **nicht inhaltlich interpretiert**. Es findet weder eine Berechnung von DLS-Signalwerten noch ein Abgleich des Zertifikats mit der Panelaufnahme statt. Die Evidenzklassen sind keine vom Hersteller vorgeschriebenen Dateinamen und nicht mit wissenschaftlich zertifizierten Belegen gleichzusetzen. Originale sensible Dateien niemals in Git oder `frontend/public/` speichern.

## Beispielmanifest erstellen

Das folgende ist ein **nicht wissenschaftlich validierter** Fall ohne zusätzliche Belege. Vor der Nutzung `field-evidence-manifest.json` in ein neues privates Verzeichnis (0700) schreiben, die Datei 0600 setzen und ihren Hash getrennt sichern.

~~~json
{"assets":[{"bytes":null,"contentScientificallyVerified":false,"filename":null,"kind":"sunlightSensor","provided":false,"sha256":null},{"bytes":null,"contentScientificallyVerified":false,"filename":null,"kind":"panelImage","provided":false,"sha256":null},{"bytes":null,"contentScientificallyVerified":false,"filename":null,"kind":"panelCertificate","provided":false,"sha256":null},{"bytes":null,"contentScientificallyVerified":false,"filename":null,"kind":"bandRegistration","provided":false,"sha256":null},{"bytes":null,"contentScientificallyVerified":false,"filename":null,"kind":"independentReference","provided":false,"sha256":null}],"calibrationVerified":false,"classification":"opaque-operator-evidence-unvalidated","operationalUseAllowed":false,"operatorClaimOfValidation":false,"schema":"skyhub-m3m-field-evidence-manifest-v1"}
~~~

Ein gültiges Manifest muss kompakt-kanonisch mit sortierten JSON-Schlüsseln, ohne doppelte Felder und **mit genau einem finalen Newline** geschrieben werden. Ein vom gerade vorliegenden Manifest abgelesener oder beim Prüfen neu berechneter Hash ist keine unabhängige Referenz. Angreifer könnten sonst Dateien **und** Manifest gleichzeitig ersetzen.

## Operator-Aufruf – ausschließlich offline

~~~bash
python3 backend/workers/m3m_field_evidence_preflight.py \
  --tiff /privat/original/G.tif \
  --tiff /privat/original/R.tif \
  --tiff /privat/original/RE.tif \
  --tiff /privat/original/NIR.tif \
  --source-receipt /privat/pruefbelege/capture-receipt.json \
  --source-receipt-sha256 EXTERN_GESICHERTER_CAPTURE_SHA256 \
  --evidence-dir /privat/feldbelege \
  --evidence-manifest-sha256 EXTERN_GESICHERTER_EVIDENCE_SHA256
~~~

Der P1-Aufnahmebeleg kann zunächst durch Aufruf von `m3m_source_capture_receipt.py` mit den vier `--tiff`-Argumenten erzeugt und in eine private 0600-Datei ausgegeben werden. Die einmalig verwendeten Bytes sind mit SHA-256 zu pinnen. **Ein späteres Recreate ersetzt diesen Original-Pin nicht.** Sensible Werte (CaptureUUID, absolute Pfade, Originalbildnamen, GPS und unvalidierte Nachweisdateien) erscheinen nicht im strukturierten Preflight-Ausgabebericht. Die fünf *generischen* Evidenzklassennamen werden dort angezeigt.

## Interpretation

Bei erfolgreicher Prüfung sind lediglich `originalBytesMatchIndependentReceiptPin=true` und `evidenceBytesMatchIndependentManifestPin=true` gesichert. `evidenceAssetsPresent`, `evidencePresentButUnvalidated` und `evidenceMissing` unterscheiden vollständige, teilweise und fehlende Beleginventare. Selbst `allEvidenceTypesSupplied=true` ist **keine wissenschaftliche Qualitätsbestätigung**.

Die folgenden Felder bleiben immer `false`: `scienceReady`, `djiHardwareProvenanceVerified`, `sunlightSensorValuesValidated`, `panelCalibrationVerified`, `independentGroundTruthVerified`, `sourceVerified`, `radiometricCalibrationVerified`, `bandCoregistrationVerified`, `reflectanceReady`, `ndviReady`, `ndreReady`, `operationalUseAllowed`, `prescriptionExportAllowed`, `flightMissionAllowed`.

## CI und nächste Gates

Die synthetischen Tests verwenden tatsächliche 16-bit-TIFFs mit XMP-Bandnamen und gemeinsamem CaptureUUID-Hinweis. Sie prüfen fehlende, vollständige und teilweise Belege; falsche Pins, Bytes, Dateirechte, Symlinks, zusätzliche Dateien, umbenannte/fehlende Bänder, gefälschte wissenschaftliche Flags und Änderungen während der Doppelprüfung. Reale Aufnahme- und Kalibrierungsnachweise bleiben für die separate Hardware-Abnahme erforderlich. Der nächste Schritt wäre **P3.6b: eine ausdrücklich begrenzte, whitelist-basierte Extraktion der dokumentierten DJI-M3M-DLS- und Kamera-Radiometriefelder mit Konfliktprüfung**, ohne Rohwerte ins Dashboard oder in öffentliche Logs zu schreiben.

Dieses Inkrement ändert weder aktive Server-Endpunkte noch Pi, MinIO, DJI, MQTT, das Datenbankschema oder die operative Missionsteuerung.
