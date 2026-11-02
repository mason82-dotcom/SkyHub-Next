# M3M-Captures: eindeutige Bänder und Metadatenbewertung v3

## Zweck und Status

Die Capture-API liest Objektlisten und TIFF-Header aus MinIO. Sie liefert eine
Inventur und eine konservative Metadatenprüfung, keine wissenschaftliche oder
operative Freigabe. Änderungen an dieser Bewertung erfordern kein S3-Schreiben,
keine DJI-Kommandos und keine Änderung der HTTP-/LAN-Zugriffsregeln.

Die Pfade bleiben `GET /api/smart-farming/captures` und
`GET /api/smart-farming/captures/manifest`. Die Medien-API muss aktiviert sein;
das separate Katalog-Opt-in schützt diese Capture-Pfade nicht. Im freigegebenen
LAN werden weiterhin UUIDs, GPS, Zeiten und Objektverweise ausgegeben.
Read-only bedeutet hier nicht anonymisiert.

## Vertrag

API und Manifest nennen `assessmentVersion=skyhub-m3m-capture-assessment-v3`.
Das Manifest verwendet **`skyhub-m3m-capture-manifest-v2`**. Die Manifeststruktur v2 bleibt erhalten und erhält das additive Feld `gpsAssessment`.
Die Bewertungskennung steigt auf v3, weil GPS-Blocker genauer unterschieden
werden; Verbraucher müssen die Kennung und die neuen Blocker berücksichtigen. Pfad und Download-Dateiname
bleiben gleich; v1 wird nicht parallel exportiert.

| Feld | Bedeutung |
| --- | --- |
| `bandCounts` | Anzahl der erkannten Objekte pro G/R/RE/NIR innerhalb der Gruppe |
| `missingBands` | Bänder ohne erkanntes Objekt |
| `duplicateBands` | Bänder mit mehr als einem erkannten Objekt |
| `completeness` | `complete`, `incomplete` oder bei Duplikaten `conflicted` |
| `complete` | Genau ein erkanntes Objekt für jedes der vier Bänder |
| `bands` | Nur eindeutige Bandobjekte; mehrdeutige Bänder haben keinen gewählten Objektverweis |
| `metadataConflicts` | Abweichende bekannte Modell-, Zeit-, Positions- oder Höhenwerte zwischen den Bandheadern |
| `gpsAssessment` | Gültigkeitszähler aller erkannten Objektpositionen, exakter Konsens und begrenzte Distanzdiagnostik; keine zusätzlichen Rohkoordinaten |
| `irradianceComplete` | Endliche Irradiance-Werte für alle vier eindeutigen Bänder |
| `usability` | `metadata-candidate` oder `blocked` |
| `usable` | Kompatibilitätsfeld mit strengerer v2-Bedeutung: nur bei `metadata-candidate` wahr |
| `blockers` | Stabile maschinenlesbare Gründe für die Sperre |
| `issues` | Lesbare Erläuterungen derselben Gründe |
| `sourceAuthenticityVerified`, `radiometryVerified`, `mappingReady` | Immer `false`; Metadaten können diese Nachweise nicht erbringen |

Duplikate werden auch bei gleichem ETag nicht automatisch dedupliziert.
Weder Listing-Reihenfolge noch Importweg bestimmen einen Gewinner.
Mehrdeutige Bänder fehlen deshalb in `bands` auch im Manifest. Vorhandene
Vorschauen werden nur an eindeutig vollständige Gruppen angehängt.

Gemeinsame Metadaten werden nur übernommen, wenn sie auf allen erkannten
Bandobjekten vorhanden und gleich sind. Fehlende Werte werden nicht von einem
anderen Band ergänzt. Verglichen werden die geparsten Zahlen beziehungsweise
die exakten Modell-/Zeitzeichenfolgen, ohne erfundene Toleranzen. Auch kleine
Abweichungen können deshalb eine manuelle Prüfung verlangen. Ein ungültiges
GPS-Paar verhindert eine gemeinsame Position, selbst wenn andere Bänder GPS haben.

## GPS-Diagnostik v3

`gpsAssessment.positionCount` zählt alle erkannten Bandobjekte einschließlich
Duplikaten, nicht nur exportierte eindeutige Bänder. `validPositionCount`,
`missingOrNonNumericCount`, `outOfRangeCount` und `zeroSentinelCount` teilen diese
Anzahl vollständig auf. Gültig bedeutet hier nur: endliche Zahlen, Latitude
−90 bis 90, Longitude −180 bis 180, außerhalb des bisherigen Nullpositions-Sentinels
(beide Absolutwerte kleiner als 0,0001). Das ist kein GNSS-Qualitätsnachweis.

