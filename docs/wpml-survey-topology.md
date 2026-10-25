# WPML Survey: begrenzte Geometrie mit Aussparungen (Offline)

Stand: 23.10.2026. Weiterentwicklung des nach main integrierten WPML-PR #89.

## Umfang

Die unverbindliche `/wpml-survey-preview.html` akzeptiert weiterhin manuell
gezeichnete einfache Polygone. Zusätzlich lassen sich **lokale** GeoJSON-Dateien
mit einer **Geometry** vom Typ `Polygon` (Außenring plus Löcher) oder
`MultiPolygon` (getrennte Teilflächen) importieren. GeoJSON
`FeatureCollection`, `GeometryCollection` und GeoJSON mit dritten
Koordinaten (Höhenwerten) werden bewusst abgelehnt.

Das mathematische Modell projiziert alle Komponenten in eine gemeinsame,
lokale equirektanguläre Näherung. Einzelne Streifen werden an allen
Polygonringen geschnitten. Bei gültiger Verschachtelung entfernen Löcher
Ausschnitte aus Aufnahmeabschnitten. Getrennte Teilflächen erzeugen
getrennte Coverage-Segmente. Die Funktion erstellt **keine** Übergangsroute.

Zwischen benachbarten Coverage-Segmenten gibt `unplannedTransitions`
ausschließlich Endpunkte und **direkte geometrische Abstände** zurück.
Diese Lücken können Aussparungen, Hindernisse oder Verbotszonen queren.
Sie sind im UI rot gestrichelt markiert und im GeoJSON-Export ausdrücklich
als `unplanned-direct-gaps-NOT-safe-flight-paths` gekennzeichnet.
Die Fotopunkt-Schätzung berücksichtigt **nur** Coverage-Segmente,
keine Übergänge und keine Wendemanöver.

## Validierungsgrenzen

- 1–4 getrennte Teilflächen, 1–8 Ringe pro Fläche, höchstens 160
  Eingabe-Koordinaten und maximal 80 Punkte pro Ring.
- Gesamtausdehnung maximal 2 km in jeder lokalen Projektionsebene,
  Breitengrad maximal +/-85 Grad und maximal 400 Coverage-Segmente.
- Je Ring mindestens 10 m² nicht degenerierte Fläche, je Teilfläche
  mindestens 10 m² freie Fläche.
- Keine sich kreuzenden oder berührenden Ringkanten, keine Löcher außerhalb
  des Außenrings, keine überlappenden oder verschachtelten Löcher und
  keine verschachtelten/berührenden Teilflächen.
- Datumsgrenze, sehr große Flächen, Inseln in Löchern und andere
  aufwendige Polygon-Topologien werden konservativ abgelehnt.
- Die Browserdatei wird mit 64 KiB begrenzt. Der Import liest lokal
  `File.text()`; die GeoJSON-Daten werden **nicht** an den Server übertragen.
  Hintergrundkarten von OpenStreetMap benötigen jedoch separate Netzwerkanfragen.

## Sicherheits- und Einsatzgrenze

`flightReady:false`, `exportableAsWaylines:false`,
`validationScope:'approximate-2d-geometry-preview'`.
Keine automatische Höhen-/Gelände-, Kollisions-, Geofence-, Kamera- oder
Pilot-2-Prüfung. Kein Missionsauftrag, keine KMZ-Erzeugung aus dieser
Vorschau, kein Drone-/MQTT-/REST-Schreibzugriff. Auch ein erfolgreicher
Geometrie- und CI-Test stellt keine Flugfreigabe dar.

## Prüfen

```bash
node --test backend/test/wpml-survey-preview.test.js backend/test/wpml-survey-topology.test.js backend/test/wpml-photogrammetry.test.js backend/test/wpml-capture-preview.test.js
```

Synthetische Tests decken das bisherige Legacy-Eingabeformat, konkave
Polygone, Exklusionsringe, getrennte Flächen, unzulässige Ringtopologien
und nicht fliegbare Transitionen ab. Für reale Einsatzfähigkeit fehlen
weiterhin Pilot-2-Hardwaretests mit Mavic 3M und Matrice 4T sowie geprüfte
Terrain-, Geofence- und Transfer-Routenplanung.

**Externe Referenz:** YLabs-FPV/YMapper wurde als Architektur-/Fehlerreferenz
untersucht. Es wurde **kein YMapper-Quellcode** übernommen.
