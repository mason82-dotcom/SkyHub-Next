# P3.6e – Privater Störfaktoren-Check für gepaarte Mavic-3M-Vergleiche

**Stand 02.11.2026.** Experimentelles Offline-Planungswerkzeug, kein wissenschaftlicher Nachweis. Dieses Modul ist unabhängig von den bereits auf main übernommenen Vergleichslaboren: P3.6d über #253 (Original-TIFF-Kohortenmatrix) und P3.8 über #252 (XMP-Berichtsvergleich). Es verändert keine DJI-Kommunikation, Pi-Konfiguration, Speicherobjekte oder Datenbank.

## Problemstellung und Geltungsbereich

Ein unterschiedliches XMP-Strukturmuster bei Mavic-3M-Aufnahmen kann nicht ohne Weiteres einem Firmwareunterschied zugeschrieben werden. Belichtung, Sensorverstärkung, Sonneneinstrahlung, Flughöhe und Aufnahmezeit können zwischen verglichenen Aufnahmen abweichen. Auch eine vollständige Datenstruktur garantiert weder Reflektanzrichtigkeit noch identische Messbedingungen.

Der neue Worker backend/workers/m3m_private_field_pairing_qa.py prüft deshalb ausschließlich **vom Operator eingetragene Mess-/Aufnahmewerte** und **vom Operator festgelegte Toleranzen** für anonymisierte A/B-Aufnahmepaare. Die eingetragenen Zahlen werden NICHT aus echten TIFFs extrahiert, ihre Herkunft nicht authentifiziert und ihre Einheiten nur durch das Eingabeschema vorgegeben. Das Ergebnis ist eine *Versuchsplan-Prüfung*, nicht eine kausale Firmwareeffektanalyse.

## Privater Eingangsvertrag

Der Plan ist eine kanonische JSON-Datei (ein kompaktes JSON-Objekt mit alphabetisch sortierten Schlüsseln und abschließendem Newline), regulär, 0600, **in einem privaten 0700-Verzeichnis**, maximal 32 KiB. Ein SHA-256-Hash dieser Datei muss **vor** der Prüfung unabhängig archiviert werden. Keine doppelten oder unbekannten JSON-Schlüssel, Symlink-Dateien/-Verzeichnisaliasse, NaN/Infinity oder ungeschützten Dateien.

Schema: skyhub-m3m-private-field-pairing-plan-v1

Pflichtfelder des Top-Level-Objekts: schema, tolerances, pairs.

Die tolerances enthalten folgende ganzzahlige, **vom Versuchsleiter vorgegebene und wissenschaftlich nicht validierte** Obergrenzen:
- exposureUsPctMax: 0–100 % symmetrische Belichtungsabweichung
- sensorGainMilliPctMax: 0–100 % Verstärkungsabweichung
- irradianceMilliPctMax: 0–100 % Einstrahlungsabweichung
- flightHeightCmPctMax: 0–100 % Höhenabweichung
- captureTimeSecondsMax: 0–3600 Sekunden Zeitdifferenz

Die Liste pairs enthält ein bis acht Einträge. Jedes Paar besitzt genau A und B. Jede Seite hat:
- sourceReceiptSha256: deklarierter, unabhängig verwahrter Quellbeleg-Hash
- firmwareEvidenceSha256: deklarierter, unabhängig verwahrter Betreiber-Firmwarebeleg-Hash
- dlsEvidenceSha256 und panelEvidenceSha256: 64-stellige Hex-SHA-256-Werte oder null bei fehlendem Beleg
- exposureUs (Mikrosekunden), sensorGainMilli (operatorseitig definierte Gain-Milli-Einheit), irradianceMilli (operatorseitig definierte Einstrahlungs-Milli-Einheit), flightHeightCm (Zentimeter), captureTimeSeconds (Unix-Sekunden), jeweils positive ganze Zahl oder null bei nicht gemessenem Wert

