# M3M P3.9 – Paarweise Verknüpfung der Originalaufnahmen mit Operator-Belegen

**Stand: 02.11.2026.** Experimentelles, streng lesendes Offline-Labor. Für eine wissenschaftliche Firmwarekompatibilität, DLS-/Panelradiometrie oder agronomische Nutzung sind weiterhin unabhängige Messungen an realen DJI-Mavic-3M-Aufnahmen notwendig. Diese Stufe führt **keine** automatische Kamera-, Firmware- oder Kalibrierfreigabe ein.

## Begründung

P3.6d (#253) prüft echte Quell- und 16-Bit-Vierband-TIFF-Bytes gegen unabhängig archivierte SHA-256-Capture-, Evidenz- und opaque Betreiber-Firmwarebelege. P3.6e (#254/#255) prüft A/B-Aufnahmebedingungen bisher nur anhand der in einem separaten Paarplan **behaupteten** Quell- und Firmware-Prüfsummen, ohne die Planbezüge mit Originalbildern zu verbinden.

Der neue Worker backend/workers/m3m_private_capture_pair_linkage.py schließt diese konkrete Bindungslücke. Er verifiziert zuerst **beide vollständigen bisherigen Offline-Worker**, liest anschließend deren unabhängig gepinnte kanonische Manifeste erneut ein und fordert, dass jeder A/B-Plan-Eintrag genau einem physisch geprüften Capture-Eintrag zugeordnet werden kann. Jede geprüfte Aufnahme muss genau einmal eingeplant sein.

Zusätzlich kontrolliert er, dass pro Seite sourceReceiptSha256 und firmwareEvidenceSha256 aus dem Pair-Plan mit den Werten aus der echten P3.6d-Aufnahmematrix übereinstimmen. Die optionalen dlsEvidenceSha256 und panelEvidenceSha256 werden gegen die tatsächlichen, von P3.6a byteweise geprüften sunlightSensor- beziehungsweise panelImage-Dateien gebunden. Fehlt die betreffende Evidenz im P3.6a-Manifest, muss die Planreferenz null sein. Ein vorhandenes Panelzertifikat **ersetzt** nicht automatisch die Panelbildreferenz.

## Voraussetzungen

Beide Dateien müssen vor dem Prüflauf bereits privat archiviert und unabhängig auf SHA-256 gepinnt worden sein:

1. Ein P3.6d-Cohortmanifest (Schema skyhub-m3m-private-firmware-cohort-manifest-v1) mit 2–8 vierbandigen Originalcaptures und einem A/B-Label je Aufnahme. Die Einzelcaptures benötigen originale TIFFs, P1-Quellbelege, P3.6a-Feldbelege, eine separate opaque Betreiber-Firmwaredatei und deren SHA-256-Prüfsummen.
2. Ein P3.6e-Paarplan (Schema skyhub-m3m-private-field-pairing-plan-v1) mit exakt 1–4 A/B-Paaren. Die Anzahl der Paare muss der Hälfte der Originalcapturen entsprechen, und jede angegebene Capture-Quellbelegsumme darf nur einmal verwendet werden.

Alle bestehenden Anforderungen an Dateirechte, absolute kanonische Pfade, Bytesiegel, manuell gesetzte Toleranzen und doppelte Source-IDs bleiben verpflichtend. Die Planungsdatei muss 0600 und ihr privates Elternverzeichnis 0700 sein; der originale Cohort-Matrix-Worker kontrolliert seine eigenen File-Bounds. Diese statischen Schutzprüfungen ersetzen keine betriebssystemseitige race-proof Dateisystemisolation.

## Lokaler Aufruf

Die Pfade sind Beispiele; private Dateinamen und echte Hashwerte gehören weder ins öffentliche Repository noch in die Logs.

~~~bash
python3 backend/workers/m3m_private_capture_pair_linkage.py \
  --cohort-manifest /privat/m3m/cohorts.json \
  --cohort-manifest-sha256 VORHER_EXTERN_GESICHERTER_64_HEX_SHA256 \
  --pair-plan /privat/m3m/field-pairing-plan.json \
  --pair-plan-sha256 ZWEITER_VORHER_EXTERN_GESICHERTER_64_HEX_SHA256 \
  --require-complete-operator-plan
~~~

Es werden ausschließlich aggregierte Mengen gezählt: Anzahl Originalcaptures, Anzahl gebundener Paare, Anzahl Paare innerhalb operatorseitiger Toleranzen, unvollständig erfasste Messbedingungen sowie fehlende DLS-/Panelbild-Deklarationen. Keine Rohwerte, XMP, Originalpfade, GPS, Gerätedaten, Zeitstempel oder SHA-256-Pins im Ergebnis.

Mit --require-complete-operator-plan gelten: Exit 2 bei ungültigen Quellen, Belegen oder widersprüchlicher Bindung; Exit 3 bei erfolgreich gebundenen, aber unvollständigen oder außerhalb der operatorseitigen Toleranz liegenden Paaren; Exit 0 bei vollständiger **formaler Betreiberdeklaration**. Ohne die Option ergibt eine gelungene Bindung Exit 0 und die Vollständigkeit muss dem JSON-Feld operatorPlanCompletenessOnly entnommen werden.

## Sicherheits- und wissenschaftliche Grenzen

- Die SHA-256-Bindung beweist nur Integrität gegen die zuvor unabhängig archivierten Vertrauensanker. Sie bestätigt nicht Zeitpunkt, Echtheit oder wissenschaftliche Qualität der Betreiberbelege.
- Paarwerte für Belichtung, Gain, Einstrahlung, Flugdatum und -höhe werden **nicht** aus den TIFF-Dateien unabhängig extrahiert. Der Worker verifiziert ausschließlich, auf welche TIFF-Captures sich die Planwerte beziehen.
- Die Methode erkennt weder Kamera-/Firmware-Ursprung noch kausale Effekte, echte Panelreflektanz, DLS-Messrichtigkeit, Co-Registrierung oder die Eignung für NDVI-/Agras-Düngung.
- Die Flags manufacturerFirmwareAttested, operatorValuesIndependentlyMeasured, dlsMeasurementsVerified, panelMeasurementsVerified, radiometricCalibrationVerified, reflectanceReady, operationalUseAllowed, prescriptionExportAllowed und flightMissionAllowed bleiben **immer false**.
- Vollständige synthetische TIFF-/XMP-/Manifest-Regressionsfälle sind unter tests/test_m3m_private_capture_pair_linkage.py dokumentiert. Es wurden **keine echten M3M-Firmwareprofile** damit wissenschaftlich abgenommen.

Das Labor ist **nicht** in die SkyHub-HTTP-API, den Raspberry Pi, MinIO, PostGIS, MQTT oder DJI Cloud API eingebunden und kann keine Flugoperationen auslösen.
