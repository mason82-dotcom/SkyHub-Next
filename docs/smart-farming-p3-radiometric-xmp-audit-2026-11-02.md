# SkyHub Smart Farming P3.6b – DJI M3M Radiometrie-XMP, nur Whitelist-Audit

Stand 02.11.2026. Isolierter Branch feature/smart-farming-p3-radiometric-xmp-20261102, basierend auf Draft-PR #235 (P3.6), weiter über #232, #131, #128, #125. **Keine Änderung an main, Raspberry Pi, Compose, aktiven Server-Routen, DJI-SDK oder agronomischen Funktionen.**

## Dokumentierte Feldbezeichnungen und Einheiten

Offizielle Referenz: [DJI Mavic 3M Image Processing Guide v1.0 (August 2023)](https://dl.djicdn.com/downloads/DJI_Mavic_3_Enterprise/20230829/Mavic_3M_Image_Processing_Guide_EN.pdf). Kapitel I, Seiten 5–6 und Kapitel zur NDVI-Verarbeitung, Seite 10. Ergänzend: [DJI Mavic 3M FAQ](https://enterprise.dji.com/mavic-3-m/faq).

Für jeden der vier originalen 16-bit-Spektral-TIFFs werden ausschließlich die Felder im **exakten** DJI-XMP-Namespace `http://www.dji.com/drone-dji/1.0/` geprüft. Die bestehende P1-Prüfung muss anhand der originalen TIFF-Pixel sowie BandName/ImageSource/CaptureUUID **separat gegen einen unabhängig gepinnten Aufnahmebeleg** bestanden sein; P3.6 prüft zusätzlich fünf Kategorien separater Belege gegen ein eigenes extern gepinntes Manifest.

### Benötigte Strukturmarker, je Band

| DJI-XMP-Schlüssel | Bedeutung | Parserbedingung |
| --- | --- | --- |
| SensorGain | Gain des Bildsensors | endliche positive Dezimalzahl |
| ExposureTime | Belichtungszeit des Bildsensors **in Mikrosekunden** | Ganzzahl, > 0 |
| SensorGainAdjustment | sensorseitiger Gain-Abgleich | endliche positive Dezimalzahl |
| Irradiance | bereits herstellerseitig kompensierter Sonnenlichtsensorwert | endliche positive Dezimalzahl |
| BlackLevel | Schwarzwert des Bildsensors | Ganzzahl 0–65535 |
| VignettingData | sechs Vignettierungskoeffizienten | exakt sechs endliche Zahlen |
| SensorIndex | 1=Green, 2=Red, 3=RedEdge, 4=NIR | muss mit dem separat erkannten Band übereinstimmen |

Optionale Marker sind `CalibratedOpticalCenterX`, `CalibratedOpticalCenterY`, `VignettingFlag` (nur 0 akzeptiert, solange keine Entzerrung durchgeführt wird) und `LS_status` (0, 1, 2). **Dies sind bewusst großzügige Parser-Sicherheitsgrenzen, keine DJI-Sensor-Kalibrierbereiche oder Grenzwerte für Feldqualität.** Bei beschädigtem XMP, mehrfach vorkommendem Whitelist-Feld (auch identischer Wert, Attribut/Element), nichtendlicher Zahl, fehlerhafter Vektorlänge und inkonsistentem SensorIndex wird fail-closed abgebrochen.

Das DJI-Handbuch nennt teils weitere oder abweichend benannte Felder, darunter `BlackCurrent`, `VignettingPolynomial`, `SunSensorExposureTime`, `RawData`, `IrradianceGain`. **Diese werden hier nicht als Ersatz für die Felder des offiziellen Processing Guide verwendet.** Fehlen die erforderlichen Marker, lautet das Ergebnis lediglich `allRequiredFieldsPresentAndWellFormed=false`; die Feldnamen werden als aggregierte Fehlzähler ohne Rohwerte ausgegeben. Tatsächliche Hersteller-TIFFs verschiedener Firmwarestände sind für ein belastbares Alias-/Firmware-Profil separat zu verifizieren.

## Sicherheitsprinzip

`backend/workers/m3m_radiometric_xmp_inventory.py` ist eine vollständig offline ausgeführte und rein lesende CLI. Für jede der vier Dateien werden die bekannten, höchstens 32 KiB großen TIFF-Tag-700-XMP-Metadaten mit `defusedxml` geprüft. Anzahl der XML-Knoten und Länge numerischer Texte sind begrenzt, nicht gelistete Felder einschließlich GPS, Seriennummer, Originaldateinamen, UTC, Gerätekennungen oder CaptureUUID-Werten dürfen nicht in das Ergebnis gelangen. Die vertrauliche UUID wird nur durch den bereits bestehenden P1-Prüfpfad auf Konsistenz kontrolliert.

Vor **und nach** der XMP-Prüfung wird das P3.6-Eingangs- und Evidenzinventar samt unabhängigen Quell-Hashes neu geprüft. Es gibt keine Datenänderung, keinen Export von raw XMP, keine Reflektanzformel und keine öffentliche Ergebnisdatei. Die CLI schreibt nur eine aggregierte JSON-Zusammenfassung auf stdout, ohne absolute Pfade und ohne Bildinhalte.

### Offline-Aufruf

~~~bash
python3 backend/workers/m3m_radiometric_xmp_inventory.py \
  --tiff /privat/original/G.tif \
  --tiff /privat/original/R.tif \
  --tiff /privat/original/RE.tif \
  --tiff /privat/original/NIR.tif \
  --source-receipt /privat/belege/capture.json \
  --source-receipt-sha256 UNABHAENGIGER_64_HEX_QUELLBELEG \
  --evidence-dir /privat/feldbelege \
  --evidence-manifest-sha256 UNABHAENGIGER_64_HEX_FELDBELEG
~~~

Beide SHA-256-Werte müssen **vor der Prüfung unabhängig gespeichert** worden sein. Ein Hash, der erst aus dem unzuverlässigen eingereichten Manifest selbst berechnet wird, ist kein Vertrauensanker.

## Bedeutung des Berichts

`allRequiredFieldsPresentAndWellFormed=true` beweist ausschließlich die Existenz und syntaktische Plausibilität der sieben Zahlen-/Vektor-Markertypen in allen vier TIFFs. Jeder erfolgreiche Prüflauf liefert `sourceAndEvidencePinsReverified=true`. Es werden nur `requiredFieldMissingCounts`, `optionalFieldPresentCounts` und abstrakte Prüfflags ausgegeben, **keine Rohzahlen**.

Alle folgenden Felder bleiben falsch: `xmpClaimsAuthentic`, `calibrationVerified`, `sunlightSensorValuesValidated`, `bandCoregistrationVerified`, `radiometricCalibrationVerified`, `reflectanceReady`, `ndviReady`, `ndreReady`, `scienceReady`, `operationalUseAllowed`, `prescriptionExportAllowed`, `flightMissionAllowed`.

Der DJI FAQ zufolge sind M3M-Rohbilder **DN-Werte und keine Reflektanz**; die Vignettierungskorrektur ist bei Originalbildern nicht angewendet. Korrekte radiometrische Resultate erfordern getrennte Sensormodelle, DLS-/Panelbelege, Alignment und Unsicherheitsanalyse. Es findet hier keine Berechnung solcher Korrekturen statt.

## Tests und nächster Gate

`tests/test_m3m_radiometric_xmp_inventory.py` verwendet echte synthetische 16-bit-TIFFs mit DJI-Namespace-XMP und getrennt gepinnten P1-/P3.6-Belegen. Getestet: vollständig fehlende und vollständige Marker, Teilmengen, numerisch nicht zulässige Werte, falsche SensorIndex-Zuordnung, doppelte Felder, unzulässiger Vignettierungsflag, optionale Marker, nachträglich veränderte TIFF-Dateien, falscher Belegpin sowie CLI-Privatsphäre. Dies ist **keine Hardwareabnahme**.

Als nächstes sinnvoll: reale, private Mavic-3M-Aufnahmen aus mehreren Firmwareständen gegen diese Whitelist prüfen und fehlende/abweichende **Dokumentationsprofile** ohne Sensorwerte erfassen; anschließend erst die getrennte DLS-/Panel-Konversion mit unabhängigen radiometrischen Ground-Truth-Referenzen unter festen Toleranzen entwickeln.
