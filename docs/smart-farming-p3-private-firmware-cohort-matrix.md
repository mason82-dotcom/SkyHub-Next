# P3.6d – Private, unabhängig gepinnte Mavic-3M-Firmwarekohorten-Matrix

Stand 02.11.2026. Experimentelles, rein lesendes Offline-Labor; keine wissenschaftliche Abnahme, keine Server-/Pi-Änderung.

## Zweck

Vergleich von mindestens zwei anonymisierten Operator-Kohorten A und B mit jeweils mindestens einer unabhängigen Vier-TIFF-Multispektralaufnahme. Die ursprünglichen DJI-Originale werden nicht verändert, keine Kamera-/Firmwareversion automatisch erkannt und keine Rohdaten öffentlich gemacht.

Die Quelle der Firmwarezuordnung ist eine separat aufbewahrte operatorseitige Evidenzdatei. Ihr extern gesicherter SHA-256-Wert belegt ausschließlich unveränderte Bytes, nicht Echtheit oder inhaltliche Richtigkeit des Firmwarestands. Die Kohortenlabels A/B sind private Vergleichsgruppen, keine attestierten Firmwarebezeichnungen.

## Eingangsvertrag

Eine private, kanonisch sortierte UTF-8-JSON-Datei (0600) mit extern gespeicherter SHA-256-Prüfsumme. Striktes Schema:

~~~json
{
  "cases": [
    {
      "cohort": "A",
      "evidenceDir": "/privat/feldbelege/a",
      "evidenceManifestSha256": "EXTERN_GESICHERTER_SHA256",
      "firmwareEvidence": "/privat/belege/a-firmware.bin",
      "firmwareEvidenceSha256": "EXTERN_GESICHERTER_SHA256",
      "sourceReceipt": "/privat/belege/a-capture.json",
      "sourceReceiptSha256": "EXTERN_GESICHERTER_SHA256",
      "tiffs": ["/privat/a/G.tif", "/privat/a/R.tif", "/privat/a/RE.tif", "/privat/a/NIR.tif"]
    },
    {
      "cohort": "B",
      "evidenceDir": "/privat/feldbelege/b",
      "evidenceManifestSha256": "EXTERN_GESICHERTER_SHA256",
      "firmwareEvidence": "/privat/belege/b-firmware.bin",
      "firmwareEvidenceSha256": "EXTERN_GESICHERTER_SHA256",
      "sourceReceipt": "/privat/belege/b-capture.json",
      "sourceReceiptSha256": "EXTERN_GESICHERTER_SHA256",
      "tiffs": ["/privat/b/G.tif", "/privat/b/R.tif", "/privat/b/RE.tif", "/privat/b/NIR.tif"]
    }
  ],
  "schema": "skyhub-m3m-private-firmware-cohort-manifest-v1"
}
~~~

Das Beispiel ist ein Schema-Muster: die Platzhalter sind keine SHA-256-Werte. Die Datei muss für die CLI mit sortierten Schlüsseln, ohne Leerzeichen und mit abschließendem Newline kanonisiert werden. JSON-Kanonisierung: json.dumps(data, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False) + '\n'. SHA-256 extern und vor der Auswertung archivieren; das Tool erstellt keine Pins selbst.

Maximal acht Fälle; mindestens ein Fall je Kohorte. Jeder Fall hat vier unterschiedliche TIFF-Pfade, einen eindeutigen Original-Capture-Receipt-Pfad, getrennte P3.6-Feldevidenz und eine gepinnte operatorseitige Firmwarebelegdatei. Manifest und Firmwarebelege müssen reguläre Dateien (keine Symlinks/Hardlinks), nicht öffentlich lesbar und begrenzt sein (32 KiB Manifest, 8 MiB Firmwarebeleg). Manipulation während der Verarbeitung wird durch erneutes Hashen erkannt.

**Wichtig für die Kohortenunabhängigkeit:** Unterschiedliche Dateipfade allein genügen nicht. Pro Fall müssen sowohl der Original-Receipt-Pfad als auch dessen unabhängig hinterlegter SHA-256-Wert verschieden sein; TIFF-Dateipfade und physische TIFF-Dateiidentitäten dürfen innerhalb der gesamten Vergleichsmatrix nicht mehrfach vorkommen. Gleiche Firmware-Evidenzbytes dürfen nicht gleichzeitig Kohorte A und B zugeordnet werden. Das belegt weiterhin keine tatsächliche Firmwareversion und verhindert nicht, dass identische Aufnahmebytes in neue Dateien kopiert und mit neuen Belegen versehen werden. Wissenschaftliche Aufnahmeunabhängigkeit muss separat geprüft werden.

Die bestehende P3.6c-Prüfung wird pro Fall vollständig ausgeführt: P1-/P3.6-Original- und Evidenz-SHA-Pins vor/nach dem XMP-Strukturinventar, kein Zugriff auf Live-DJI-API und keine Veröffentlichung von Rohmetadaten.

## Ausführung

~~~bash
python3 backend/workers/m3m_private_firmware_cohort_matrix.py \
  --manifest /privat/belege/cohorts.json \
  --manifest-sha256 EXTERN_GESICHERTER_64_STELLIGER_SHA256
~~~

Ergebnis: capturesPerAnonymousCohort, spectralTiffsPerAnonymousCohort, aggregierte Marker-Anwesenheit je A/B, documentedMarkerPresenceDeltaBMinusA, aggregierte fehlende P3.6b-Pflichtmarker sowie explizite Nichtfreigabe-Flags. Keine Aufnahme-IDs, TIFF-Dateinamen, Firmwarestrings, GPS, SHA-256-Werte, Kamera-IDs, unbekannten XMP-Feldnamen oder radiometrischen Messwerte.

Die Differenz ist eine absolute Anzahl und nicht auf ungleiche Kohortengrößen normiert. Unterschiedliche Aufnahmeanzahlen dürfen nicht als Firmwareeffekt interpretiert werden. Selbst bei gleicher Fallzahl können Kamera, Belichtung, Standort, DJI-Software und Aufnahmeeinstellungen konfundieren. Der Bericht ist nur eine Strukturzählung, keine statistische Signifikanzanalyse.

## Nächster realer Abnahmeschritt

Originale Mavic-3M-Vierbandaufnahmen aus zwei getrennt dokumentierten Firmwareständen bereitstellen; Quellen/Prüfsummen, Firmware-Nachweise und DLS-/Panel-Evidenz getrennt archivieren. Erst danach können reale Markerabweichungen und Kalibrierhypothesen gegen unabhängige Messungen geprüft werden. Alle Felder firmwareVersionVerified, radiometricCalibrationVerified, reflectanceReady, ndviReady, ndreReady, scienceReady, operationalUseAllowed, prescriptionExportAllowed und flightMissionAllowed bleiben false.

Testgruppe: tests/test_m3m_private_firmware_cohort_matrix.py – synthetische echte TIFF-/XMP-Binärdateien, aber keine echten DJI-Hardwareaufnahmen.