`allPositionsValid` verlangt mindestens eine Position und ausschließlich gültige
Werte. `consistency` ist `different`, sobald mindestens zwei gültige geparste
Paare verschieden sind, auch bei zusätzlich ungültigen Werten. `exact` verlangt
vollständige Gültigkeit und exakt gleiche Paare; andernfalls gilt `unavailable`.
`commonPositionAvailable` ist nur bei `exact` wahr; nur dann enthält `gps` einen
Wert. Weder erste/letzte Position noch Mittelwert werden als Ersatz gewählt.

`maxSpreadMetres` ist die größte der sechs paarweisen sphärischen
Haversine-Distanzen (Radius 6.371.000 m), ausschließlich bei genau einem gültigen
Objekt für jedes der vier Bänder. Bei fehlenden/mehrdeutigen Bändern oder einer
ungültigen Position bleibt der Wert `null`. Null Meter ist ein berechneter Wert,
kein Ersatz für unbekannte Streuung. Die Distanz beschreibt Metadatenstreuung,
keine Sensorpräzision, Registrierung oder geografische Richtigkeit.
`distanceMethod=spherical-haversine-not-gnss-accuracy` und
`toleranceApplied=false` machen diese Grenze maschinenlesbar.

Bei ausschließlich gültigen, aber unterschiedlichen Positionen lautet der
GPS-Blocker `gps-disagreement`. Bei fehlenden oder ungültigen Positionen bleibt
es `invalid-gps`. `metadataConflicts` enthält weiterhin `gps`, wenn bekannte
gültige Positionen abweichen. Beide Fälle bleiben blockiert, auch bei
Zentimeterdifferenzen. Die Kandidatenschranke wird dadurch nicht gelockert.

## Kandidatenschranke

Ein Metadaten-Kandidat benötigt gleichzeitig:

1. Genau ein G-, R-, RE- und NIR-Objekt.
2. Vier endliche Irradiance-Werte, jeweils mindestens 10.
3. Eine gemeinsame endliche GPS-Position in den geografischen Wertebereichen;
   das bisherige Nullpositions-Sentinel nahe 0/0 bleibt ausgeschlossen.
4. Bekannte gemeinsame relative Höhe von mindestens 1 m über Start.
5. Durchgängig die Modellangabe `M3M` und keine widersprüchlichen Metadaten.

Blocker: `missing-bands`, `duplicate-bands`, `missing-irradiance`,
`low-irradiance`, `invalid-gps`, `gps-disagreement`, `unknown-relative-altitude`,
`not-above-takeoff`, `unconfirmed-model`, `metadata-conflict`.

Die Werte 10 und 1 m sind **Heuristiken**, keine Sensor- oder Flugabnahme.
Insbesondere ist relative Höhe keine Höhe über dem lokalen Boden; ein Wert
unter 1 m beweist keine Bodenaufnahme, und ein höherer Wert beweist keinen Flug.
`M3M` im Header beweist ebenfalls keine authentische Kameraherkunft.

Die UI zeigt deshalb „Metadaten-Kandidat“ oder „Metadaten-Prüfung blockiert“
zusätzlich zum Bandstatus. Bei unbekannter/alter Bewertungskennung zeigt sie
„Bewertung nicht aktuell“ und übernimmt kein altes `usable=true` als Kandidat.
Backend und UI müssen gemeinsam aktualisiert werden. Ein Abruf hat einen
30-Sekunden-Clienttimeout und einen sichtbaren Wiederholungsweg.

## Reale Ausgangsabnahme und neue Regressionen

In der Sitzung vom 01./02.11.2026 wurden **vor der v2-Änderung** am Pi
folgende Ergebnisse vom Betreiber ausgeführt und zurückgemeldet:

- Vollständiges Listing: 6.170 Objekte, sieben Seiten, 16 passende TIFFs.
- 16 bestätigte 64-KiB-Range-GETs, insgesamt 1.048.576 Headerbytes; vier
  eindeutige Vierbandgruppen. Ausgewählte Gruppe mit Hinweisen auf beide Importwege.
- Laufende Backend-GETs: vier vollständige Captures, drei nach v1 heuristisch
  verwendbar, alle 16 Manifestreferenzen konsistent, `no-store` bestätigt.
- Beide Routen ohne/falschem Token beziehungsweise mit externer XFF über
  Backend-Loopback: 401; gültiger Token: 200.
- Caddy mit geprüfter CA/Hostname: tokenfreier LAN-Zugang 200, Loopback auch mit
  gefälschtem LAN-XFF 403. Vom zweiten Rechner BRIX: LAN-HEAD jeweils 200,
  Tailscale-HEAD jeweils 403, auch mit gefälschtem LAN-XFF; tatsächliche
  Quellnetze geprüft. Das ist kein öffentlicher Internettest.

