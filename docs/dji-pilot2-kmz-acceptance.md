# DJI Pilot 2 ↔ SkyHub WPML: kontrollierte Offline-Abnahme

Stand: 21.10.2026. Gilt für den Entwicklungsbranch
`feature/dji-wpml-offline-20261021`.
**Keine Flugfreigabe und kein produktives SkyHub-Deployment.**

## Zweck

Vergleiche eine **tatsächlich aus DJI Pilot 2 exportierte KMZ-Datei**
mit einem lokal erzeugten SkyHub-KMZ-Entwurf desselben Geräteprofils
und Missionstyps. Der Vergleich ist read-only und arbeitet vollständig
ohne Internet, MQTT, DJI-Cloud-API oder Flugsteuerung.

Dies ist zunächst eine **Struktur- und Feldanalyse**, keine
Flugkompatibilitätszertifizierung.

## Vorbereitung auf RC Pro Enterprise / Mavic 3M

1. Notiere die DJI-Pilot-2-Version, Drohnen- und Controller-Firmware und
   das Gerätemodell, aber **keine Seriennummern**. Halte Controller und
   Fluggerät zunächst in einem Zustand, in dem kein Flug oder Upload
   beauftragt werden kann.
2. Erstelle oder verwende in Pilot 2 einen rein lokalen gespeicherten
   Wegpunktplan mit mindestens zwei Punkten. **Nicht ausführen, nicht
   starten und nicht automatisch in eine Cloud übertragen.**
3. Exportiere die KMZ-Datei lokal. Stelle sicher, dass sie aus Pilot 2
   stammt und nicht aus dem SkyHub-Generator. Kopiere sie über
   kontrollierten lokalen Datentransfer auf einen privaten Testrechner
   oder den Pi (nicht in ein öffentliches Web-Verzeichnis).
4. Erstelle einen SkyHub-Entwurf mit demselben DJI-Geräteprofil sowie
   soweit möglich denselben Missionseinstellungen. Verwende keine
   Produktionsmission, keine sensitiven Koordinaten als Beispiel im
   GitHub-Repository und keine persönlich identifizierenden Namen.

## Tests (auf lokalem Checkout des Entwicklungsbranches)

    # Das SEPARATE Test-Clone verwenden, niemals das produktive Pi-Verzeichnis
    cd ~/Projekte/SkyHub-WPML-Test

    # Nur lokale Testdaten: kein MQTT, keine Cloud-API, keine DJI-Aktion
    node scripts/wpml-plan.js \
      docs/examples/wpml-waypoint-plan.json \
      /tmp/skyhub-offline-waypoint-draft.kmz

    # Hierbei bleibt die originale Pilot-2-KMZ unverändert
    node scripts/wpml-compare.js \
      /privater/pfad/pilot2-original.kmz \
      /tmp/skyhub-offline-waypoint-draft.kmz

    # Kürzere Abnahmeansicht für Kameras, Aktionen, Höhen und Payload
    node scripts/wpml-compare.js --review \
      /privater/pfad/pilot2-original.kmz \
      /tmp/skyhub-offline-waypoint-draft.kmz

Die Beispiel-KMZ nutzt **synthetische GPS-Koordinaten**. Für einen
sachlichen Feldvergleich müssen später beide Missionen in ihren
Einstellungen möglichst weit übereinstimmen; andernfalls sind
Unterschiede in Wegpunkten und Höhen zu erwarten.

**Achtung:** `--review` filtert **ausschließlich die Anzeige** auf
`actions`, `cameraFormats`, `heightReferences`, `payload` und
`mission`. Auch hier zählen alle anderen, ausgeblendeten Unterschiede
für den Rückgabecode. Für eine lückenlose Prüfung stets die
**ungefilterte JSON-Ausgabe** zusätzlich verwenden.

Rückgabecodes: `0` = keine erkannten strukturellen Abweichungen
bei zwei offline-validen Dokumenten; `1` = Unterschiede;
`2` = Fehler beim Einlesen oder mindestens ein Dokument
offline nicht valide.

Das JSON trennt jetzt `leftOnlyFieldOccurrences` (nur im linken Export),
`rightOnlyFieldOccurrences` (nur in der rechten SkyHub-Datei) und
`changedValueOccurrences` (auf beiden Seiten vorhanden, aber unterschiedlich).
Die Abschnitte `documents[].patterns` bündeln Wiederholungen wie
`Placemark[0]`, `Placemark[1]` zu `Placemark[*]`.
So lassen sich WPML-/Payload-/Kameraaktionslücken von bloßen Unterschieden
der Wegpunktkoordinaten unterscheiden. `leftOnly`/ `rightOnly`
ist dabei die Richtung im **Vergleichsaufruf**, keine Aussage über
erforderliche DJI-Felder. Unterschiedliche Anzahl/Reihenfolge
wiederholter Wegpunkte kann ebenfalls Feldpfaddifferenzen auslösen.

