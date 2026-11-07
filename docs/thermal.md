# SkyHub Next – Thermalmodul

`/thermal.html` liest experimentell DJI-R-JPEG-Kandidaten aus den freigegebenen Medien-Buckets. Die Oberfläche bietet Paletten, Messpunkte, rechteckige Pixelbereiche, Linien-, Kreis- und Ellipsen-ROI, Isothermen, Histogramm, Serienstatistik und Exporte. Sie steuert keine Kamera und schreibt keine Medienobjekte.

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

## DJI-Thermal-SDK-Erprobung auf dem Pi (nicht integriert)

Das DJI Thermal SDK (`dji_irp`) gibt es nur für x86-64. Auf dem Raspberry Pi 5 läuft es über **box64**
(Image `docker/dji-tsdk-box64`, Debian trixie, box64 0.3.4). Das SDK selbst ist nicht im Image und nicht im
Repository (DJI-Lizenz); es wird schreibgeschützt eingebunden. Läufe immer über den Wrapper starten:

```bash
docker build -t skyhub-dji-box64:trixie docker/dji-tsdk-box64
bash scripts/dji-tsdk-run.sh --timeout 60 --sdk ~/.local/opt/dji-tsdk --input BILD_T.JPG --output AUSGABE/ \
  -- ./dji_irp --source /input.JPG --action measure --output /output/t.raw --measurefmt float32
```

Der Wrapper setzt die Frist vom Host aus durch (`timeout` um `docker wait`, danach `docker kill`, Exit 124),
startet mit `--init`, entfernt den Container in jedem Fall (auch bei Abbruch) und stellt auf arm64 `box64`
automatisch voran. Isolation: kein Netz, schreibgeschütztes Dateisystem, keine Capabilities, 1 CPU, 1 GiB,
64 Prozesse. Anlass: Am 02.11.2026 hingen zwei manuell gestartete Prüfcontainer über zwei Stunden, weil
`timeout` **innerhalb** des qemu-emulierten Containers nicht zurückkehrte.

**Befunde vom 02.11.2026** (ein M4T-R-JPEG 640 × 512, keine Kalibrier- oder Hardwareabnahme):

| Laufzeit | Ergebnis |
| --- | --- |
| qemu-user (`--platform linux/amd64`) | `dji_irp` bricht sofort mit Segmentation Fault ab (Exit 139); vermutlich wegen der 16-KiB-Speicherseiten des Pi-5-Kernels |
| box64 0.3.4 (arm64) | `extract` und `measure` erfolgreich, je etwa 1 s |

Mit Emissionsgrad 0,95, Abstand 5 m, Luftfeuchte 70 % und Reflexion 23 °C lieferte das SDK 20,1–27,6 °C
(Median 22,9 °C). Die bisherige Schätzung `raw / 64 − 273,15` dieses Moduls wich davon im Median um 0,11 K ab
(95 % der Pixel ≤ 0,35 K, maximal 1,10 K an den Extremwerten, wo das SDK Emissionsgrad und Reflexion einrechnet).
Das ist ein Einzelvergleich, keine allgemeine Genauigkeitsaussage.

## DJI Thermal SDK in der Weboberfläche (opt-in)

Ist der Dienst `thermal-sdk` aktiv, bietet `/thermal.html` den Umschalter **„DJI Thermal SDK (kalibriert)“ / „Schätzung“**
sowie Abstand (Vorschlag aus dem Laserentfernungsmesser), Luftfeuchte und Umgebungstemperatur. Ohne Dienst bleibt die
Seite unverändert bei der Schätzung.

```
Browser ─► Backend GET /api/thermal/measure ─(internes Netz thermal_sdk, Token)─► thermal-sdk (box64 + dji_irp)
             └─ liest das R-JPEG erneut aus MinIO und prüft SHA-256 = angezeigte Bildversion (sonst 409)
```

- **Dienst** `docker/dji-tsdk-box64/sdk_server.py` (Compose-Profil `thermal-sdk`): nur internes Netz, kein Host-Port,
  schreibgeschütztes Dateisystem, keine Capabilities, 1 CPU / 1 GiB / 64 Prozesse, eigener Benutzer; ein SDK-Lauf
  gleichzeitig, höchstens zwei wartend, 30 s Frist je Lauf (Prozessgruppe wird nativ beendet). SDK-Ausgaben werden nie
  an Clients weitergegeben. Das Backend bekommt **keinen** Docker-Socket.
