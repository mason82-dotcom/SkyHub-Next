# DJI WPML / KMZ – SkyHub Next (21.10.2026)

**Aktuelle Integrationsgrenze (24.10.2026):** [PR #89](https://github.com/mason82-dotcom/SkyHub-Next/pull/89) hat diese Offline-Module isoliert nach `main` integriert (Merge `1a2a01cf`). Historische Aussagen zu älteren Feature-Branches beschreiben die Entstehung, nicht die produktive Bereitstellung. Kein DJI-Missionsversand; siehe [Integrationsgates](wpml-main-integration.md).

## Offizielle Referenz (Cloud API 1.18)

- Overview: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/overview.html
- Template.kml: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/template-kml.html
- Waylines.wpml: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/waylines-wpml.html
- Common Elements: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/common-element.html
- Product Support: https://developer.dji.com/doc/cloud-api-tutorial/en/overview/product-support.html

DJI WPML ist ein DATEIFORMAT, keine Flugsteuerungs-API. Im KMZ-Archiv liegen
wpmz/template.kml (editierbare Vorlage), wpmz/waylines.wpml (ausführbarer
Flugweg) und optional wpmz/res/ (Ressourcen). Ein mapping3d-Template
generiert gewöhnlich fünf ausführbare Wayline-Folder. Eine Mappingvorlage
darf nicht mit einer fertig berechneten und flugfähigen Route verwechselt
werden.

## Integration im neuen Feature-Branch

- backend/wpml.js: Offline-XML-Parser ohne DTD oder externe Entitäten,
  strukturelle Prüfung von MissionConfig, Geschwindigkeiten, Höhensystemen,
  WPML-Enumwerten, Waypoints, Koordinaten, Ordner-IDs, Heading/POI,
  Kurven und ausgewählten Kameraaktionen.
- backend/wpml-product-support.js: DJI-Aircraft/Payload-Profile mit
  Mavic 3E/3T/3M, Matrice 4E/4T, M30/M30T, M3D/M3TD und M4D/M4TD.
  Controller-Codes gehören NICHT in droneEnumValue.
- backend/wpml-kmz.js: ZIP/KMZ-Import (Store/Deflate), sicherer ZIP-Parser
  mit CRC32-, Pfad-, Größen-, Duplikat-, ZIP64- und Symlink-Prüfung;
  Export bereits vollständiger WPML-Dokumentpaare unter wpmz/.
  Ressourcen werden nicht ausgeführt, entschlüsselt oder zurückgeliefert.
- scripts/wpml-inspect.js: Offline-Kommando zum Inspizieren und Verpacken.
- POST /api/wpml/inspect: Optionaler, authentifizierter Binärupload, liefert
  nur ein JSON-Prüfergebnis. Nur aktiv bei SKYHUB_WPML_INSPECT_ENABLED=true;
  standardmäßig inaktiv. HTTP 200 bei validierter Datei, 422 bei
  Fehlern, keine Rohdaten in generischen Archivfehlern.
- backend/test/wpml.test.js: Roundtrip-, Negativ- und Sicherheitsfälle.

### Lokale Nutzung

    node scripts/wpml-inspect.js mission.kmz
    node scripts/wpml-inspect.js --pack template.kml waylines.wpml out.kmz

Der zweite Befehl berechnet KEINEN Flugweg und überschreibt keine Datei.

## DJI Fluggerät-/Payload-Matrix

| Modell | droneEnumValue | droneSubEnumValue | payloadEnumValue |
| --- | ---: | ---: | ---: |
| Mavic 3E | 77 | 0 | 66 |
| Mavic 3T | 77 | 1 | 67 |
| Mavic 3M | 77 | 2 | 68 |
| Mavic 3TA | 77 | 3 | 129 |
| Matrice 4E | 99 | 0 | 88 |
| Matrice 4T | 99 | 1 | 89 |
| Matrice 30 | 67 | 0 | 52 |
| Matrice 30T | 67 | 1 | 53 |
| Matrice 3D | 91 | 0 | 80 |
| Matrice 3TD | 91 | 1 | 81 |
| Matrice 4D | 100 | 0 | 98 |
| Matrice 4TD | 100 | 1 | 99 |

Gilt für feste Hauptkamera am gimbalindex 0. Mavic 3M Typ 77/2 und Kamera
68 basieren auf der DJI-WPML-Tabelle, die allgemeinere aktuelle
Produkt-Support-Tabelle führt M3M teils nicht separat; Pilot-2-KMZ prüfen.

## Vollständiges Referenz-Feldinventar (Cloud-API-Doc)

Das zusätzliche Inventar `backend/data/dji-wpml-fields.json` bildet alle **250**
Feldzeilen der offiziellen englischen Markdown-Tabellen ab: 99 Zeilen aus
Template.kml, 22 aus Waylines.wpml, 129 aus Common Elements; insgesamt
160 unterschiedliche Elementnamen. Wiederholte Felder werden je Kontext
getrennt geführt. Für jede Zeile sind Elementname, Dokumentationskontext,
Typ, Einheit, Pflichtfeldklassifizierung, Quelldatei und Quellzeile hinterlegt.
Die exakten Versions-SHAs der DJI-Quelldateien stehen im JSON-Provenienzblock.
Eine Regressionstestdatei kontrolliert Inventarumfang, Dubletten und Zuordnung.

**Wichtig:** Die Aufnahme eines DJI-Feldes im Inventar bedeutet nicht,
dass dieses Feld im Validator bereits semantisch verarbeitet wird.
Die vollständige normative Implementierung von Spezialparametern ist offen.

## Feldabgleich: WPML-Unterseiten

| Bereich | Referenzfelder/Mechanismen | Code-Abdeckung |
| --- | --- | --- |
| Archiv | wpmz-Verzeichnis, XML-WPML-Namespace 1.0.2, ZIP/KMZ | Ein-/Auslesen, Grenzen |
| MissionConfig | flyToWaylineMode, finishAction, exitOnRCLost, executeRCLostAction, takeOffSecurityHeight, globalTransitionalSpeed | Pflicht-/Enum-/Werteprüfung |
| Produkte | droneInfo, payloadInfo, subtype, gimbalindex, autoRerouteInfo | Typ-/Payloadabgleich |
| Templates | waypoint, mapping2d, mapping3d, mappingStrip, templateId, waylineCoordinateSysParam | Teilvalidierung |
| Vermessung | Polygon, LinearRing, LineString, overlap, direction, shootType, smartOblique, mappingHeadingParam, imageFormat | Geometrie; Flugwegberechnung OFFEN |
| Waylines | Folder, waylineId, templateId, executeHeightMode, autoFlightSpeed, Placemark, executeHeight, waypointSpeed | Pflicht-/ID-/Werteprüfung |
| Kurven/Heading | Heading modes, POI, waypointTurnMode, dampingDist, useStraightLine | Teilvalidierung |
| Aktionen | actionGroup, startActionGroup, Ids, Trigger, reachPoint, multipleTiming, multipleDistance | Gruppen-/Teilparameterprüfung |
| Kameras | takePhoto, startRecord, stopRecord, focus, zoom, gimbalRotate, rotateYaw, hover, orientedShoot | Teilparameterprüfung |
| Spezial | accurateShoot, panoShot, searchlight, LiDAR/recordPointCloud, AI Spot-Check | Nicht vollständig geprüft |
| Höhen | WGS84, EGM96, relativeToStartPoint, AGL, realTimeFollowSurface | Enum-Prüfung; Umrechnung OFFEN |

## Folgeausbau: Mapping, Multispektral, LiDAR und KMZ-Härtung

Der erweiterte offline-Vorlagenvalidator `backend/wpml-mapping.js` prüft nun
folgende Felder entsprechend den Tabellen unter Template.kml und Common Elements:

- 2D-Mapping: `shootType`, `direction`, `margin`, Höhenpaare,
  `elevationOptimizeEnable`, Smart-Oblique-Flags, `mappingHeadingParam`,
  optionale feste Gimbal-Pitch-Winkel und Overlap-Prozente.
- 3D-Mapping: zusätzliche Schrägkamera-Parameter
  `inclinedGimbalPitch` und `inclinedFlightSpeed`. **Keine** automatische
  Ableitung der fünf Flugrouten aus einer Vermessungsfläche.
- MappingStrip: Korridorlänge, Seiten-Erweiterungen, Einzellinien-/Optimierungs-
  Flags sowie ungültige Boolean-/Zahlenkombinationen.
- `payloadParam`: Kamera-Linsen `visible` und `narrow_band` für Mavic 3M,
  LiDAR-Return-Mode, Samplingrate, Scanmodus und De-Warping.
- `recordPointCloud`: Offline-Aktionsprüfung für Start, Pause, Fortsetzen
  und Stopp. Es wird keine Kamera oder Punktwolkenaufnahme ausgelöst.
- Geometrie: abgelehnte entartete Polygone/Korridore (keine Wegberechnung).
- ZIP: CRC32-Verifikation **aller** Mitglieder einschließlich `res/`,
  Vergleich lokaler/zentraler Header und Verbot überlappender Member.

Relevante Regressionstests: `backend/test/wpml-mapping.test.js` sowie
`backend/test/wpml.test.js`. Die Container-CI lädt jetzt die WPML-Module
explizit bei einem isolierten Runtime-Smoke-Test.

Die Ergebnisse bleiben **offline, partiell semantisch validiert**. Auch eine
Datei ohne gemeldete Fehler wird nicht automatisch zur Flugfreigabe; die
DJI-Firmware kann zusätzliche Parameter und Produktschranken durchsetzen.

## Zusätzliche rein lokale Missionsprüfung im Editor (separater Draft-PR)

Die FlightHub-inspirierte Prüfübersicht für ungefähre 2D-Segmentlängen,
Höhen-/Koordinateneingaben, Einzelbild- gegenüber Intervalltriggern und
offene Prüfhinweise ist beschrieben in
[Offline-Missionsprüfung (nur Entwurf)](dji-wpml-draft-review.md).
Sie wird nur im gestapelten WPML-Entwicklungszweig implementiert; keine
FlightHub-2-Runtime, kein Hardware-/Flugbereitschaftsnachweis, kein Dispatch.
Der Hauptbranch erhält sie erst nach separatem PR-Merge.

## Lokaler grafischer Wegpunkteditor (nächster Ausbau)

Die statische Seite `/wpml-editor.html` ist über einen Link im
SkyHub-Dashboard erreichbar. Sie wird beim nächsten regulären Backend-Build
aus `frontend/public` ausgeliefert; es wurde **kein** Pi-Dienst aktualisiert.

- Karte mit Leaflet/OSM: Wegpunkte durch Kartenklick oder direkte Eingabe
  von Breitengrad/Längengrad setzen, Marker verschieben, Reihenfolge
  ändern, löschen und Route einpassen.
- Geräteprofile: Mavic 3E/3T/3M, Matrice 4E/4T. Unterstützt vorerst
  geradlinige Wegpunktreihenfolge, optionale einzelne `takePhoto`-Aktionen
  und `relativeToStartPoint`-Höhen (einheitlich oder individuell mit
  ausdrücklich eingegebener WGS84-Ellipsoidhöhe je Wegpunkt).
- Name, globaler Fluggeschwindigkeitswert, Höhe über dem **Startpunkt**,
  Sicherheitssteighöhe und Aktion nach Missionsende sind im Formular
  einstellbar. Standardmäßig gilt eine **einheitliche relative Höhe**;
  ein ausdrücklich aktivierter Expertenmodus ermöglicht unterschiedliche
  relative Höhen **nur** mit eigenständig bekannten WGS84-Ellipsoidhöhen
  für alle Punkte. Das Tool erfindet keine EGM96-/WGS84-Konversion.
- Der Browser erzeugt mit `frontend/public/wpml-editor-core.js` ohne
  Upload und ohne Serverzugriff `wpmz/template.kml` und
  `wpmz/waylines.wpml` in einem standardkonformen *Stored ZIP* (KMZ).
  Die erzeugten XML-Dokumente werden in Backend-Tests durch den
  unabhängigen WPML-Validator und KMZ-Reader geprüft.
- Bei verfügbarer Internetverbindung bezieht die Leaflet-Karte
  Kacheln von OpenStreetMap. Das Dateiformat und der Export
  funktionieren auch ohne Kacheldienst über manuelle Koordinaten.
- **Keinerlei Flugsteuerung:** kein Pilot-Bootstrap, keine MQTT-Publishes,
  keine Wayline-Cloud-Upload-API, kein Datenbankschreibzugriff.
  `flightReady=false` gilt auch für erfolgreich erzeugte Dateien.
  Eine DJI-Pilot-2-Importprüfung mit genau der verwendeten Firmware ist
  vor jeder Verwendung weiterhin erforderlich.

### Reproduzierbarer CLI-Export (ohne Browser)

    node scripts/wpml-plan.js docs/examples/wpml-waypoint-plan.json /tmp/waypoint-draft.kmz
    node scripts/wpml-inspect.js /tmp/waypoint-draft.kmz

Die JSON-Datei enthält ausschließlich synthetische Testpunkte. Vorhandene
Zieldateien werden **nicht** überschrieben; der CLI-Export prüft das
generierte KMZ erneut mit dem unabhängigen Backend-Validator. Die CLI
öffnet keine Netzwerkverbindung und aktiviert keine Missionsroute.
`backend/test/wpml-editor.test.js` prüft Roundtrips mit allen fünf
Geräteprofilen, XML-Escaping, Eingabegrenzen und den CLI-Schreibschutz.

**Nicht enthalten:** Mapping2D/3D aus Polygonen zu Waylines berechnen,
AGL/Terrain- und Geoid-Höhenumrechnung, M3M-Kameraspezialfunktionen,
geprüfte Geschwindigkeits-/Kollisionsprofile oder eine Zusicherung der
Pilot-2-Importierbarkeit.


## Neue 2D-Vermessungsvorschau (kein WPML-Wayline-Export)

Unter `/wpml-survey-preview.html` kann eine kleine Vermessungsfläche
gezeichnet oder als Koordinatenpolygon eingegeben werden. Die rein lokale
JavaScript-Berechnung `wpml-survey-preview-core.js` ermittelt parallele
Streifen anhand von Richtung und Streifenabstand, schneidet sie an der
Polygonkontur ab und zeigt einzelne voneinander getrennte Segmente. Eine
Approximation der Gesamtstreckenlänge **innerhalb der Fläche** wird
angezeigt. Außerdem ist ausschließlich ein geometrischer GeoJSON-Export
möglich, **kein** DJI-KMZ/waylines.wpml-Export aus diesem Modus.

Strikte Grenzen: 3 bis 80 Eckpunkte, weniger als 2 km Ausdehnung,
Breitengrad zwischen -85° und +85°, Abstand 2–200 m, keine
selbstschneidenden oder degenerierten Polygone, höchstens 200
Scanstreifen und 400 Liniensegmente. Für die Vorschau wird eine lokale
equirektanguläre Projektion verwendet – keine vermessungstechnische oder
geodätische Missionstransformation. Konkave Flächen können mehrere
gesonderte Linien pro Streifen erzeugen; die Vorschau verbindet
keine getrennten Segmente durch erfundene Wendeflüge.

Die Vorschau berücksichtigt **weder** GSD/FOV/Kameraparameter noch
Überlappungsanforderungen, Hindernisse, Terrain, Geofencing, Luftraum,
Flugleistungsgrenzen, Stromverbrauch, die erforderlichen Wendemanöver
oder DJI-Pilot-2-Kompatibilität. Sie darf nicht mit einer DJI-Pilot-2-
Mapping-Mission gleichgesetzt werden. `flightReady:false` und
`exportableAsWaylines:false` werden in jedem Ergebnis mitgeliefert.

`backend/test/wpml-survey-preview.test.js` sichert geometrische Grenzfälle,
Selbstschnitt-/Konkavitätstests und die Trennung vom Missionsversand.
Der Expertenmodus für individuelle Wegpunkthöhen wird in
`backend/test/wpml-editor.test.js` mit dem unabhängigen KMZ-Validator
geprüft; WGS84-Ellipsoidhöhen werden **nie** automatisch ergänzt.

## Optikgestützte 2D-Fotogrammetrie-Schätzung (kein DJI-Wayline-Export)

Ein optionaler Expertenmodus in `/wpml-survey-preview.html` verwendet die
**vom Anwender vollständig und ausdrücklich angegebenen** physikalischen
Kameradaten: Sensorbreite/-höhe in mm, tatsächliche Brennweite (kein
Kleinbildäquivalent), Pixelanzahl je Achse, reale AGL-Höhe, Seiten- und
Längsüberlappung sowie angenommene Geschwindigkeit.

Für senkrecht nach unten ausgerichtete Kamera, flache Geländeoberfläche und
konstante AGL-Höhe nutzt `frontend/public/wpml-photogrammetry-core.js`
vereinfachte Lochkamera-Geometrie:

- Quer-Footprint = `H_AGL × Sensorbreite / Brennweite`
- Längs-Footprint = `H_AGL × Sensorhöhe / Brennweite`
- Quer-GSD = `Quer-Footprint / Bildbreite_px` (m/Pixel)
- Längs-GSD = `Längs-Footprint / Bildhöhe_px` (m/Pixel)
- Streifenabstand = `Quer-Footprint × (1 − Seitenüberlappung/100)`
- Aufnahmeabstand = `Längs-Footprint × (1 − Längsüberlappung/100)`
- Theoretisches Intervall = `Aufnahmeabstand / konstante Geschwindigkeit`

Der Streifenabstand speist lediglich den vorhandenen geometrischen
Survey-Vorschauberechner. Aufnahmen werden pro getrenntem Liniensegment
**endpunktinklusiv überschlägig gezählt**, keine Auslösepunkte oder
Kameraaktionen erzeugt. Ein vom Anwender ausdrücklich mitgeteiltes
minimales Kameraaufnahmeintervall wird gegen das theoretische Intervall
geprüft; unbekannte Fähigkeiten werden als unbekannt ausgewiesen. Die
Eingabe ist auf sinnvolle Zahlenbereiche begrenzt und schließt zu enge
Streifen, unrealistisch kurze Fotoabstände und mehr als 50.000 geschätzte
Bilder aus.

**Nicht berücksichtigt:** Linsenverzeichnung, Tilt/Yaw, Multispektral-
Einzelbandunterschiede, rolling shutter, reale Geländeoberfläche,
Photogrammetriequalität, Flugtrajektorien, Start-/Wende-/Transitwege,
Hindernisse, RTK und Mission-Firmware. Insbesondere werden keine
unbestätigten DJI-Mavic-3M- oder Matrice-4T-Kamerapresets hinterlegt.
`calibratedFromDevice:false`, `flightReady:false` und
`exportableAsWaylines:false` stehen ausdrücklich im Ergebnis.
Der GeoJSON-Export bleibt eine **rein geometrische Vorschau**.

Unit- und Negativtests: `backend/test/wpml-photogrammetry.test.js`.
Die Datei wird nicht zum Flug beauftragt und nicht als DJI-Wayline-KMZ
exportiert. Für verlässlich nutzbare 2D-Mapping-Missionen sind
validierte Sensorprofile, Geländemodell und DJI-Pilot-2-Vergleichstests
weiter erforderlich.

## Geometrische Fotopositionen: Punktvorschau, kein DJI-Trigger

Das neue browser-/Node-kompatible Modul
`frontend/public/wpml-capture-preview-core.js` baut auf bereits
geprüften Streifenpolygonen und den ausdrücklich eingegebenen Kamera-
/AGL-Daten auf. Für jedes **unabhängige gerade Streifensegment** wird
eine theoretische Folge gleichmäßig verteilter Foto-Mittelpunkte erzeugt.
Die Anzahl pro Segment wird konservativ als
`ceil(Segmentlänge / Zielabstand) + 1` gewählt. Dadurch sind
**beide Segment-Endpunkte** enthalten und der nominale Abstand
zwischen den berechneten Mittelpunkten überschreitet im
vereinfachten lokalen Modell den Zielabstand nicht.

Die Karte kann diese **theoretischen Fotopunkte** über der geometrischen
2D-Vorschau anzeigen. Die Grafik ist ausdrücklich **keine von der
Kamera bestätigte tatsächliche Belichtung**. Gerade bei konkaven
Polygonen werden voneinander getrennte Liniensegmente weiterhin
separat behandelt; SkyHub erfindet keine verbindenden Wendeflüge.

Für Performance und Missbrauchsschutz werden maximal **2.000
Fotopunkte** gerendert. Falls die Gesamtschätzung darüber liegt,
zeigt SkyHub nur den Anfang und das Ende jedes Segments (bei maximal
400 Segmenten also höchstens 800 markierte Punkte) und bezeichnet
dies explizit als **Teilmenge**. Die vollständige rechnerische
Bildanzahl wird separat angezeigt. Der lokale GeoJSON-Export trägt
`sampleOnly`, `estimatedImageCount` sowie
`exportableAsWaylines:false` und `flightReady:false`.

**DJI-Referenz:** `wpml:actionTriggerType=multipleDistance` in
`40.common-element.md` ist ein periodischer Distanz-Auslöser und
`wpml:actionTriggerParam` hat dabei die Einheit Meter;
`multipleTiming` verwendet Sekunden. Diese DJI-Aktionen werden
**noch nicht generiert**, weil ihre Interaktion mit Wendemanövern,
Segmentgrenzen und Pilot-2-Missionsprofilen erst anhand realer
Exporte verifiziert werden muss.

Grenzen der Fotopunktvorschau: keine Richtungsänderungs-/Roll-
oder Schwenkaufnahme, keine Auslöseverzögerung, kein Gelände-
oder GSD-Variationsmodell, kein vollständiger Kamerabetriebsmodus
(auch nicht für einzelne Mavic-3M-Multispektralkanäle), keine
DJI-Flugfähigkeit. Regressionstests:
`backend/test/wpml-capture-preview.test.js`.

## DJI WPML `multipleDistance` / `multipleTiming` (experimenteller Offline-Export)

DJI definiert in `40.common-element.md` zwei periodische
`wpml:actionTriggerType`-Auslöser:
`multipleDistance` (Meter zwischen Auslösungen) und
`multipleTiming` (Sekunden zwischen Auslösungen), wobei
`wpml:actionTriggerParam` den jeweiligen Abstand trägt.
Mit einer `takePhoto`-Aktion ist so periodisches Fotografieren
während einer Wayline grundsätzlich beschrieben.

`frontend/public/wpml-interval-actions.js` generiert daraus
**offline** und ohne Gerätezugriff ein XML-`wpml:actionGroup`-Fragment
mit `sequence`, `takePhoto` und Payload-Index 0.
Der Wegpunkteditor und der JSON-basierte CLI-Missionsentwurf können
diese Fragmente optional im generierten `waylines.wpml` verwenden.
Die Gruppe gilt im aktuellen Entwurf von Wegpunkt 0 bis zum letzten
Wegpunkt. Einzelbilder mit `reachPoint` und periodische
Aufnahmen schließen sich hier explizit aus, damit keine
konkurrierenden Fotoaktionen entstehen.

Die Grenzen sind vorsichtig gewählt: 1–1.000 m Distanz oder 1–60 s
Zeitabstand. Falls die Kamera-Mindestaufnahmezeit vom Anwender
angegeben ist, wird ein theoretisch zu kurzes Aufnahmeintervall
abgewiesen. Ohne diese Hersteller-/Firmwareangabe bleibt die
Kamera- und Gerätekompatibilität **ungeprüft**. Eine variable
Fluggeschwindigkeit, Zwischenstopps und komplexe Wendemanöver
können die tatsächlichen Zeiten und Positionen abweichend gestalten.

`backend/wpml.js` prüft nun zusätzlich doppelte
Aktionsgruppen-IDs im gesamten `waylines.wpml` sowie
ungültige Reihenfolge der Aktionsbereichs-Indizes. Ein Start-/Endindex
am selben Wegpunkt bleibt gemäß DJI-Felddefinition zulässig; dies
bestätigt nicht, dass eine periodische Aktion an einem solchen Einzelpunkt
sinnvoll ausgeführt wird. Die gemeinsamen DJI-IDs in
Template und Waylines sind nicht automatisch als globaler
ID-Konflikt anzusehen; der neue Test bezieht sich auf
Aktionsgruppen im ausführbaren Dokument.

**Wichtig:** Der erzeugte KMZ-Entwurf hat weiter
`flightReady:false`. Die semantisch prüfbare
Aktionsgruppe beweist nicht, dass DJI Pilot 2 diese Datei auf
Mavic 3M/3E/3T oder Matrice 4T übernimmt. Ebenso sind
Abstands-Zähler, Start-/Endpunkt-Auslösung,
Aufnahmestopps und Multispektral-Linsenkonfiguration
noch nicht an realer Hardware abgeglichen. Keine
Missionsdispatch-Route oder DJI-MQTT-Kommandos wurden aktiviert.

Tests: `backend/test/wpml-interval-actions.test.js`.

Beispiel eines **synthetischen, nicht hardwaregeprüften**
Distanzaufnahme-Entwurfs:

    node scripts/wpml-plan.js docs/examples/wpml-interval-photo-plan.json /tmp/interval-photo-draft.kmz
    node scripts/wpml-inspect.js /tmp/interval-photo-draft.kmz

Die erste Zeile schreibt die KMZ-Datei nur, wenn der lokale
strukturell/semantische Validator keine Fehler findet. Ein
ausdrücklich unbekanntes Kamera-Mindestintervall wird nicht automatisch
als verifiziert betrachtet. Der Dateiexport ersetzt **keinen**
Import- und Verhaltensversuch mit DJI Pilot 2/RC Pro Enterprise.


## Offline-Vergleich mit DJI-Pilot-2-KMZ (Vorbereitung der Hardwareabnahme)

Ein neuer **rein lesender** Vergleichsbefehl kann eine echte, lokal gespeicherte
DJI-Pilot-2-KMZ mit einem SkyHub-Entwurf vergleichen, ohne Dateien zu ändern
oder auf einen DJI-Controller zuzugreifen:

    node scripts/wpml-compare.js /pfad/pilot2-export.kmz /pfad/skyhub-entwurf.kmz

Der neue Backend-Baustein `backend/wpml-compare.js` benutzt ausschließlich
den vorhandenen, größenbegrenzten KMZ-/ZIP-Parser und den XML-Validator.
Geprüft werden `wpmz/template.kml`, `wpmz/waylines.wpml`,
Drohnen-/Payload-Profil, Wayline- und Wegpunktanzahl, XML-Struktur,
Flugparameter und vorhandene `actionGroup`-/Auslöser-Strukturen.

**Datenschutz:** Standardmäßig gibt die CLI nur die betroffenen XML-Feldpfade,
Änderungsarten und aggregierte Kennzahlen aus. Werte, GPS-Koordinaten,
Missionsnamen, Ersteller, Zeitstempel, Ressourcendateinamen und Rohdaten werden
**nicht** ausgegeben. Missionstitel, Ersteller und Zeitstempel werden bei
der Strukturvergleichbarkeit ignoriert. Die ZIP-CRC32-Prüfung läuft
für jedes Mitglied einschließlich Ressourcen. Ressourcen werden nicht
extrahiert; ihre **Anzahl** wird getrennt verglichen, nicht ihr Inhalt.

Rückgabecodes: `0` für keine erkannten strukturellen Abweichungen bei
beiden offline-validierten KMZ-Dateien, `1` für erkannte Unterschiede,
`2` für nicht offline-valide KMZ-Dateien oder Abbruch. Die Prüfroutine
markiert jedes Ergebnis mit `pilot2HardwareVerified:false` und
`flightReady:false` – ein struktureller Gleichstand ist keine
Pilot-2-Import- oder Flugfreigabe. Exakte Flugwegparameter können auch
bei unterschiedlichen textuellen Darstellungen gleiche Bedeutung haben;
dieser Vergleich ist **kein** vollständiger semantischer Äquivalenzbeweis.

**Prüfablauf ohne Flugbetrieb:** Eine KMZ auf der RC Pro Enterprise mit DJI
Pilot 2 erstellen/exportieren, die KMZ-Datei kontrolliert lokal bereitstellen,
SkyHub-Entwurf mit identischem Gerät und Missionstyp erzeugen und die beiden
Dateien mit obigem Kommando offline vergleichen. Für den nächsten Schritt
benötigt SkyHub noch echte, sicher anonymisierte Pilot-2-Dateien und einen
zugehörigen dokumentierten Import-/Export-Versuchsbericht. Bis dahin sind
geprüfte DJI-Importierbarkeit, Multispektralsensorverhalten und
periodische Kameraauslösung **nicht** bestätigt.

Tests: `backend/test/wpml-compare.test.js` (identische KMZ, Metadaten,
Fotoaktionsabweichungen, Koordinaten-Redaktion, Grenzfälle und CLI-Schutz).

## Betriebsschutz und Grenzen

Keine Flugbefehlserzeugung, kein MQTT-Publish, keine Kopplung an den
Missionsversand, keine Datenbankmigration, keine Speicherung von Uploads,
keine Aktivierung der Missionsroute. POST /api/mission/create antwortet
weiterhin mit HTTP 501. Der Pi und seine Docker-Dienste bleiben unberührt.

Dies ist ausdrücklich ein ERSTER offline-fähiger WPML-Kern und **keine
vollständige DJI-1.18-Zertifizierung**. Noch offen sind die komplette
verschachtelte Feldvalidierung, produktionsreife visuelle Missionsplanung,
vollständige Vermessungs-/Oblique-Planungsalgorithmen, Geoid-/AGL-Umrechnung,
Terrain Follow, DJI-Wayline-Upload/Download, Medien-/res-Verwaltung,
Missionsstatus samt Gerätebestätigung und Firmware-spezifische Tests.

Nächste Abnahme: mit DJI Pilot 2 exportierte, anonymisierte KMZ-Files für
Mavic 3E, Mavic 3T, Mavic 3M und Matrice 4T einlesen und einzeln
gegen das DJI-Importverhalten prüfen. Besonderheit M3M:
visible-/narrow_band-Linsen, Multispektral-Metadaten und Kameraaktionen
müssen an echten Pilot-2-Exporten getestet werden. Erst danach UI/Dispatch.

## Ergänzende Referenz: motecshine/dji-waylines-sdk

Das Go-SDK ist als **Vergleichsreferenz** und über einen **separaten, strikt geprüften lokalen Waylines-JSON-Import** mit dem bestehenden SkyHub-Editor verknüpft. Es ersetzt weder SkyHubs WPML-Kern noch die DJI-WPML-Dokumentation. Besonders die unvollständige Upstream-Subtyp-Zuordnung und die abweichenden RC-Loss-Defaults verbieten eine Gleichsetzung der generierten Flugmissionen.

Details, erlaubte Felder/Profile, Sicherheitsgrenzen und Tests: [dji-waylines-sdk-reference.md](dji-waylines-sdk-reference.md). Der lokale Waylines-JSON-Import ist seit dem Merge von PR #89 als **Offline-Entwicklungsfunktion in `main`** enthalten; er ist nicht mit dem DJI-Missionsversand verbunden. `flightReady:false` bleibt unverändert.
