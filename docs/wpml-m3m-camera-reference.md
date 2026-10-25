# DJI Mavic 3M – Offline-Kamera-/Kadenzreferenzen (nicht flugfähig)

**Stand:** 24.10.2026. Isoliertes P1-Feature auf aktuellem `main`.
**Referenzcode:** `frontend/public/wpml-camera-reference-core.js`;
**Unit-/Browserchecks:** `backend/test/wpml-camera-reference.test.js` und `tests/wpml_browser_smoke.py`.

## Herkunft

Herstellerangaben:
- [DJI Mavic 3M Specifications](https://enterprise.dji.com/mavic-3-m/specs)
- [DJI Mavic 3M User Manual, 2024 – Camera Profile](https://dl.djicdn.com/downloads/DJI_Mavic_3_Enterprise/20240814/DJI_Mavic_3M_User_Manual_EN.pdf)

Die Quellen belegen: RGB 4/3 Zoll, 20 MP; vier eigenständige
multispektrale 1/2.8-Zoll-Kameras (G 560±16 nm, R 650±16 nm,
RE 730±16 nm, NIR 860±26 nm), je 5 MP TIFF; bei gleichzeitiger
RGB-/Multispektralfotografie mindestens 2 Sekunden pro Aufnahmeereignis.
Dies sind **Referenzdaten zur Planung**, keine zur Laufzeit von DJI Pilot 2
gelesenen Fähigkeiten.

## Getrennte Referenzmodi

| Modus | Referenz-Pixel | Mindestintervall | Dateien je idealisiertes Ereignis |
| --- | --- | ---: | ---: |
| `m3m-rgb-jpeg` | RGB 5280 × 3956 | 0,7 s | 1 |
| `m3m-rgb-jpeg-raw` | RGB 5280 × 3956 | 3 s | 2 (JPEG+DNG) |
| `m3m-ms-tiff` | vier MS 2592 × 1944 | 2 s | 4 (G/R/RE/NIR) |
| `m3m-rgb-ms-tiff` | vier MS 2592 × 1944 | 2 s | 5 (RGB+G/R/RE/NIR) |

Bei `m3m-rgb-ms-tiff` beziehen sich Streifenabstände, GSD und
Footprint **nur auf den manuell parametrisierten Multispektralsensor**.
Die RGB-Footprintgröße wird nicht aus der MS-Optik interpoliert;
`otherSensorGeometryComputed:false` gilt auch für die kombinierte
Aufnahme. Die Bilddateienzählung ist nur eine theoretische Multiplikation
der geschätzten Fotoereignisse mit der erwarteten Produktzahl. Keine
Zusicherung, dass das Fluggerät diese Dateien tatsächlich erzeugt.

Die im Datenblatt genannten Brennweiten von 24/25 mm beziehen sich auf
das Kleinbildäquivalent und sind **nicht** ohne physische Sensorbreite
und tatsächliche Brennweite in den vorhandenen geometrischen
Nadir-Footprint-Algorithmus einsetzbar. Physische Sensorbreite/-höhe,
tatsächliche Brennweite, AGL, Geschwindigkeit und Überlappungen bleiben
explizite Eingaben. Kein Hersteller-Modus erzeugt daraus eine
Kamerakalibrierung.

## Fail-closed-Verhalten

- Unbekannte Modi, fehlende Optikparameter, ungültige Bildabmessungen
  oder gegenüber DJI unterschrittene benutzerdefinierte
  Mindestaufnahmeintervalle werden abgelehnt.
- Im Hersteller-Referenzmodus wird bei leerem manuellem Mindestintervall
  das veröffentlichte Minimum gesetzt, niemals ein kürzeres.
- Erfordert das theoretische Abstands-/Geschwindigkeitsverhältnis
  ein kürzeres Intervall als das Hersteller-Minimum, meldet die UI
  die Referenz-Kadenzprüfung als nicht bestanden.
- Eine reine M3M-RGB-Aufnahme darf nicht mit den Pixelparametern
  eines MS-TIFFs berechnet werden und umgekehrt.
- Existierende manuelle Kameraparameter und bereits implementierte
  optische Vorschau bleiben unverändert nutzbar.

## Laufzeit-/Sicherheitsabgrenzung

Kein `backend/server.js`, Pilot-2-API-, MQTT-, Docker-, MinIO-,
Missionsdispatch- oder Flight-Wayline-Änderung. Keine Ermittlung realer
Gerätebereitschaft oder Parametrierung der Kamera. Alle Ergebnisse tragen
`cameraHardwareVerified:false`, `pilot2HardwareVerified:false`,
`opticalCalibrationVerified:false`, `flightReady:false`,
`exportableAsWaylines:false`.

Browser-Export bleibt ein **lokales GeoJSON zur Inspektion**. Er vermerkt
lediglich den ausgewählten Referenzmodus und dass keine Hardwareprüfung
vorliegt. Die Zählung von Aufnahmen wird nicht in DJI-Action-Groups
oder als ausführbares Missions-KMZ übertragen.

## Prüfen

```bash
node --test backend/test/wpml-camera-reference.test.js backend/test/wpml-photogrammetry.test.js backend/test/wpml-capture-preview.test.js
```

Die bestehenden vollständigen Node- und Chromium-Suiten bleiben
zusätzlich erforderlich. Für die operative Weiterentwicklung fehlen:
(1) reale Kamera-/Firmware-Readbacks an RC Pro Enterprise + M3M,
(2) eindeutige tatsächlich unterstützte WPML-Aufnahmeaktionen,
(3) Sensor- und Geoid-/Terrainabnahme und unabhängige Radiometrie,
(4) DJI Pilot 2 Import sowie kontrollierte Flugtests.
