# SkyHub Next – Thermalmodul (31.10.2026)

`/thermal.html` (Navigation „Thermal“) zeigt **alle radiometrischen Wärmebilder** (DJI R-JPEG, Dateiname `…_T.JPG`) aus allen MinIO-Buckets, auch Pilot-2-Uploads (über den DJI-Namen aus `dji_pilot_media_verified`) und SD-Importe (Hash-Ordner werden zur Import-Serie zusammengefasst). Am 31.10.2026: 2.088 Wärmebilder in 6 Serien, jedes mit dem zugehörigen Foto (gleicher Tag, gleiche Bildnummer, Aufnahmezeit ±3 s).

## Funktionen

- **Bildanalyse:** Paletten (Eisen, Regenbogen, Weiß/Schwarz heiß, Lava, Arktis), automatischer Bereich (1.–99. Perzentil) oder Min/Max von Hand, Temperatur unter dem Zeiger, Hot-/Cold-Spot, **Messpunkte und Messbereiche** (Min/Mittel/Max), **Isothermen** (über/unter/zwischen), Histogramm mit Farbskala, Foto derselben Aufnahme daneben, Aufnahmedaten (Modell, Laser-Entfernung, Kameraneigung/-richtung, Höhe).
- **Emissionsgrad / reflektierte Temperatur:** Startwert aus der Datei (APP4, M4T: 0,95). Abweichende Werte werden über eine Gesamtstrahlungs-Näherung umgerechnet: `T⁴ = (ε_Datei·T_gem⁴ + (ε − ε_Datei)·T_refl⁴) / ε` (Kelvin).
- **Serienauswertung:** je Serie Min/Median/Mittel/Max, Hotspot, Entfernung, Neigung pro Bild, Verlaufsdiagramm, CSV.
- **Export:** PNG der aktuellen Darstellung, CSV der Messungen, CSV der vollständigen Temperaturmatrix (640 × 512). CSV im deutschen Excel-Format (Semikolon, Dezimalkomma).

## API (nur GET, Heimnetz ohne Anmeldung)

| Pfad | Inhalt |
| --- | --- |
| `/api/thermal/list` | alle Wärmebilder mit Name, Tag, Uhrzeit, Serie (`folder`) und zugehörigem Foto (`visualKey`) |
| `/api/thermal/meta?bucket=&key=` | Auflösung, Emissionsgrad, DJI-XMP-Werte, Statistik, Hot-/Cold-Spot, Histogramm (gecacht) |
| `/api/thermal/raw?bucket=&key=` | 16-bit-Rohbild (little endian), Breite/Höhe in `X-Thermal-Width/Height` |

## Grenzen

- Temperaturen sind **Schätzwerte** (`raw/64 − 273,15`), nicht die Kalibrierung des DJI Thermal SDK. Plausibel geprüft an M4T-Aufnahmen (Innenraum 13–23 °C). Für verbindliche Werte: DJI Thermal SDK / DJI Thermal Analysis Tool (x64).
- Glas und blanke Metalle spiegeln Infrarot; dort sind Werte nicht aussagekräftig.
- Nach dem Einschalten driftet die Kamera einige Minuten (am 22.10.2026 ca. 1,5 K in den ersten beiden Bildern).