Die neu hinzugefügten `left.cameraActionSummary` und
`right.cameraActionSummary` zählen die tatsächlichen WPML-`actionGroup`-
Vorkommen sowie die darin verwendeten Aktionstypen. So lässt sich direkt
unterscheiden, ob ein Entwurf z. B. **zwei `reachPoint`-`takePhoto`-Aktionen**
oder **eine `multipleDistance`-Aktionsgruppe** enthält. Zähler für
`periodicDistancePhotoActions` und `periodicTimePhotoActions` meinen
**Konfigurationen der Auslösung, nicht tatsächlich ausgelöste Einzelbilder**.
Die genaue Fotoanzahl, reale Abstände, Firmwareunterstützung und
Gerätekompatibilität sind nicht bestätigt; es werden keine XML-Rohwerte
oder realen Koordinaten ausgegeben.

`summary.cameraActionSummariesDiffer` zeigt an, ob sich die kompakten
Aktionsübersichten unterscheiden, unabhängig von der Anzahl der einzelnen
XML-Feldabweichungen.


Das JSON zeigt keine Feldwerte, keine GPS-Koordinaten, keine
Missionsnamen und keine Rohinhalte eingebetteter Ressourcen. Auch
unbekannte XML-Feld- und Attributnamen werden maskiert. Die
Ausgabe darf dennoch nur nach Prüfung geteilt werden, weil sie
Aufbau/Größe/Typen der Mission offenlegen kann. Die **Original-KMZ
nicht hochladen oder in einem öffentlichen GitHub-Issue anhängen.**

## Abnahmeprotokoll

| Prüfpunkt | Eintrag |
| --- | --- |
| DJI-Fluggerät | Mavic 3M / Mavic 3E / Mavic 3T / Matrice 4T / anderes |
| DJI Pilot 2-Version | Ohne persönliche Identifikatoren |
| Fluggerät-/Controller-Firmware | Nur Versionsnummern |
| Exportquelle | DJI Pilot 2 / SkyHub / unbekannt |
| KMZ-Version und Vorlagenart | waypoint / mapping2d / mapping3d / mappingStrip |
| Unterschied in Fluggeräte-/Payload-Kennung | Ja / Nein / nicht ermittelbar |
| Unterschied in Wayline-Anzahl | Ja / Nein / nicht ermittelbar |
| Unterschied in Wegpunktanzahl | Ja / Nein / nicht ermittelbar |
| Unterschied bei Kamera-Aktionsgruppen | Ja / Nein / nicht ermittelbar |
| Mehrfachauslösung nach Strecke/Zeit | Nicht getestet / nur Dateistruktur / Pilot 2 Import |
| Unterschied bei Höhenreferenzen | Ja / Nein / nicht ermittelbar |
| Validatorfehler oder undokumentierte WPML-Felder | Anzahl und Feldpfade, keine Werte |
| Ergebnis | Reiner Strukturvergleich, **keine Flugfreigabe** |

### Besondere Mavic-3M-Fragen

- Sind sichtbare RGB-Bilder und die einzelnen Multispektralbänder
  separat und korrekt durch DJI-Kameraformatfelder repräsentiert?
- Unterscheidet Pilot 2 zwischen `visible` und
  `narrow_band` beziehungsweise `payloadLensIndex`?
- Sind feste/relative und WGS84-Ellipsoidhöhen nach identischem
  Bezugssystem erzeugt worden? **Niemals** durch Annahmen ersetzen.
- Enthält Pilot 2 anders gruppierte `takePhoto`-,
  `multipleDistance`- oder `multipleTiming`-
  Aktionen? Die Struktur ist für die Pilot-2-Abnahme zu
  dokumentieren; keine automatische Kameraauslösung bei diesem Test.

## Interpretation

Das Vergleichswerkzeug kann eine **abweichende XML-Feldstruktur**
nachweisen. Ein Ergebnis ohne Unterschied besagt **nicht**, dass
DJI Pilot 2 die KMZ korrekt importiert oder das Gerät sie sicher
ausführt. Das Ausführen einer realen Mission, das Bestätigen von
Sensordaten und das Bewerten von Flugrisiken sind eigenständige
Abnahmestufen, die hier **nicht** stattfinden.

Unbekannte/future DJI-WPML-Felder können vom SkyHub-Validator
abgelehnt werden. Dies muss als mögliche
**Abdeckungslücke** untersucht werden, nicht als Beleg, dass Pilot 2
eine ungültige Datei exportiert hat.
