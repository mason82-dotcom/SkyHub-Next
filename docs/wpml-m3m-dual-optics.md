# Mavic 3M: unabhängiger RGB-/Multispektral-Footprint (Offline-Vergleich)

Stand: 24.10.2026. Modul: frontend/public/wpml-m3m-dual-optics-core.js.

## Problem und Zweck

PR #102 auf main unterscheidet RGB-JPEG mit 5280×3956 Pixeln und
Multispektral-TIFF mit 2592×1944 Pixeln je Band und berücksichtigt die
DJI-Mindestaufnahmeintervalle. Für gemischtes RGB+MS wird dabei absichtlich
nur die Multispektralgeometrie berechnet.

Das neue rein lesende Vergleichsmodul verlangt **zwei voneinander unabhängige
manuelle Optikeingaben**: physische Sensorbreite/-höhe, tatsächliche
Brennweite, Pixelmaße, AGL, Überlappung und Fluggeschwindigkeit. Keiner
dieser physikalischen Werte wird aus dem Kleinbildäquivalent erfunden.

## Algorithmus

- Beide Eingaben müssen dieselbe AGL und Geschwindigkeit besitzen.
- Für RGB und MS jeweils unabhängig: theoretische Bodenbildgröße, GSD,
  Querstreifenabstand und längsgerichteter Fotoabstand.
- Nominal restriktiver Quer- und Längsabstand: jeweils das Minimum aus beiden
  separat bestimmten Kamerawerten. Diese Rechnung setzt theoretisch
  gleiche Nadir-Orientierung und eine gemeinsame Flugbahn voraus.
- Nominales Fotozeitintervall: engerer Längsabstand geteilt durch
  angenommene Fluggeschwindigkeit.
- Die Herstelleruntergrenze für simultane RGB+MS-Aufnahmen beträgt 2 s;
  größere individuell eingegebene Mindestintervalle werden berücksichtigt.
- meetsNumericalCadence ist **nur eine mathematische Referenzprüfung**.
  Dass DJI Pilot 2 einen entsprechenden Distanztrigger umsetzt, ist unbewiesen.
- Eine passende Offline-Survey-Geometrie erlaubt die **theoretische**
  Zählung von Aufnahmeereignissen und bis zu fünf erwarteten Dateien
  pro Ereignis (1 × RGB JPEG, 4 × MS-TIFF). Die Zählung enthält keine
  Transfer-, Wendeflug- oder Kameraaktionen.

## Warum keine garantierte Bilddeckung?

Beide Sensoren können unterschiedliche optische Achsen und Projektionszentren
besitzen. Boresight und Bildregistrierung, Objektivverzeichnung, Gelände,
Auslöseverzögerung, Belichtung, RTK-Zeitversatz und Kamerafirmware wurden
nicht gegen reale Mavic-3M-Bilder kalibriert. Das Minimum der geometrischen
Abstände ist daher **kein Nachweis** einer gemeinsamen Überdeckung.

## Unveränderliche Sicherheitsgrenze

Jedes Vergleichsergebnis hat coRegistrationVerified:false,
relativeBoresightVerified:false, cameraHardwareVerified:false,
pilot2HardwareVerified:false, opticalCalibrationVerified:false,
terrainVerified:false, geofenceVerified:false, flightReady:false,
exportableAsWaylines:false und dispatchAllowed:false.

Kein neues MQTT, DJI-RPC, KMZ, REST, Docker oder Pi-Deployment. Kein
Anschließen an den operativen Flugmissionsgenerator. Das Modul ist
vorerst nur eine **separat importierbare Offline-JavaScript/Node-Komponente**
ohne neue HTML-Bedienelemente.

## Zusätzliche Geometrie-Integritätsprüfung

Die reine Ereignis- und Dateizählung akzeptiert nicht mehr allein eine
behauptete Segmentlänge oder das Flag `flightReady:false`. Vor jeder
Zählung erzeugt das Modul die Survey-Vorschau **erneut aus dem vorhandenen
Polygon/MultiPolygon inklusive Löchern** mit dem angegebenen Streifenabstand
und der angegebenen Richtung. Es vergleicht alle Capture-Segmentkoordinaten,
Segmentlängen, Streifenindizes, Anzahl und aufsummierte Fläche/Länge.

Ein manipuliertes Segment, ein verschobener Start-/Endpunkt, ein ausgelassenes
Polygonloch oder eine abweichende Streifenrichtung wird verworfen. Die
Replay-Prüfung ist eine **Integritätsprüfung einer synthetischen Vorschau**,
keine unabhängige Vermessung und kein Nachweis von tatsächlicher
Kameraabdeckung oder realen Hindernissen. Im Browser muss neben
`wpml-camera-reference-core.js` auch
`wpml-survey-preview-core.js` vor
`wpml-m3m-dual-optics-core.js` geladen werden.

## Verifikation

Tests:
- node --test backend/test/wpml-m3m-dual-optics.test.js
- node --test backend/test/wpml-camera-reference.test.js backend/test/wpml-photogrammetry.test.js

Sämtliche physikalischen Testwerte sind synthetisch und KEINE DJI-Kalibrierung.

Herstellerquelle: https://enterprise.dji.com/mavic-3-m/specs
Dokumentation: https://dl.djicdn.com/downloads/DJI_Mavic_3_Enterprise/20240814/DJI_Mavic_3M_User_Manual_EN.pdf