- **Backend** `backend/thermal-sdk.js`: prüft Parameter mit denselben Grenzen (ablehnen statt anpassen), Ausgabeformat und
  Plausibilität (endliche Werte); `/api/thermal/meta` meldet `sdk.available`. Ergebnisse werden je Version und
  Parametersatz kurz zwischengespeichert. `/thermal/measure` ist wie die übrigen lesenden Thermal-Routen im Heimnetz ohne
  Token erreichbar.
- **Exporte** (PNG/CSV/Matrix) tragen im SDK-Modus Berechnungsstand `skyhub-thermal-dji-tsdk-v1` und alle Parameter.
  Die Serienauswertung bleibt ausdrücklich bei der unkorrigierten Schätzung.

Aktivieren auf dem Pi:

1. SDK lokal entpacken (nicht im Repository) und in `.env` setzen: `SKYHUB_DJI_TSDK_DIR=…`,
   `SKYHUB_THERMAL_SDK_URL=http://thermal-sdk:8790`, `SKYHUB_THERMAL_SDK_TOKEN=$(openssl rand -hex 32)`.
2. Dienst bauen und starten: `bash scripts/pi-compose.sh up -d --build thermal-sdk` (ausdrücklich genannte Profil-Dienste startet Compose auch ohne aktives Profil).
3. Backend neu erzeugen: `bash scripts/pi-update-backend.sh --apply`.

Rückweg: `SKYHUB_THERMAL_SDK_URL` leeren, Backend neu erzeugen, `bash scripts/pi-compose.sh stop thermal-sdk`.
Gemessen auf dem Pi 5: etwa 1 s je Bild (640 × 512).

## Geometrische Temperaturmessungen (SDKs-DjiImage-Referenz, 06.11.2026)

Die **Werkzeuge Linie, Kreis, Ellipse** werden auf der bereits berechneten Float32-Temperaturmatrix ausgeführt. Die
ROI-Auswertung ruft weder das DJI Thermal SDK noch DJI Cloud API erneut auf; sie verändert keine Kamera,
Medien oder gespeicherte Datei. Die Messtemperaturen folgen dem aktuell ausgewählten Modus (DJI SDK
oder Schätzung) und ändern sich daher bei Neuberechnung der Bildmatrix.

- **Linie**: Ganzzahl-Bresenham mit beiden Endpunkten, jeder Raster-Pixelmittelpunkt höchstens einmal.
  Horizontal und vertikal sind erlaubt.
- **Ellipse**: Bounding Box der Zugbewegung, Pixelmittelpunkte innerhalb der Ellipsengleichung.
- **Kreis**: Inscribed Circle der Bounding Box (Mittelpunkt der Box, Radius = halbe kürzere Seitenlänge).
  Bei nichtquadratischem Aufziehen wird die kürzere Seite verwendet.
- Pixelkoordinaten sind ganzzahlig und werden auf die Bildgrenzen begrenzt. Fehlerhafte Matrizen
  oder nicht-endliche Koordinaten werden abgelehnt; nicht-endliche Temperaturen werden ausgelassen.
  Eine Messung ohne gültige Temperaturwerte ergibt kein Statistikobjekt.
- Ausgewertet werden Minimum, Mittel, Median, Maximum und Anzahl der tatsächlich eingeschlossenen
  Pixel; CSV enthält Messgeometrie, Eck-/Endpunkte, Quellversion und Berechnungsprovenienz.
- Beim Wechsel von Bild oder Berechnungsmodus werden Messwerte neu aus derselben Bildversion ermittelt.
  Historische Bildversionen werden weiter über den SHA-256-Snapshot getrennt gehalten.
- Touch-Drag wird anhand der aktiven Pointer-ID verarbeitet; Pointer-Abbruch verwirft nur die
  nicht abgeschlossene Zeichnung.

Technische Inspiration: [Jazous/SDKs-DjiImage](https://github.com/Jazous/SDKs-DjiImage)
(MIT-lizenzierter .NET-Wrapper). Die Raster-Geometrie wurde für SkyHub unabhängig in JavaScript
implementiert; es werden weder die .NET-Bibliothek noch native DJI-Binärdateien eingebunden.

**Abnahmegrenze:** Diese Erweiterung verändert nur die Auswertung. Aus einer SDK-berechneten
Temperaturmatrix lässt sich keine unabhängig nachgewiesene Messgenauigkeit ableiten.
Tests: `backend/test/thermal-geometry.test.js` und
`backend/test/thermal-ui-integrity.test.js`.
