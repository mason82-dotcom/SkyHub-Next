# M3M P3.7 – privater Feldaufnahme-Prüfbericht (nur offline)

**Stand 02.11.2026.** Der P3.7-Worker verknüpft die bereits integrierten P3.6a- (#245) und P3.6b- (#246) Prüfungen. Das Ergebnisbeleg-Replay P3.5d (#248) prüft getrennte numerische GeoTIFF-Referenzen und ist **kein** Beweis für die Herkunft von Originalbildern. Der Worker ist weder in der laufenden SkyHub-API noch in Docker Compose eingebunden.

## Eingänge und Vertrauensgrenzen

Das lokale, rein lesende Python-CLI-Programm backend/workers/m3m_private_field_review.py verlangt vier unveränderte originale Multispektral-TIFFs (G, R, RE und NIR), den P1-Aufnahmebeleg (m3m_source_capture_receipt.py) samt **vorher extern archiviertem** SHA-256-Hash und ein separates privates P3.6a-Feldbelegmanifest samt **zweitem zuvor extern archiviertem** SHA-256-Hash.

Der P1-Beleg muss vorher aus den Originaldateien erstellt, privat aufbewahrt und unveränderlich referenziert werden. Die unter docs/smart-farming-p3-field-evidence-preflight.md beschriebenen fünf Feldbelegkategorien sind alle im Manifest vorhanden, entweder mit provided=true plus konkreten geschützten Dateien oder mit provided=false und Nullfeldern. Auch vollständig vorhandene Belege sind operatorseitige, **wissenschaftlich unvalidierte** Informationen.

P3.7 führt zuerst den vollständigen Feldbeleg-Preflight aus, dann den begrenzten Radiometrie-XMP-Audit und **danach den vollständigen Eingangsaudit erneut**. Die Komponenten prüfen ihrerseits wiederholt Hashes, Dateibytes, Geometriehinweise und XMP-Bandzuordnung; späte Mutationen schlagen fehl. Es werden keine Originaldateien, Manifeste oder Berichtdateien geschrieben und keinerlei Netzwerk-/MQTT-/DJI-/S3-/PostGIS-Operationen ausgelöst.

## Lokaler Aufruf für echte Originalaufnahmen

Das Beispiel enthält Platzhalter; Namen, Belege und Pins müssen zum tatsächlich vorliegenden Aufnahmequartett passen.

~~~bash
python3 backend/workers/m3m_private_field_review.py \
  --tiff /privat/m3m/G.tif \
  --tiff /privat/m3m/R.tif \
  --tiff /privat/m3m/RE.tif \
  --tiff /privat/m3m/NIR.tif \
  --source-receipt /privat/aufnahmebelege/capture.json \
  --source-receipt-sha256 ZUVOR_EXTERN_ARCHIVIERTER_64_ZEICHEN_HASH \
  --evidence-dir /privat/feldnachweise \
  --evidence-manifest-sha256 SEPARAT_ARCHIVIERTER_64_ZEICHEN_HASH \
  --require-complete-structure
~~~

**Exit-Code 0:** Alle sieben bekannten verpflichtenden DJI-Radiometrie-XMP-Feldtypen und alle fünf Belegarten sind *strukturell vorhanden*, jedoch **nicht wissenschaftlich validiert**.
**Exit-Code 3:** Die Eingangsprüfungen sind erfolgreich, aber erforderliche XMP-Felder oder Belegarten fehlen; der begrenzte JSON-Bericht enthält deren Namen und Zähler.
**Exit-Code 2:** Originaldateien, Hashes, Datei-/Manifestbedingungen oder ein Prüfschritt sind ungültig. Kein positiver JSON-Bericht.

Ohne --require-complete-structure ist der Exit-Code nach einem gültigen Eingangs-Audit immer 0, unabhängig von der Zahl fehlender Belege. Den Status deshalb **immer** aus reviewState lesen: STRUCTURAL_FIELDS_PRESENT_UNVALIDATED oder INCOMPLETE_EVIDENCE_OR_XMP_UNVALIDATED. **In keinem Fall** handelt es sich um eine wissenschaftliche Hardwareabnahme, eine Kalibrierbescheinigung oder eine Missionsfreigabe.

## Datenschutz und reproduzierbare Abnahme

P3.7 gibt nur fünf abstrakte Belegstatusklassen und aggregierte XMP-Marker-Zähler aus. Original-GPS, CaptureUUID, Sensorzahlen, Panelmesswerte, Roh-XMP, Seriennummern, externe SHA-256-Pins und private Pfade verlassen das Modul nicht. Die Ausgabe enthält konstant radiometricCalibrationVerified=false, panelCalibrationVerified=false, sunlightSensorValuesValidated=false, bandCoregistrationVerified=false, reflectanceReady=false, vegetationIndexReady=false, operationalUseAllowed=false, prescriptionExportAllowed=false und flightMissionAllowed=false.

Der CI-Test tests/test_m3m_private_field_review.py verwendet echte **synthetische** UINT16-TIFFs mit Tag-700-XMP und vollständigem P1-/P3.6a-Manifestpfad. Er prüft leere/vollständige/partielle Belege, XMP-Lücken, doppelte Prüfungen, Manipulation nach dem Scan, Overclaiming, Vertraulichkeit und getrennte Exit-Codes. Die bestehende M3M-Offline-CI führt alle Python-Tests mit den installierten binären Raster-Abhängigkeiten aus.

## Echte M3M-Hardwareabnahme: noch ausstehend

Für reale Aussagen müssen unveränderte vierfach-M3M-Aufnahmesätze einschließlich Gerät-/Firmwarekontext lokal untersucht werden; separat DLS-/Sonnenstandsdaten, Panelreferenzen mit nachvollziehbaren Instrumentwerten, Geometrie-/Bandregistrierung und unabhängige QGIS/GDAL-Gegenprüfungen. Bei abweichenden Hersteller-Metadaten braucht es neue getestete Firmwareprofile und keine stillen Feldaliases. Selbst ein vollständig grüner P3.7-Strukturaudit **genehmigt keine** radiometrische Korrektur, NDVI-Düngung oder DJI-Flugoperation.
