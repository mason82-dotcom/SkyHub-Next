# Mavic 3M über bestehenden MinIO: sichere Pi-End-to-End-Leseprüfung

Stand 21.10.2026 · Entwicklungsbranch: feature/m3m-minio-integration-20261021

## Ziel und Datengrenzen

Dieser Test verarbeitet die **existierende** SkyHub-Medien-API
GET /api/media/objects aus dem bereits laufenden Backend. Er deployt
**nicht** die neue Route /api/media/m3m/inventory. Der lokale
Inventurcode kann so unmittelbar gegen die gespeicherten S3-Objekt-
**Namen** geprüft werden, ohne den produktiven DJI-/MQTT-Prozess neu zu
starten oder anzupassen.

Das Testprogramm scripts/pi-m3m-s3-inventory-check.js verwendet:

- exakt den erlaubten Bucket dji-cloud und den **explizit angegebenen**
  Prefix; es gibt keinen impliziten Bucket-Root-Scan;
- höchstens 200 Objekte je S3-Seite und höchstens 101 Seiten;
  unvollständige Ergebnisse werden **nicht** als Gesamtinventur ausgegeben;
- **nur** Lesebefehle an die bereits authentifizierte Medien-API;
- den bereits **im Backend-Container vorhandenen** View-Token,
  ohne dessen Wert in Prozessargumente, Logs oder Ausgaben zu schreiben;
- flüchtige, begrenzte Docker-stdout-Pipes für Objektnamen zwischen
  Container und lokalem Elternprozess, ohne Dateispeicherung;
- ausschließlich aggregierte Gesamt-/Band-/Vollständigkeitszähler
  in der Terminalausgabe, ohne Objektschlüssel, Namen,
  Aufnahmezeit, Koordinaten oder Prefix.

Es gibt **keine** neuen Container, keine neuen Netzwerk-S3-Abos,
keine Schreiboperationen und keinen DJI-Steuerbefehl.

## Auf dem Pi ausführen

Nur wenn der vorhandene lokale Branch sauber ist:

    cd ~/Projekte/SkyHub-Next || exit 1
    git status --short --branch
    git fetch origin

    # Fast-forward nur bei sauberem lokalen Checkout!
    # Kein reset --hard, kein stash ohne Prüfung.
    git pull --ff-only origin feature/m3m-minio-integration-20261021

    node --test \
      backend/test/pi-m3m-s3-inventory-check.test.js \
      backend/test/m3m-s3-inventory.test.js \
      backend/test/media-api.test.js

    node scripts/pi-m3m-s3-inventory-check.js --help

### Ohne Angabe eines privaten Bucket-Pfads starten

Wenn der genaue Ordnername nicht bekannt ist, kann der Prüfer den
**ersten 100 Einträgen** des bereits geschützten dji-cloud-Buckets
einen einzigen wahrscheinlichen M3M-Ordner zuordnen.
Er verlangt dafür mindestens **zwei** passend benannte Dateien in
**genau einem** Verzeichnis. Bei mehr als einem passenden Verzeichnis,
ungültigen Schlüsseln oder nur einer passenden Datei bricht er ab.
Er gibt weder den ermittelten S3-Prefix noch einzelne Namen aus.

    SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
      node scripts/pi-m3m-s3-inventory-check.js \
      --auto-first-page

Wenn die erste Seite einen eindeutigen Ordner identifiziert, wird
**nur dieser** Prefix anschließend bis zum bestehenden Limit von
101 S3-Seiten vollständig inventarisiert. Die JSON-Antwort enthält
discoveryScope=first-100-entries-only. Das bezieht sich **nur auf
die Ordnersuche**; es ist kein Beweis, dass dieser Ordner der
einzige M3M-Ordner des ganzen Buckets ist.

Beim zuvor auf dem Pi berichteten Teilausschnitt fanden sich
3 M3M-ähnliche Dateien in genau einem gemeinsamen Unterverzeichnis.
Das rechtfertigt diesen vorsichtigen Versuch, bestätigt jedoch
keine Vollständigkeit des gesamten Buckets.

Anschließend den **tatsächlich bekannten** M3M-Prefix auswählen.
Nicht die vorhandenen Objekt-IDs, Positionsdaten, Bucket-Schlüssel
oder den Prefix hierher kopieren. Beispiel mit **Platzhalter**, der
an den realen Medienpfad angepasst werden **muss**:

    SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
      node scripts/pi-m3m-s3-inventory-check.js \
      --prefix "missions/MEIN_BEKANNTER_M3M_ORDNER/"

Der Reader spricht nur die bereits laufende, authentifizierte
HTTP-Schnittstelle im bestehenden skyhub-next-Backend an.
Bei einem Auth-/Netzwerk-/Pagination-Fehler wird **nur eine generische
Fehlermeldung** gedruckt (Exit-Code 2). Ein vollständiger Scan
beweist ausschließlich Dateinamen-Konventionen, nicht Dateiinhalte
oder Bildqualität. ndviReady, ndreReady und Reflektanz-Flags bleiben
ausdrücklich false.

## Weitere technische Freigabegrenzen

Die spätere Live-Abnahme des *deployten* Endpoints
GET /api/media/m3m/inventory?prefix=... inklusive HTTP 401 ohne
View-Token bleibt getrennt. Der hier beschriebene Test ist **kein
Auftrag, jetzt das produktive Backend neu zu erstellen**.

Bestehende MinIO-Objekte werden nicht geändert oder migriert.
PR #19 (geteilter MinIO), PR #23 (Offline-Inventur) und der
Integrations-PR teilen Teile ihres Codes; vor einem Merge
muss die Reihenfolge und Doppelung geprüft werden.
Bei positivem Nameninventar sind M3M-RGB-/TIFF-XMP-Verifikation,
radiometrische Korrektur und Bandregistrierung separat abzunehmen.


