# P3.6d – Private M3M-Firmware-/Aufnahmekohortenmatrix

Stand: 02.11.2026. Gestapelter Draft auf P3.6c PR #250. Der Hauptbranch besitzt bereits P3.7 als Einzelaufnahmeprüfung (PR #249). Der neue Worker vergleicht mehrere Aufnahmen, ohne einen Firmwarestand oder Kalibrierung wissenschaftlich zu bestätigen.

## Inhalt

backend/workers/m3m_private_firmware_cohort_matrix.py liest zwei bis sechs operatorseitig deklarierte Firmwarekohorten, jeweils mit vier originalen TIFF-Dateien, separat gepinnten P1-Quellbelegen und P3.6-Feldbelegmanifesten. Eine private Firmwaredokumentdatei pro Kohorte wird anhand ihres SHA-256-Hashes geprüft. Inhalt und Authentizität dieses Dokuments werden nicht beurteilt. Unterschiedliche operatorseitige Firmwarelabels beweisen nicht unterschiedliche tatsächliche DJI-Firmwarestände.

Die Implementierung verwendet P3.7 zur Einzelaufnahmeprüfung und P3.6c für den privaten XMP-Strukturbericht. Jeder Fall wird komplett geprüft und anschließend **erneut** geprüft; dadurch können nachträgliche Änderungen einer vorherigen Aufnahme, des Firmwaredokuments oder der Feldbelege nicht unbemerkt bleiben.

## Privates Eingangsmanifest

Kanonisches UTF-8-JSON mit sortierten Schlüsseln, ohne Whitespace außer finalem Zeilenumbruch, als bereits bestehende Datei mit Rechten 0600 in einem Verzeichnis 0700. Der exakte SHA-256-Wert muss **zuvor separat aufbewahrt** worden sein.

Obere Felder:
- schema: skyhub-m3m-private-field-cohort-manifest-v1
- classification: private-operator-declared-cohorts-not-manufacturer-attested
- scientificApprovalClaim: false
- firmwareAttestedClaim: false
- cases: Array von zwei bis sechs Kohorten, slots A, B, C usw. ohne Lücken.

Je Fall exakt: slot, declaredFirmware, firmwareEvidenceFile, firmwareEvidenceSha256, firmwareEvidenceBytes, tiffs, sourceReceipt, sourceReceiptSha256, evidenceDir, evidenceManifestSha256.

Das Feld tiffs ist ein Objekt mit exakt G, R, RE und NIR als Pfadschlüsseln. declaredFirmware enthält ein operatorseitiges Label (maximal 48 ASCII-Zeichen, Buchstaben/Zahlen/._-), das niemals ausgegeben wird. firmwareEvidenceFile bezeichnet eine reguläre, höchstens 4 MiB große 0600-Datei in einem 0700-Verzeichnis; Hash und Größe müssen übereinstimmen. Alle Firmwaredokumente und Aufnahmebelege müssen unterschiedliche Hashwerte haben. Zwei unterschiedliche operatorseitige Firmwarelabels sind erforderlich. Nichtkanonische Pfade, Symlink-Verzeichnisaliasse, doppelte JSON-Schlüssel, überschüssige Felder und als wahr deklarierte Freigabeflags werden verweigert.

## Aufruf – offline und lesend

~~~bash
python3 backend/workers/m3m_private_firmware_cohort_matrix.py \
  --manifest-file /privat/m3m/kohorten/firmware-cohorts.json \
  --manifest-sha256 UNABHAENGIG_GESICHERTER_64_HEX_KOHORTEN_SHA256
~~~

Manifest, Originalbilder und Belege gehören in einen privaten Versuchsbereich, nicht in GitHub, öffentliche Webverzeichnisse oder ungeschützte MinIO-Buckets. Der Bericht enthält nur Slots A–F, bekannte Hersteller-XMP-Feldpräsenzen, unbekannte DJI-Feldanzahlen sowie vorhandene und fehlende (aber wissenschaftlich unvalidierte) Evidenzkategorien. Personen-/Gerätekennungen, CaptureUUID, Originaldateinamen, GPS, XMP-Rohwerte, Firmwarelabels, Firmwaredokumentinhalte und SHA-Pins erscheinen nicht.

## Quantitative Abweichungen: ausschließlich Struktur

Das Feld pairwiseStructuralDeltas enthält pro Kohortenpaar die Unterschiede in dokumentierten zusätzlichen DJI-XMP-Markern, fehlenden P3.6b-Pflichtmarkern, unbekannten DJI-Feldanzahlen und Evidenzkategorien. Diese Delta-Zähler sind **keine radiometrischen Messabweichungen**. quantitativeRadiometricDeviationComputed, scienceReady, firmwareVersionVerified, manufacturerSourceAuthenticityVerified, radiometricCalibrationVerified, sunlightSensorValuesValidated, panelCalibrationVerified, bandCoregistrationVerified, reflectanceReady, ndviReady, ndreReady, operationalUseAllowed, prescriptionExportAllowed und flightMissionAllowed bleiben falsch.

## Wissenschaftliche Freigabeschranken

Für eine reale Firmware-Kohortenstudie sind am Gerät unabhängig dokumentierte Firmwarestände, echte Mavic-3M-Vierband-TIFFs und private Quellhashes notwendig. Anschließend müssen DLS-/Panelreferenz, Korrekturen für Belichtung/Gain/Dunkelstrom/Vignettierung, Bandregistrierung und Reflektanzwerte mit unabhängigen Messwerten und definierten Toleranzen verglichen werden. Aktuell wird lediglich das Aufnahme-/Feldbeleginventar und die XMP-Struktur geprüft.

Automatisierte Tests: tests/test_m3m_private_firmware_cohort_matrix.py – echte synthetische TIFFs, Quellen und Hashbelege, Deltas, private Datenredaktion, manipulierte Inputs und Dokumente, Symlinks, doppelte oder unzulässige Manifeste, überoptimistische Flags sowie Mutationen einer früheren Kohorte während des Gesamtlaufs.

**Nur isoliertes Labor, kein main-Merge oder Pi-Deployment durch diesen Draft.**