Die Messfelder müssen A und B in **derselben Einheit, demselben zeitlichen Bezug und derselben Messmethode** beschreiben. Das Tool kann diese Voraussetzung nicht unabhängig kontrollieren. Bei percentage-Vergleichen wird eine symmetrische Differenz zum Mittelwert verwendet: 200 * abs(A-B) <= operatorTolerancePercent * (A+B). Das ist eine deterministische mathematische Auswahlregel, keine physikalisch validierte Schwelle.

In der Planungsphase werden pro Paar unterschiedliche Quellbeleg-Hashes verlangt. Der Firmwarebeleg-Hash muss innerhalb der A-Gruppe bzw. der B-Gruppe gleich und zwischen beiden Gruppen verschieden sein. Das beweist **weder zwei reale Firmwareversionen noch Unabhängigkeit der Aufnahmebilder**. Dafür muss später der eigentliche P1-/P3.6-Originaldaten- und Firmwarebelegpfad verwendet werden.

## Ausführung

Den JSON-Plan offline erstellen, auf Dateimodus 0600 beschränken, seine SHA-256-Prüfsumme separat verwahren und anschließend ausführen:

~~~bash
python3 backend/workers/m3m_private_field_pairing_qa.py \
  --plan /privat/m3m/field-pairing-plan.json \
  --plan-sha256 EXTERN_ARCHIVIERTE_64_STELLIGE_SHA256
~~~

Ausgabe: Nur aggregierte Anzahlen passender, unpassender oder nicht gemessener Parameter je Faktor; Anzahl Paare mit vollständigen Angaben, Anzahl Paare innerhalb sämtlicher Operator-Toleranzen und Anzahl Paare ohne deklarierte Panel-/DLS-Evidenz. Es werden keine Rohwerte, Timestamps, Originalpfade, UUIDs, Firmwarestrings oder SHA-Werte ausgegeben.

Optionaler Operator-Gate: `--require-complete-operator-plan` gibt nach einem gültigen Plan **Exit 3** aus, wenn auch nur ein Paar außerhalb der operatorseitig gewählten Toleranzen liegt, ein Messwert fehlt oder ein Panel-/DLS-Beleg nicht deklariert wurde. Bei formaler Vollständigkeit gilt **Exit 0**, bei ungültigen Pins, privaten Dateirechten oder Plänen **Exit 2**. Der ausführliche Report bleibt in beiden gültigen Zuständen aggregiert und datensparsam; Exit 0 bedeutet ausdrücklich **keine** validierte Wissenschaft, Firmware oder DJI-Mission. Das Flag ist rein opt-in und ändert das bisherige Standardverhalten nicht.

**Kein Ergebnis ist eine Freigabe.** Selbst wenn alle Operator-Toleranzen eingehalten sind, bleiben sourceProvenanceVerified, firmwareVersionVerified, operatorMeasurementsIndependentlyVerified, operatorTolerancesProspectivelyRegistered, radiometricCalibrationVerified, panelCalibrationVerified, bandCoregistrationVerified, reflectanceReady, ndviReady, ndreReady, scienceReady, operationalUseAllowed, prescriptionExportAllowed und flightMissionAllowed unverändert false.

## Qualitäts- und Freigabegrenzen

Die Toleranzen sind nicht empirisch ermittelt, nicht vorab signiert und das Tool bestätigt keine nachträgliche Unveränderbarkeit der Angaben. Die Differenzzahl ist keine statistische Aussage über Firmwareeffekte oder Agronomie. Für echte P3.6e-Hardware-Evidenz müssen Original-DJI-TIFFs, aus externen Quellen archivierte Firmwarestände, Panel/DLS-Messprotokolle, kontrollierte Aufnahmezeitpunkte sowie ein vorab festgelegter, unabhängig begutachteter Messplan vorliegen. Das Offline-CLI ist nicht an Backend-Routen, MQTT, MinIO, PostGIS, Raspberry Pi oder DJI-SDK angebunden.

Tests: tests/test_m3m_private_field_pairing_qa.py – synthetische Operatorangaben und private JSON-Dateien; **keine Messdaten von echten DJI-Geräten**.
