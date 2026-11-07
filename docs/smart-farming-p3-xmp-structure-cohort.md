# P3.6c – Privater Mavic-3M-XMP-Strukturvergleich

Stand 02.11.2026. Experimenteller Branch feature/m3m-p36c-private-xmp-cohort-20261102, direkt von main. Offline, read-only, kein aktiver SkyHub-Serverpfad und kein Raspberry-Pi-Deployment.

## Begründung

P3.6b prüft sieben numerische DJI-XMP-Pflichtmarker, vier optionale Felder sowie vier uint16-TIFFs mit extern gepinntem Quell- und Evidenzbeleg. Das Mavic-3M-Handbuch beschreibt zusätzliche Felder für Sonneneinstrahlung und Vignettierung. Die Originalbilder enthalten DN-Werte, keine fertige Reflektanz.

Offizielle Quellen:
- DJI Mavic 3M User Manual 2024: https://dl.djicdn.com/downloads/DJI_Mavic_3_Enterprise/20240606/DJI_Mavic_3M_User_Manual_EN.pdf
- DJI Image Processing Guide 2023: https://dl.djicdn.com/downloads/DJI_Mavic_3_Enterprise/20230829/Mavic_3M_Image_Processing_Guide_EN.pdf
- DJI FAQ: https://enterprise.dji.com/mavic-3-m/faq

## Neue Funktion

Der Worker backend/workers/m3m_private_xmp_cohort.py führt vor und nach der Struktursichtung das gesamte P3.6b-XMP-Audit durch. P3.6b prüft dabei den Original-TIFF-Inhalt und die beiden vorab extern gespeicherten SHA-256-Belege. Die Zusatzprüfung liest ausschließlich TIFF-Tag 700 und extrahiert nur die **Präsenz von Whitelist-Schlüsseln**, niemals deren Werte.

Herstellerdokumentierte Zusatzfelder (keine automatischen Ersatzfelder oder Alias-Konversionen): BlackCurrent, CentralWavelength, IrradianceExposureTime, IrradianceGain, PrincipalPoint, RawData, SunSensor, SunSensorExposureTime, SunSensorYaw, SunSensorPitch, SunSensorRoll, VignettingCenter, VignettingPolynomial und WavelengthFWHM. Die P3.6b-Pflicht- und optionalen Felder bleiben unabhängig.

Begrenzungen: max. 32 KiB TIFF-XMP, 256 XML-Knoten, 40 Attribute je Knoten, 64 unterschiedliche unbekannte DJI-Feldnamen. DefusedXML; doppelte dokumentierte DJI-XMP-Schlüssel (auch gleiche Werte, sowohl Attribut als auch Element) werden verweigert.

Das Ergebnis enthält ausschließlich: bekannte Marker-Anwesenheitszähler (0 bis 4), unbekannte DJI-Marker-Anzahlen pro Eingabeposition (ohne Namen), Gesamtzahl bekannter Marker pro Eingabe und die Anzahl gleichzeitiger VignettingData/VignettingPolynomial-Felder als Prüfhinweis. Es fehlen bewusst Rohwerte, Originalpfade, CaptureUUID, GPS, Kamera-ID, Seriennummer und Firmwareversionsstrings. Keine automatische Firmwareerkennung oder Herleitung der Kalibriermethode.

## Offline-Aufruf

~~~bash
python3 backend/workers/m3m_private_xmp_cohort.py \
  --tiff /privat/m3m/G.tif \
  --tiff /privat/m3m/R.tif \
  --tiff /privat/m3m/RE.tif \
  --tiff /privat/m3m/NIR.tif \
  --source-receipt /privat/belege/capture.json \
  --source-receipt-sha256 EXTERN_GESICHERTER_64_HEX_CAPTURE_PIN \
  --evidence-dir /privat/feldbelege \
  --evidence-manifest-sha256 EXTERN_GESICHERTER_64_HEX_EVIDENZ_PIN
~~~

Hash-Werte und Pfade sind Platzhalter. Die SHA-256-Belege müssen **vor** dieser Prüfung aus einer getrennten vertrauenswürdigen Quelle archiviert sein. Der private Bericht darf nicht als öffentliches DJI-Zertifikat oder Flugfreigabe dargestellt werden.

## Wissenschaftliche Grenzen

Kein Messwert wird als echte Kalibrierung bewertet, kein Firmwarestand attestiert und keine DLS-, Dunkelstrom-, Gain-, Panel- oder Vignettierungskorrektur durchgeführt. Sämtliche Freigabefelder bleiben false: firmwareVersionVerified, manufacturerSourceAuthenticityVerified, xmpMetadataClaimsScientificallyValidated, sunlightSensorValuesValidated, radiometricCalibrationVerified, bandCoregistrationVerified, reflectanceReady, ndviReady, ndreReady, scienceReady, operationalUseAllowed, prescriptionExportAllowed, flightMissionAllowed.

Die synthetischen Tests in tests/test_m3m_private_xmp_cohort.py verifizieren normale und zusätzliche Feldmarker, verbotene Feldduplikate, private Datenabgrenzung, abweichende oder nicht bestätigte Pins, ungültige Basismetadaten und verspätete TIFF-Mutation. Echte DJI-M3M-TIFFs verschiedener Firmwarestände wurden noch nicht bereitgestellt und deshalb nicht getestet.

Für den nächsten Hardware-Abnahmeschritt: mindestens zwei separat dokumentierte reale M3M-Firmwarekohorten erfassen, Originalbilder und Prüfsummen unabhängig aufbewahren, XMP-Profilabweichungen vergleichen sowie Panel-/DLS-Kalibrierung gegen Ground Truth quantitativ testen. **Keine produktive Nutzung und kein Merge durch dieses Inkrement.**