## Echte Pi-5-Live-Abnahme: 424 direkte Objekte (21.10.2026)

Der Benutzer hat aus dem Worktree auf Commit `211c214` acht
Node-Tests erfolgreich ausgeführt und anschließend den bereits
laufenden authentifizierten Medien-GET-Endpunkt mit
`--auto-first-page` gelesen. Der aktive Pi-Container wurde
dabei weder neu gestartet noch verändert. Die anonyme Zählung:

| Merkmal | Wert |
|---|---:|
| Direkt gelistete Objekte im eindeutig erkannten Prefix | 424 |
| Strikt passende M3M-Dateinamen | 3 |
| Noch nicht klassifizierte Namen | **421** |
| Invalide Namen | 0 |
| RGB / Green / Red / RedEdge / NIR | **1 / 0 / 1 / 0 / 1** |
| Mutmaßliche Capture-Gruppen | 2 |
| Vier-Spektral-/Fünf-Kanal-Sets | **0 / 0** |
| Unvollständige Gruppen | 2 |
| Doppelbelegte Kanäle | 0 |

Die **komplette Paginierung innerhalb des ausgewählten Prefixes**
war erfolgreich; `discoveryScope=first-100-entries-only` bezieht
sich ausschließlich auf die **Suche des Prefixes**, nicht auf
die darauf folgende 424-Objekte-Inventur. Andere Prefixe im Bucket
wurden nicht vollständig durchsucht.

**Kein Nachweis fehlender M3M-Sensoraufnahmen:**
421 der 424 Objekte sind unter den streng unterstützten
Original-Dateinamensmustern noch *unbekannt*. Der erste
Live-Scan konnte nicht unterscheiden, ob darunter weitere
JPG/TIF-Varianten, fremde Medienformate oder anders benannte
Multispektralbilder liegen. Deshalb **nicht** automatisch fehlende
Bildkanäle nachladen, S3-Objekte umbenennen oder
Vegetationsindizes berechnen.

### Folgeprüfung: anonyme Dateiformat-Verteilung

Die Offline-Inventur wurde um eine ausschließlich
**kategorienbasierte** Aufschlüsselung der nicht erkannten
Objektnamen ergänzt:

- `unrecognizedFormats`: feste Schlüssel JPEG, TIFF,
  DNG, PNG, MP4, MOV, LRF, SRT, JSON, XML, KMZ,
  OTHER_EXTENSION, NO_EXTENSION mit **ausschließlich Zählwerten**;
- `unrecognizedDjiPrefixedImages`: Anzahl sonstiger
  JPEG-/TIFF-/DNG-/PNG-Namen, die mit `DJI_` beginnen;
- `unrecognizedOtherImages`: Anzahl anderer Bildnamen.

Weder beliebige Dateiendungen, Objektschlüssel, Aufnahmezeiten,
Dateinamen, S3-Prefixe noch sonstige Metadaten werden kopiert
oder im Ergebnis wiedergegeben. Dateiendungen sind **kein
Dateiinhaltsbeweis**. Zur Messung den aktualisierten Branch
per Fast-forward ziehen und **denselben**, rein lesenden
Aufruf wiederholen:

    SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
      node scripts/pi-m3m-s3-inventory-check.js --auto-first-page

Eine hohe `unrecognizedFormats.JPEG`-/TIFF-Anzahl und
ein hoher `unrecognizedDjiPrefixedImages`-Zähler würden
zunächst eine sichere Analyse alternativer Namensmuster
rechtfertigen. Sind überwiegend MP4/andere Formate vorhanden,
ist eine Änderung des M3M-Dateinamenparsers voraussichtlich
nicht zielführend. Keine Originaldatei muss zur Entscheidung
heruntergeladen werden.


## Realer Pi-Nachtest: 421 unbekannte Dateien nach Dateityp

Der Benutzer hat am 21.10.2026 die private MinIO-Medieninventur
erneut ausgeführt; die beiden lokalen Node-Suiten meldeten
**17/17 bestandene Tests**. **Alle 424 direkten Objekte**
des automatisch ausgewählten Prefixes wurden vollständig
paginiert, ohne Namen oder Schlüssel auszugeben.

Die **421** bislang unbekannten Dateinamen lassen sich bereits
anhand ihrer Endung aufschlüsseln:

| Kategorie | Unbekannte Namen |
|---|---:|
| JPEG/JPG | 398 |
| TIFF/TIF | 6 |
| KMZ | 17 |
| Alle anderen Kategorien | 0 |
| **Summe** | **421** |