Diese Nachweise gelten für die damalige Runtime und die v1-Bewertung. Sie sind
**keine Pi-Abnahme von v2**. Die zuvor ausgewählte Aufnahme mit relativer Höhe
unter 1 m muss unter v2 blockiert werden, obwohl sie nach v1 `usable=true` war.
Die anschließende v2-Laufzeitprüfung ist unten separat dokumentiert.

### Vom Betreiber zurückgemeldete v2-Laufzeitprüfung

Nach Backend-Deployment von `b06f170` am 02.11.2026: ausgelieferte Dateien
abgeglichen, vier vollständige Captures, null Metadaten-Kandidaten,
16 konsistente Manifestreferenzen. Blocker: viermal `invalid-gps`, viermal
`not-above-takeoff`, dreimal `metadata-conflict`, einmal `low-irradiance`.

Eine weitere begrenzte Direktprüfung der 16 Header (1.048.576 Bytes) meldete
zwölf formal gültige GPS-Paare und vier Nullpositions-Sentinels. Drei Gruppen
hatten jeweils vier gültige, aber unterschiedliche Positionen; ihre maximale
paarweise Distanz lag jeweils zwischen 1 und 10 cm, insgesamt höchstens
0,028009 m. Eine Gruppe enthielt ausschließlich Nullpositions-Sentinels.
Das erklärt die v2-Sammelkategorie, belegt aber weder Ursache noch Genauigkeit
oder Authentizität. Es wurde keine Toleranz angewandt. Alle vier Gruppen hatten
relative Höhe unter 1 m; ihre Sperre besteht unabhängig vom GPS-Befund.
Diese Betreiber-Ausgaben sind **keine Pi-Laufzeitabnahme von v3**.

Regressionen: `backend/test/smart-farming-captures.test.js` prüft fehlende
Irradiance-Werte, GPS-/Höhengrenzen, Modell-/Metadatenkonflikte, Duplikate bei
umgekehrter Reihenfolge, ETag-basierten Headercache und Manifest-Konsistenz. GPS-Regressionen trennen
Zentimeterabweichungen, exakten Konsens, ungültige Teilgruppen und Nullpositions-
Sentinels; fehlende/mehrdeutige Bänder erzeugen keine Vierband-Distanz. Eine
Datumsgrenzen-Fixture prüft die sphärische Distanz ohne Konsens-Toleranz.
`scripts/smart-farming-captures-browser-ci.js` prüft die ausgelieferte Seite
mit synthetischen Metadaten: Status, GPS-Gültigkeit gegenüber abweichenden Positionen, Konflikte ohne Download-Gewinner,
Versionsabweichung, Laden/Leer/Fehler, Tastatur, schmale Ansichten und Timeout/Retry.
Die vorhandenen M3M- und Browser-Workflows führen diese Prüfungen aus.

## Verbleibende Grenzen und nächste Abnahme

Der Parser sucht weiterhin begrenzt im TIFF-Anfang nach XMP; er ist kein
vollständiger TIFF-/Namespace-/Provenienzvalidator. Größen-/Endungsfilter,
Bucket-weite Inventur, bisherige Range-Antwortprüfung und Vorschau-Cachegrenzen
bleiben außerhalb dieser Bewertungsänderung. Der Headercache berücksichtigt
nun zusätzlich den gelisteten ETag, aber Listing-Cache und konkurrierende
Objektänderungen verhindern weiterhin einen atomaren Quell-Snapshot.
Ein S3-ETag ist kein unabhängig geprüfter SHA-256-Inhaltsnachweis.

Nach separatem Deployment: laufende Dateien identifizieren, Capture-API und
v2-Manifest mit Bewertungskennung v3 vergleichen, ausschließlich aggregierte Band-/Blockerzähler
ausgeben und die LAN-/Tailscale-Grenzen erneut prüfen. Keine Roh-UUIDs, GPS,
Objektschlüssel oder Token in Abnahmeberichte übernehmen. Erst danach folgt
eine gesonderte Abnahme echter Pixel, Bandregistrierung, Kalibrierung und
überlappender Flugbilder für einen nachvollziehbaren Mosaiklauf.

Für denselben unveränderten Bestand ist die kleinste v3-Abnahme: vier vollständige
Captures, weiterhin null Kandidaten, drei `gps-disagreement` und ein `invalid-gps`,
vier `not-above-takeoff`; API und Manifest müssen je Gruppe dieselbe
`gpsAssessment` liefern. Die drei vollständig gültigen Gruppen sollen erneut
maximal rund 0,028009 m Streuung zeigen; die Sentinel-Gruppe `null`. Alle
`toleranceApplied` bleiben `false`. Dies ist eine Erwartung aus dem alten
Bestand, kein bereits ausgeführtes Ergebnis. Bei Abweichung zuerst Bestand,
Versionskennung und ausgelieferte Dateien prüfen, keine Schwellen anpassen.
