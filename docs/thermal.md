# SkyHub Next – Thermalmodul

`/thermal.html` liest experimentell DJI-R-JPEG-Kandidaten aus den freigegebenen Medien-Buckets. Die Oberfläche bietet Paletten, Messpunkte, rechteckige Pixelbereiche, Isothermen, Histogramm, Serienstatistik und Exporte. Sie steuert keine Kamera und schreibt keine Medienobjekte.

## Temperatur und Korrektur

**Alle Temperaturen sind unkalibrierte Schätzwerte:** `raw / 64 − 273,15`. Eine passende Dateistruktur bestätigt weder die Gültigkeit dieser Formel für eine Kamera noch die Genauigkeit. Es wird kein DJI Thermal SDK verwendet. Kein M4T-/Pi-/operativer Abnahmestatus wird daraus abgeleitet.

Der Ausgangsemissionsgrad stammt, sofern erkannt, aus einem APP4-`iirp`-Block (Float32 little endian an Offset 40). Fehlt der Wert, wird **0,95 ausdrücklich als angenommener Ausgangswert** angezeigt und exportiert. Die gewählte Emissivität muss zwischen 0,1 und 1 liegen; die reflektierte Temperatur muss endlich und mindestens −273,15 °C sein. **0 °C ist eine gültige Eingabe.** Ungültige Eingaben sperren Exporte, bis sie korrigiert sind.

Bei geänderter Emissivität erfolgt eine Gesamtstrahlungs-Näherung in Kelvin:

`T_neu⁴ = (ε_Datei · T_alt⁴ + (ε_neu − ε_Datei) · T_refl⁴) / ε_neu`

Die Näherung nimmt dieselbe reflektierte Temperatur für Ausgangszustand und Korrektur an. Eine ursprüngliche Reflexionstemperatur wird nicht gelesen. **Bei gleichem Emissionsgrad wirkt T_refl nicht.** Atmosphärische Transmission, spektrale Sensorkalibrierung und Kamera-Drift werden nicht korrigiert. Glas und blanke Metalle können Infrarot spiegeln.

## Parsergrenzen und Fotokandidaten

- Maximal 20 MiB pro Quelldatei, auch bei fehlender Größenangabe im Stream; maximal acht gleichzeitig laufende unterschiedliche Objektladevorgänge.
- Begrenzte Prüfung der JPEG-Marker bis zu einem EOI nach Scanbeginn, einschließlich Byte-Stuffing, Restart-Markern und weiteren Scans; kein vollständiger JPEG-/Entropie-Decoder. Bytes hinter dem EOI werden als opaker Anhang toleriert, nicht interpretiert. Sie zählen vollständig zur 20-MiB-Grenze und zum SHA-256-Quellhash. Ein EOI innerhalb eines APP-Segments oder einer anderen längencodierten Struktur ersetzt keinen tatsächlichen JPEG-Endmarker.
- APP3-Nutzdaten müssen exakt einem UInt16-LE-Frame mit 320×256, 640×512 oder 1280×1024 entsprechen. Zusätzlich ist ein `iirp`-Block oder der DJI-XMP-Hinweis `ImageSource="InfraredCamera"` erforderlich. **Die Kamerakompatibilität bleibt als nicht verifiziert gekennzeichnet.**
- XMP wird nur in den ersten 200.000 Bytes ausgewertet; das ist keine allgemeine XML-/Extended-XMP-Implementierung.
- `…_T.JPG`/`…_T.JPEG` dient der Listenerkennung; die Liste allein beweist keine Radiometrie.
- Fotokandidaten benötigen denselben Bucket, normalisierten Importordner, Tag und Bildindex sowie höchstens drei Sekunden Namenszeit-Abstand. Nur V/W/Z werden berücksichtigt, V/W vor Z. Gleichrangige Kandidaten werden als mehrdeutig gemeldet und nicht automatisch gewählt. Tageswechsel werden nicht überbrückt. Auch eine eindeutige Namenspaarung ist **kein Nachweis der Aufnahmeidentität oder geometrischen Registrierung**.

## Zusammengehöriger Bildzustand und API

Die Bildauswahl sperrt Exporte und leert alte Bilddaten. Nur der neueste, vollständig erfolgreiche Ladevorgang darf die Ansicht freigeben. Rohdatenlänge, Auflösung und Quellversion müssen zusammenpassen. Messungen sind im Seitenspeicher nach Bucket, Objektschlüssel und Quellversion getrennt; sie werden nicht dauerhaft gespeichert.

| GET-Pfad | Inhalt |
| --- | --- |
| `/api/thermal/list` | Kandidaten, Ordner, Name und `visualMatch` (`none`, `ambiguous`, `filename-heuristic`) |
| `/api/thermal/meta?bucket=&key=` | Statistik, Auflösung, Emissivität, ausgewählte XMP-Werte, `estimate`, `formatVerified:false`, Quellgröße und SHA-256-`version` |
| `/api/thermal/raw?bucket=&key=&version=` | UInt16-LE-Frame genau dieses Snapshots; Version/Auflösung in `X-Thermal-*`-Headern |