Unter den **404 unbekannten Bildern** beginnen **37 mit**
dem festen Namensprefix \`DJI_\`, **367 nicht**.
Die zusätzlichen **3 bereits erkannten M3M-Dateinamen**
teilen sich in RGB=1, Red=1 und NIR=1 auf, verteilt auf
zwei partielle Aufnahmegruppen. Green/RedEdge und vollständige
Fünf-Kanal-Gruppen waren unter den *bereits unterstützten
Namensmustern* nicht nachgewiesen.

**Keine Schlussfolgerung über tatsächliche Bildinhalte:**
Die sechs TIFF-Dateien sind der wichtigste nächste
Namensformat-Kandidat. Aus der bisherigen Summe
\`unrecognizedDjiPrefixedImages=37\` allein lässt sich jedoch
**nicht** erkennen, wie viele davon TIFFs statt JPEGs sind.
Ebenso kann ein anders benanntes JPEG anderen Geräten oder
Diensten zugeordnet sein. Es gibt keinen Anlass, 398 JPEGs als
M3M-RGB-Aufnahmen oder 17 KMZ-Dateien als einzelne Flüge
zu zählen.

Der nachfolgende Code-Stand ergänzt daher
\`unrecognizedImagesByPrefix.djiPrefixed\` und
\`unrecognizedImagesByPrefix.other\`, jeweils nur mit den
**festen** Unterkategorien JPEG/TIFF/DNG/PNG.
Diese Zähler erlauben eine sichere Entscheidung, ob
DJI-artig benannte TIFFs tatsächlich im unbekannten Bestand
vorliegen. **Dieser zusätzliche Cross-Tab ist noch nicht mit
echten Pi-Daten getestet**.

Weiterhin sind alle Kalibrierungs-, Bandregistrierungs- und
NDVI/NDRE-Freigabeflags \`false\`. Ein Bilddownload,
Umbenennen oder Dateiinhaltscheck wurde nicht durchgeführt.



## Nachtest: Unbekannte TIFF-Dateien getrennt nach DJI-Präfix (21.10.2026)

Der Nutzer hat 18/18 lokale Node-Tests auf dem Pi bestanden und den
vollständig paginierten, automatisch ausgewählten Prefix erneut analysiert:

- 424 direkte Objekte; 421 unbekannte Dateinamen.
- Davon 398 unbekannte JPEG, 6 unbekannte TIFF und 17 KMZ.
- Die **37 unbekannten DJI_-präfigierten Bilder sind ausschließlich JPEG**.
  Unter den **sechs unbekannten TIFF-Dateien beginnen null mit DJI_**.
- Die 361 übrigen unbekannten JPEGs und sechs TIFFs tragen kein
  DJI_-Präfix. Drei ausdrücklich erkannte M3M-Dateien (RGB, R, NIR)
  ändern diese Einteilung nicht.
- In dieser Namensanalyse: 0 vollständige Vierband-/Fünfband-Sets.
  Das ist keine Aussage über Sensorwerte oder vollständige
  M3M-Bildbestände in anderen S3-Prefixen.

### Zusätzliche streng begrenzte TIFF-Namenshinweise

Die Diagnose zeigt künftig ausschließlich die **Anzahl**
von *nicht bereits erkannten* TIFF-Namen in folgenden
**gegenseitig ausschließenden** Kategorien:

| Fixer Ergebnisname | Sicheres Interpretationsniveau |
|---|---|
| spectralBandSuffix.G/R/RE/NIR | Name endet mit \`_MS_G/R/RE/NIR.tif(f)\` oder \`-MS-...\` |
| vegetationIndex | Name enthält den abgegrenzten Marker NDVI/NDRE/GNDVI/OSAVI/SAVI/EVI |
| mosaicOrElevation | Name enthält abgegrenzten ORTHO/MOSAIC/ORTHOMOSAIC/DSM/DTM/DEM-Marker |
| other | Kein unterstützter Marker |

Der Bericht erzeugt \`unrecognizedTiffNameHints\`. Die
Kategorien summieren sich immer auf
\`unrecognizedFormats.TIFF\`; sie ersetzen weder
Datei-Inhaltsprüfung noch Georeferenzierung oder
radiometrische Validierung. Insbesondere ist die
Namensendung \`_MS_NIR\` **kein Nachweis eines funktionierenden
NIR-Bilds**. Auch für andere Präfixe (nicht DJI_) wird nie
automatisch M3M-Herkunft behauptet.

Die Pi-Abnahme dieser neuen TIFF-Namenshinweise steht noch aus.
Dafür nach Fast-forward von PR #24 denselben bestehenden
\`--auto-first-page\`-Test wiederholen. Es werden nur
aggregierte Zahlen ausgegeben; der Speicherinhalt,
die Backend-Container und die DJI-Verbindung bleiben unangetastet.

## Neuer Pi-Livetest: maximal 16 Headerbytes pro unbekannter TIFF-Datei

Der reale Pi-Test vom 21.10.2026 bestand **20/20 lokale Tests**.
Die sechs unbekannten TIFF-Dateinamen hatten keine der geprüften
Namensmarkierungen (G/R/RE/NIR, NDVI, Orthomosaik, Höhenmodell).
Der nächste Test prüft deshalb **Dateisignaturen** statt weiterer
Namensmuster.

Neuer Prüfer: `scripts/pi-m3m-tiff-magic-check.js`.
Er liest zunächst einen eindeutig erkannten M3M-verdächtigen Prefix
anhand **nur der ersten 100 Bucket-Einträge**. Dann zählt er die
direkten, bisher nicht erkannten TIFF-Objekte über vollständig
begrenzte S3-Pagination. **Mehr als 12 Kandidaten: Abbruch.**

Für jeden TIFF-Kandidaten wird ausschließlich im bereits
laufenden Backend-Container ein S3 GetObject mit
`Range: bytes=0-15` und vorhandenen Reader-Credentials
ausgeführt. Nur bei **HTTP 206**, gültigem Content-Range
und einer Content-Length von höchstens 16 Bytes werden diese
maximal 16 Bytes auf die vier TIFF-/BigTIFF-Signaturen geprüft.
Bei verweigertem GET wird `unavailable` gezählt; bei
ignoriertem Bytebereich `rangeNotHonored`.
Das bedeutet **keine Freigabe zusätzlicher S3-Rechte**.

Es werden keine TIFF-Verzeichnisblöcke, EXIF, XMP, Koordinaten,
Pixel oder Kalibrierinformationen verarbeitet. Es erscheinen
ausschließlich feste Headerklassen und Summen, niemals die
Dateinamen, Schlüssel, Prefixe oder Bildbytes. Insbesondere
beweist ein korrekter TIFF-Header **keine** DJI-M3M-Herkunft,
Reflektanz, Bandregistrierung oder NDVI-/NDRE-Bereitschaft.
Die betreffenden Flags bleiben `false`.

### Auf dem Pi nur nach Fast-forward ausführen

    cd ~/Projekte/SkyHub-Next || exit 1
    git status --short --branch
    git fetch origin
    git pull --ff-only origin feature/m3m-minio-integration-20261021
    node --test backend/test/m3m-tiff-magic.test.js
    node scripts/pi-m3m-tiff-magic-check.js --help

    # Optional: 16 Headerbytes pro Kandidat lesen, keine Medien ändern
    SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
      node scripts/pi-m3m-tiff-magic-check.js --auto-first-page

Der Prüfer schreibt keine Dateien oder Buckets, ändert keine
Docker-/MinIO-Konfiguration und startet den Backend-Container
nicht neu. Ein GET-Ablehnungsbefund ist kein Schreibfehler.

## Hardwareabnahme: 6/6 echte TIFF-Header (22.10.2026)

Der Raspberry Pi 5 hat den opt-in-Headerprüfer gegen den bestehenden
MinIO-Lesezugang erfolgreich ausgeführt. Im automatisch gewählten
S3-Unterordner wurden **sechs bislang nicht nach Dateinamen erkannte
TIFF-Objekte** untersucht, jeweils mit einem GET-Bytebereich von
höchstens 16 Bytes. **6/6 = Classic TIFF Little Endian**,
**0** BigTIFF, **0** ungültige Signaturen, **0** verweigerte GETs,
**0** nicht respektierte Byte-Range-Antworten. Die Erfolgszahl gilt
**nur** für diese sechs TIFF-Signaturen und den zuvor begrenzt
ausgewählten S3-Prefix.

Kein Bildinhalt, TIFF-IFD, EXIF/XMP, Kameramodell, Bandidentität,
GPS, Radiometrie oder NDVI/NDRE wurde mit diesem Test geprüft.
Der im vorausgehenden Commit `0a94f0c` korrigierte Offline-Test
verhindert die Verwechslung wiederholter Continuation Tokens mit
doppelten Objekt-Keys. Der Nutzer meldete bei der Headerprüfung
einen vollständigen anonymisierten Ergebnisbericht, aber keinen
ausführlichen Offline-Test-Report des korrigierten Einzeltests.

Nächster unabhängiger Freigabeschritt ist eine **separate, freiwillige,
streng begrenzte IFD-Strukturprüfung** mit festen Kategorieausgaben.
Auch ein IFD-Nachweis ist keine Multispektral- oder Kalibrierfreigabe.


## Freiwillige nächste Stufe: erster Classic-TIFF-IFD, maximal 1.040 Bytes

Nach sechs erfolgreichen Little-Endian-Classic-TIFF-Signaturproben
ist der nächste eigene **opt-in**-Schritt vorbereitet:

    node --test backend/test/m3m-tiff-ifd.test.js
    node scripts/pi-m3m-tiff-ifd-check.js --help

    SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
      node scripts/pi-m3m-tiff-ifd-check.js --auto-first-page

Dieser Code wurde **noch nicht auf realen Pi-Bilddateien** ausgeführt.

Der Vorgang verwendet weiter nur das produktiv **bereits laufende**
SkyHub-Backend und dessen bestehenden eingeschränkten S3-Reader.
Er listet maximal zwölf direkte unbekannte TIFF-Objekte aus dem
eindeutig anhand der ersten 100 Bucket-Einträge ermittelten Prefix.
Pro Objekt erfolgen **höchstens zwei** bestätigte HTTP-206-GETs:
erste 16 Bytes und maximal 1.024 Bytes ab dem **ersten Classic-TIFF
IFD-Offset**, sofern dieser zwischen 8 und 262.144 liegt.
Ungültige Bytebereiche oder nicht bestätigte HTTP-206-Antworten
werden als nicht verfügbar gemeldet. Es werden keine weiteren
IFD- oder Datenoffsets verfolgt und **keine Bildpixel dekodiert**.

Die aus dem ersten IFD auslesbaren, streng limitierten Inline-
Strukturwerte werden ausschließlich in **feste Kategorien** übersetzt:
- Bildflächengröße: bis 5 MP, 5–25 MP, über 25 MP, unbekannt
- Samples per Pixel: 1, 3, 4, andere, unbekannt
- Bits per Sample: 8/10/12/16/32, gemischt/extern, unbekannt
- Kompression: unkomprimiert, andere Kompression, unbekannt
- ausschließlich das *Vorhandensein* von GeoTIFF-/EXIF-Pointer-/
  XMP-Tags als aggregierte Zähler, **niemals deren Werte**

Meldegruppen sind nur zusammengefasste Zähler, **keine**
individuellen Dateidatensätze, Rohdaten, Bildabmessungen,
Objektschlüssel, Metadatenwerte oder GPS. Die IFD-Anwesenheit
beweist weder ein gültiges Pixelarray noch radiometrische Kalibrierung,
M3M-Sensorherkunft oder NDVI-/NDRE-Bereitschaft. Die entsprechenden
Freigabe-Flags bleiben auf false.

Es gibt keine S3-PUT/DELETE-, Docker-Neustart-, Datenbank- oder
DJI-Steueroperation. Bei einer Reader-GET-Sperre darf keine
Root-Berechtigung als vermeintliche Fehlerbehebung weitergegeben werden.


## Pi-Abnahme der Classic-TIFF-IFDs – 22.10.2026

Der Nutzer hat mit `node --test backend/test/m3m-tiff-ifd.test.js`
**7/7 bestandene Tests (0 Fehler)** gemeldet und unmittelbar danach
`scripts/pi-m3m-tiff-ifd-check.js --auto-first-page` gegen den
bereits laufenden Backend-/MinIO-Reader erfolgreich ausgeführt.

Die **sechs** unbekannten TIFF-Objekte im automatisch erkannten
S3-Unterordner wurden in **maximal zwei HTTP-206-S3-Bytebereichen pro
Objekt** untersucht (erste 16 Byte, danach maximal 1024 Byte
ab erstem Classic-TIFF-IFD). Die aggregierte echte Pi-Ausgabe:

| Nur Struktur / feste Kategorie | Anzahl |
|---|---:|
| IFD erfolgreich ausgewertet | 6 |
| IFD nicht auswertbar / S3-Range-Fehler | 0 |
| Bildfläche 5–25 MP | 6 |
| Samples per Pixel = 1 | 6 |
| Bits per Sample = 16 | 6 |
| TIFF Compression = uncompressed | 6 |
| EXIF-IFD-Pointer-Tag vorhanden | 6 |
| TIFF-XMP-Tag 700 vorhanden | 6 |
| Von diesem Parser abgefragte GeoTIFF-Tags vorhanden | 0 |

Diese Kombination ist mit einigen Arten von Multispektral-Rasterdaten
**vereinbar**, kein Identitäts- oder Inhaltsnachweis. **5–25 MP ist nur
eine Größenklasse**, nicht die bestätigte DJI-Sensorauflösung.
Die Aussage „kein GeoTag“ gilt **ausschließlich** für die begrenzte
IFD-Tag-Allowlist im ersten IFD. Sie sagt nicht, dass GPS/Georeferenzierung
in anderen IFDs, EXIF, XMP oder externen Referenzen fehlen.

`m3mSourceVerified`, `imagePayloadVerified`,
`radiometricCalibrationVerified`,
`bandCoregistrationVerified`, `reflectanceReady`,
`ndviReady` und `ndreReady` sind und bleiben **false**.

**Nächster Freigabeschritt:** Ausschließlich die Anwesenheit von
DJI-spezifischen XMP-Metadatenschlüsseln und ggf. strikt auf
G/R/RE/NIR begrenzte, ausdrücklich als *unverifiziert* gekennzeichnete
Bandnamen untersuchen; niemals DJI-Seriennummern, GPS, UUID,
Aufnahmedatum, Roh-Metadaten oder Bildpixel ausgeben.
Die opt-in-Implementierung und die echte Pi-Abnahme sind getrennte
Schritte.


## Geplanter nächster Read-only-Metadatengate: DJI-XMP-Schema (opt-in)

DJI dokumentiert für Mavic-3M-Multispektral-TIFFs u. a. die XMP-
Felder \`ImageSource\`, \`BandName\`, \`SensorIndex\`, \`SensorGain\`,
\`BlackCurrent\`, \`Irradiance\`, \`SensorGainAdjustment\` und
\`VignettingData\`. Die reine Existenz dieser Felder beweist
**weder** eine DJI-Herkunft **noch** eine korrekte Kalibrierung.

Quellen:
- DJI Mavic 3M Image Processing Guide (August 2023),
  https://dl.djicdn.com/downloads/DJI_Mavic_3_Enterprise/20230829/Mavic_3M_Image_Processing_Guide_EN.pdf
- DJI Enterprise Mavic 3M specifications,
  https://enterprise.dji.com/mavic-3-m/specs
- DJI Mavic 3M user manual (Metadatenfeld-Definitionen),
  https://www.dji.com/downloads/products/mavic-3-m

Neu sind \`backend/m3m-xmp-markers.js\` (reiner Allowlist-Parser) und
\`scripts/pi-m3m-xmp-markers-check.js\` (separater *freiwilliger*
Header/IFD/XMP-Metadaten-Test). **Echte Pi-Abnahme noch offen.**

### Exakt begrenzter Zugriff

- dieselben höchstens 12 nicht erkannten direkten TIFFs im einzigen,
  anhand der ersten 100 Bucket-Einträge ausgewählten Prefix;
- pro Objekt maximal drei streng auf HTTP 206 und Content-Range
  geprüfte S3-GETs: **16 + 1024 + maximal 32768 Bytes**;
- XMP-Payload nur bei vorhandenem Tag 700, erlaubtem Datentyp
  (BYTE/ASCII/UNDEFINED), zulässigem Offset und begrenzter Länge;
- Roh-XMP wird **im laufenden Backend-Container kurzzeitig in RAM
  gelesen**. Es kann GPS, Zeitstempel, UUIDs, Seriennummern und
  weitere personenbezogene Informationen enthalten: diese werden
  **nicht** ausgegeben, geloggt oder als Datei gespeichert;
- nur fest erlaubte XMP-\`drone-dji\`-Feldnamen werden als
  **Anwesenheitszähler** aggregiert; ausschließlich \`BandName\` und
  \`ImageSource\` dürfen die *festen* Band-Hinweise G/R/RE/NIR
  auslösen. Bei widersprüchlichen oder wiederholten Angaben
  folgt \`inconsistent\` bzw. \`unknown\`;
- keine Geräte-, Sensor-, Pixel-, Reflektanz- oder
  Vegetationsindex-Freigabe durch Feldnamen und Bandhinweise.
  \`m3mSourceVerified\`, \`reflectanceReady\`,
  \`ndviReady\` und \`ndreReady\` bleiben false.

### Getrennter Raspberry-Pi-Test nach grüner CI

    cd ~/Projekte/SkyHub-Next || exit 1
    git status --short --branch
    git pull --ff-only origin feature/m3m-minio-integration-20261021
    node --test \
      backend/test/m3m-xmp-markers.test.js \
      backend/test/pi-m3m-xmp-markers.test.js
    node scripts/pi-m3m-xmp-markers-check.js --help

    # NUR MIT BEWUSSTER FREIGABE für temporäres Lesen von XMP
    # (maximal 32 KiB XMP-Metadaten pro TIFF, nur private RAM-Verarbeitung)
    SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
      node scripts/pi-m3m-xmp-markers-check.js --auto-first-page

Der neue Aufruf ist **nicht** Teil des zuvor ausgeführten
erfolgreichen 7/7-IFD-Tests. Trotz gleicher S3-Reader-Rolle geht er
einen Schritt weiter, weil erstmals begrenzte XMP-Inhalte in RAM
gelesen werden. Falls der Nutzer das nicht möchte, bleibt dieser
optionale Schritt deaktiviert. Keine Objektänderungen,
Container-Neustarts oder credential changes.


## Echte Pi-Abnahme: DJI-XMP-Feldnamen und Bandhinweise (22.10.2026)

Der Nutzer hat den neu abgesicherten, ausschließlich aggregiert
ausgebenden XMP-Prüfer gegen **sechs unbekannte TIFFs** im bisher
automatisch gewählten S3-Unterordner ausgeführt. Alle sechs
XMP-Pakete wurden mit gültigem Byte-Range-Zugriff analysiert:
`status.ok=6`, alle anderen Fehlerzustände `0`.

**Anonyme Bandhinweise aus den sechs XMP-Paketen:**

| Nur XMP-Hinweis | Anzahl |
|---|---:|
| Green (G) | 0 |
| Red (R) | **3** |
| Red Edge (RE) | 0 |
| NIR | **3** |
| Unknown / inconsistent | 0 |

**Vorhandene DJI-XMP-Feldnamen bei je sechs von sechs Dateien:**
`ImageSource`, `BandName`, `SensorIndex`, `BandFreq`,
`SensorGain`, `SensorGainAdjustment`, `Irradiance`,
`VignettingData` und `DewarpData`.

**Nicht unter den exakten geprüften Markern gefunden:**
`CentralWavelength`, `BlackCurrent`,
`IrradianceExposureTime`, `IrradianceGain`,
`VignettingPolynomial`. Dies beweist **nicht** das Fehlen
radiometrischer Informationen unter anderen Feldnamen,
in anderen Metadatenstrukturen oder Bilddateien.

Die sechs früher als "other" kategorisierten TIFF-Dateinamen
tragen somit DJI-artige Bandhinweise in ihren XMP-Paketen,
obwohl sie weder mit `DJI_` beginnen noch den unterstützten
M3M-Dateinamensmustern entsprechen. **Dateinamen sind für diesen
Datenbestand kein hinreichender Klassifikator.**

Der Pi-Test bestätigt weder das Kameramodell noch die Echtheit
des XMP, den Bezug zu einer konkreten Aufnahmegruppe,
Bandregistrierung, Bildpixel-Integrität oder Kalibrierung.
Insbesondere sind die **3 R- und 3 NIR-Hinweise keine
drei vollständigen R/NIR-Bildpaare**. Ein Vergleich der
zwei zusätzlich kanonisch benannten TIFFs im selben Prefix
mit ihren XMP-Angaben wurde noch nicht durchgeführt.
Andere Bucket-Prefixe wurden nicht vollständig geprüft.

Alle Freigabeflags
`m3mSourceVerified`, `radiometricCalibrationVerified`,
`bandCoregistrationVerified`, `reflectanceReady`,
`ndviReady` und `ndreReady` bleiben **false**.



## Folgeschritt: bekannte und umbenannte TIFFs gemeinsam prüfen

Da sechs `DJI_`-untypisch benannte TIFFs die XMP-Hinweise
**R=3** und **NIR=3** enthalten und die frühere
Dateinameninventur außerdem bereits **ein R- und ein NIR-TIFF**
als kanonischen Namen erkennen konnte, ist ein gemeinsamer
XMP-Vergleich sinnvoll. Er soll verhindern, dass bandbezogene
Aussagen allein aus der Schreibweise von Objektschlüsseln
abgeleitet werden.

Neuer separater Modus:

    SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
      node scripts/pi-m3m-xmp-markers-check.js --all-tiffs-first-page

Unterschied zu `--auto-first-page`: Auch TIFF-Namen, die der
bisherige M3M-Namensparser schon erkennt, werden in dieselbe
strikt aggregierte XMP-Diagnose einbezogen. Der Prüfumfang bleibt
maximal **12 direkte TIFFs aus genau einem** automatisch gefundenen
S3-Unterordner; keine Bucket-weite Stichprobe und keine Prüfung
anderer Prefixe. Je Objekt maximal drei streng geprüfte Bytebereichs-
GETs, insgesamt 33.808 angeforderte Bytes. Die Auswertung erfolgt
isoliert im bereits laufenden Backend; an das Pi-Programm werden
ausschließlich die nach fester Allowlist validierten Summen
übermittelt. **Kein Backend-Deploy oder S3-Schreibzugriff.**

Der gemeinsame Live-Test wurde **noch nicht durchgeführt**.
Insbesondere kann auch ein R=4/NIR=4-Ergebnis nicht vier
R/NIR-Aufnahmepaare belegen; dafür wäre eine weitere, separat
geschützte Zuordnung über übereinstimmende Aufnahme-IDs und
validierte Bildmetadaten erforderlich. Green- und Red-Edge-Bänder
aus anderen S3-Prefixen bleiben unabhängig davon möglich.


## Acht-TIFF-Gesamtabnahme aus echtem MinIO (22.10.2026)

Der Nutzer hat **20 von 20 lokalen Node-Tests** bestanden
und unmittelbar danach die neue Option `--all-tiffs-first-page`
gegen das bestehende Raspberry-Pi-Backend ausgeführt.

Der automatisch aus den ersten 100 Bucket-Schlüsseln erkannte
Prefix wurde vollständig paginiert. **Acht direkte TIFFs** in
diesem Prefix wurden in begrenzten HTTP-206-Range-Requests gelesen;
bei **8/8** XMP-Reports war `status.ok=8` und alle
Fehlerzähler waren null.

| XMP-Bandhinweis | Anzahl TIFFs |
|---|---:|
| G | 0 |
| R | **4** |
| RE | 0 |
| NIR | **4** |
| unknown / inconsistent | 0 |

Alle acht besitzen die geprüften XMP-Feldmarker
`BandName`, `ImageSource`, `SensorIndex`,
`BandFreq`, `SensorGain`, `SensorGainAdjustment`,
`Irradiance`, `VignettingData` und `DewarpData`.
Die zuvor getrennt gemessenen sechs unbekannt benannten
TIFFs trugen 3 R- und 3 NIR-Hinweise; somit ergänzen die
beiden kanonisch benannten TIFFs in der Gesamtmessung
je einen R- und NIR-Hinweis. Diese Differenz ist **nur**
ein Vergleich der beiden aggregierten Messungen.

**Nicht nachgewiesen:** G-/RE-Dateien in diesem Prefix,
vier zusammengehörige R/NIR-Captures, M3M-Kameramodell,
M3M-DN-zu-Reflektanz-Kalibrierung, Bandregistrierung,
vollständige Bildpayload oder NDVI/NDRE-Bereitschaft.
Andere Prefixe des Buckets wurden weiterhin nicht
vollständig untersucht.

M3M-Multispektral-TIFFs können echte Pixelwerte und
Kalibrierinformationen enthalten. Laut DJI-Mavic-3M-FAQ
sind die gespeicherten Messwerte **DN**, nicht
fertige Reflektanzwerte; die vollständige Verarbeitung
benötigt u. a. Kalibrierung und Bandregistrierung.
Eine aus Metadaten abgelesene Bandbezeichnung ist
daher keine NDVI-Freigabe.



## Sichere Capture-Zuordnung: DJI-XMP-CaptureUUID als Gleichheitsmerkmal

Die offizielle DJI-Anleitung **Mavic 3M Image Processing Guide v1.0,
Seite 4 (2023)** dokumentiert **Capture UUID (UUID v4)** als
"Unique label for one capture". Gleiche Capture UUID über
verschiedene Spektralkanäle ist deshalb ein relevanter
**Aufnahmegruppen-Hinweis**, deutlich besser als ein bloßer
Ordner- oder TIFF-Dateiname. Die Verlässlichkeit der XMP-
Metadatenherkunft wird damit aber noch nicht verifiziert.

Quelle: https://dl.djicdn.com/downloads/DJI_Mavic_3_Enterprise/20230829/Mavic_3M_Image_Processing_Guide_EN.pdf

Der bereits erfolgreiche Pi-XMP-Volltest ergab **acht TIFFs
mit R=4 und NIR=4**, jedoch keine Information darüber, welche
TIFFs tatsächlich zur selben Aufnahme gehören.

Daher wurde ein **separater, optionaler** Test vorbereitet:

    cd ~/Projekte/SkyHub-Next || exit 1
    node --test \
      backend/test/m3m-xmp-capture-groups.test.js \
      backend/test/pi-m3m-xmp-markers.test.js
    node scripts/pi-m3m-xmp-markers-check.js --help

    # Nur mit Zustimmung zur begrenzten XMP-Leseoperation
    SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
      node scripts/pi-m3m-xmp-markers-check.js \
      --capture-groups-first-page

Dieser Prüfer verwendet denselben bereits laufenden Container,
dieselben bisherigen S3-Reader-Berechtigungen und pro direkter
TIFF-Datei höchstens **drei bestätigte Bytebereichs-Leseoperationen
mit zusammen 33.808 Bytes**. Die Grenzen sind **12 Dateien** und
der eine über die ersten 100 Bucket-Einträge erkannte Prefix.

Neue **in-Backend-only**-Logik:
- \`CaptureUUID\` und \`CaptureUuid\` nur als genau einmal vorhandene,
  strikt formatierte **UUID v4** akzeptieren. Uneindeutige
  oder anders formatierte Werte werden verworfen.
- Intern ausschließlich exakte UUID-Gleichheit der
  Bandhinweise G/R/RE/NIR berücksichtigen. Bandduplikate,
  unbekannte oder widersprüchliche Bandhinweise verhindern
  eine positive Capture-Gruppen-Klassifikation.
- Der Bericht enthält ausschließlich **Zähler**:
  \`uniqueCaptureUuidGroups\`,
  \`redNirCandidateGroups\`, \`fullFourBandHintGroups\`,
  \`groupsWithDuplicateBands\`,
  \`groupsWithUnresolvedBands\`,
  \`incompleteBandHintGroups\`,
  \`withCaptureUuid\` und \`withoutCaptureUuid\`.
- UUIDs, Aufnahmedaten, Namen, Kameraseriennummern, Bilder,
  GPS-Daten und individuelle Gruppenzuordnungen werden
  **niemals über die Containergrenze übertragen**.
  Der Elternprozess kontrolliert Report-Format,
  Summen und weiterhin ausgeschaltete Freigabeflags.

**Interpretationsgrenze:** Ein \`redNirCandidateGroups > 0\`
bestätigt lediglich zwei Bandhinweise mit gleicher **privat
verarbeiteter DJI-artiger Capture UUID**. Noch keine
Bandregistrierung, Pixelintegrität, radiometrische
Kalibrierung, präzise Georeferenzierung oder NDVI-Freigabe.
Ohne G und RE gibt es auch keinen vollständigen Vierband-Satz.

**Die reale Pi-Abnahme dieser zusätzlichen UUID-Gruppierung steht
noch aus.** Der vorausgegangene Acht-TIFF-Test wird nicht als
Gruppen- oder NDVI-Abnahme interpretiert.


## Sicherheitsnachprüfung vor realer Capture-UUID-Abnahme (23.10.2026)

Die DJI-Mavic-3M-Anleitung dokumentiert `Capture UUID` als
UUID-v4-Kennung einer Aufnahme (Mavic 3M Image Processing Guide,
Seite 4). In der aktuellen Implementierung werden nur eindeutige,
RFC-4122-kompatible UUID-v4-Werte aus dem bekannten
`drone-dji`-XMP-Namespace für den **internen Vergleich**
zugelassen. Die Kennungen bleiben ausschließlich im
Backend-Container und erscheinen nicht in den Aggregaten.

Der bisher reale Acht-TIFF-Test (`R=4`, `NIR=4`,
`G=RE=0`) **hat die Aufnahmezuordnung noch nicht geprüft**.
Der separate Test `--capture-groups-first-page` ist
genau dafür vorgesehen und bleibt in seiner Aussage auf
*XMP-basierte Kandidatengruppen* beschränkt.

Zusätzlicher Konsistenzschutz im Berichtsempfänger:
`redNirCandidateGroups` darf nicht größer als die einzelnen
R- und NIR-Zähler sein, `fullFourBandHintGroups`
nicht größer als G oder RE. Ferner kann die Zahl der
intern akzeptierten Capture-UUIDs nicht größer als die Zahl
erfolgreicher XMP-Auswertungen sein. Falsche Zähler werden
vor einer Terminalausgabe zurückgewiesen.

### Nächste reine Pi-Abnahme

    cd ~/Projekte/SkyHub-Next || exit 1
    test "$(git branch --show-current)" = \
      "feature/m3m-minio-integration-20261021" || exit 1
    test -z "$(git status --porcelain)" || exit 1
    git pull --ff-only origin feature/m3m-minio-integration-20261021 || exit 1
    node --test \
      backend/test/m3m-xmp-capture-groups.test.js \
      backend/test/pi-m3m-xmp-markers.test.js || exit 1

    SKYHUB_COMPOSE_DIR="$HOME/Projekte/SkyHub-Next" \
      node scripts/pi-m3m-xmp-markers-check.js \
      --capture-groups-first-page

Das letzte Kommando liest, wie beim bisherigen XMP-Test,
maximal 12 TIFFs aus einem eingeschränkten Prefix mit
höchstens 3 Range-GETs pro Objekt und zusammen maximal
33.808 angeforderten Bytes pro TIFF.
Es folgt kein Produktionsdeployment, keine Modifikation
der MinIO-Objekte und keine Drohnensteuerung.

**Wichtig:** Auch ein positiver Kandidat bedeutet nicht,
dass Bilder vollständig lesbar, geometrisch registriert,
radiometrisch kalibriert oder für NDVI/NDRE einsatzbereit sind.


## Repository-Umbenennung und PR-#24-Integrationsgates (23.10.2026)

**Kanonisches GitHub-Repository:** https://github.com/mason82-dotcom/SkyHub-Next

Die Umbenennung von `mason82-dotcom/SkyHub` nach `mason82-dotcom/SkyHub-Next`
betrifft die GitHub-Remote-URL, **nicht** das lokale Altprojekt
`~/Projekte/SkyHub`. Es darf weder mit dem aktiven Next-Checkout
`~/Projekte/SkyHub-Next` verwechselt noch unkontrolliert überschrieben werden.

Einmalige Remote-Prüfung nur im Next-Checkout:

```bash
cd ~/Projekte/SkyHub-Next || exit 1
git remote -v
git remote set-url origin https://github.com/mason82-dotcom/SkyHub-Next.git
git fetch origin
git status --short --branch
```

**Wichtig:** Die URLs allein sind kein Merge-/Deployment-Nachweis.
Für PR #24 müssen vor einer Freigabe alle folgenden Gates erfüllt sein:

1. Vollständig grüne GitHub-CI **für den aktuellen Head nach allen Änderungen**;
   eine frühere grüne CI gilt nicht für neue Test-/Quellcode-Commits.
2. Konfliktfreie Drei-Wege-Integration der aktuellen `main`-Änderungen
   (`backend/server.js`, M3M-Inventur, streng begrenzter
   `backend/m3m-s3-read-contract.js`, DJI-Feldkatalog und HTTP-Tests),
   ohne auf `main` eingeführte Sicherheitsprüfungen zurückzunehmen.
3. Überlappungen mit PR #19 (Storage/Migration) und #23 (Offline-Inventur)
   explizit bereinigen, ohne unbeabsichtigt Pi-Storage, IAM oder Credentials
   zu verändern. Historische Hardwarebeobachtungen nicht auf neue Branches
   oder Containerdeployments übertragen.
4. API-Authentisierung und nur lesende Medien-Endpunkte validieren; die
   S3-Inventur muss bei doppelten Schlüsseln und wiederholten Cursorn
   jeweils vollständig und ohne Teilreport abbrechen.
5. Der optionale `--capture-groups-first-page`-Hardwaretest benötigt eine
   separate ausdrückliche Ausführung am Pi. Ohne diesen Live-Nachweis
   keine Behauptung über UUID-basierte Aufnahmepaare. Auch positive
   Kandidatengruppen beweisen keine Radiometrie, Bandregistrierung,
   gültige Reflektanz oder NDVI-/NDRE-Bereitschaft.

**Status bei Dokumentationsergänzung:** Der PR ist noch Draft;
weder Merge noch weiterer Produktions-Rollout ist durch dieses Kapitel
autorisiert. Ein erneuter CI-Test und die Konfliktauflösung sind erforderlich.