`/meta` liest das aktuelle Objekt erneut. Parallele Ladevorgänge desselben Objekts werden zusammengeführt. Ein gemeinsamer LRU hält bis zu 24 unveränderliche Snapshots samt Statistik; die SHA-256 bezieht sich auf die vollständigen eingelesenen JPEG-Bytes. Ist eine angeforderte Version verdrängt, antwortet `/raw` mit **409** statt mit einer anderen Version. Ohne Versionsparameter bleibt `/raw` für bestehende Clients nutzbar, liest aber ein aktuelles Objekt. Die Antworten verwenden `Cache-Control: no-store`. Die Oberfläche verlangt die Version und lädt Metadaten vor Rohdaten.

Die allgemeinen API-/LAN-Guards und die Bucket-Allowlist der Medien-Speicherschicht gelten weiter. Dateinamen, Objektpfade und ausgewählte Aufnahmedaten werden nicht anonymisiert. Tatsächlich eingesetzte IAM-/Proxy-Konfigurationen sind getrennt zu prüfen.

## Darstellung und Export

Bildstatistik, Messungsstatistik und Canvas-Beschriftung werden gemeinsam neu berechnet. PNG-Daten und Dateiname werden vor dem asynchronen Kodieren festgehalten, sodass ein späterer Bildwechsel einen bereits ausgelösten Download nicht umbenennt.

- **Messungs-CSV und Temperaturmatrix:** Schätzhinweis, Berechnungsstand `skyhub-thermal-estimate-v2`, Name, Bucket, Objektschlüssel, vollständiger Quellhash, Quellgröße, Auflösung, Einheit, Emissivitätsannahmen und Korrekturparameter.
- **Matrix:** Metadaten-Vorspann, danach Zeilen=y und Spalten=x, Ursprung links oben; Werte in °C, auf zwei Dezimalstellen gerundet. Kein verlustfreier Rohdatenexport. Programme, die bisher ausschließlich Zahlenzeilen erwarteten, müssen den Vorspann überspringen.
- **PNG:** aktuelles Bild mit Markierungen und zusätzlichem lesbarem Metadaten-Fuß. Die Bildhöhe wächst durch den Fuß; Palette, Bereich und Isothermeneinstellung sind aufgeführt.
- **Serie:** ausdrücklich **unkorrigierte Dateischätzungen**; Einstellungen der Einzelbildkorrektur werden nicht angewendet. Serien-CSV enthält Warnung, Berechnungsstand sowie Bucket/Objektschlüssel/Quellversion/Dateiemissivität je erfolgreichem Bild. Fehler bleiben als Fehlerzeilen sichtbar.
- CSV: UTF-8-BOM, Semikolon, Dezimalkomma; potenzielle Formelausdrücke in Textzellen werden entschärft.

## Nachweise und verbleibende Abnahmen

`backend/test/thermal.test.js` prüft synthetische Parser-/API-, Snapshot-, Größen-, Paarungs- und Rechenfälle. `backend/test/thermal-ui-integrity.test.js` verwendet die tatsächlichen Anwendungsfunktionen mit einem DOM-Double für Ladefehler, veraltete Antworten, Beschriftungen, Eingaben und Exportzuordnung. `scripts/thermal-browser-ci.js` prüft mit echtem Chromium die Seite und Downloads gegen eine synthetische lokale API; der Browserjob führt diesen Test aus.

Historische Angaben aus PR #217 (2.088 Bilder, sechs Serien, plausible M4T-Innenraumwerte und manuelle Klicktests) sind Berichte, keine unabhängige radiometrische Abnahme. Offen bleiben Originaldateien samt Referenzauswertung bei identischen Parametern, Firmware-/Modellvarianten, echte Aufnahmezuordnung, Pi-Ressourcen und laufende Proxy-/IAM-Konfiguration. Ein grüner CI-Lauf bestätigt weder Deployment noch Hardwaregenauigkeit.

Deployment nur über den bestehenden, backupgestützten Pi-Backend-Updatepfad in [Betrieb](ops.md); kein Neuaufbau von MinIO, Datenbank oder Broker für diese Korrektur.

### Nachtrag zur Pi-Parserprüfung

Bei der ersten Prüfung nach PR #220 lieferte `/meta` HTTP 422. Die lokale Strukturdiagnose meldete einen Scananfang, elf APP3-Segmente mit zusammen 655.360 Bytes, einen `iirp`-Block und 490 Bytes hinter dem letzten gefundenen EOI. Die in #220 eingeführte Forderung „EOI direkt am Dateiende“ war dafür zu streng. Der korrigierte Parser sucht den EOI über JPEG-Markergrenzen und toleriert den opaken Anhang. Die Diagnose belegt weder dessen Inhalt noch Bild-/Temperaturgenauigkeit. Die erneute Pi-API-Prüfung nach dem Update bleibt erforderlich.
