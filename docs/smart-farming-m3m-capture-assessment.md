# M3M-Captures: eindeutige Bänder und Metadatenbewertung v2

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

API und Manifest nennen `assessmentVersion=skyhub-m3m-capture-assessment-v2`.
Das Manifest verwendet **`skyhub-m3m-capture-manifest-v2`**. Das ist eine
bewusste Änderung gegenüber v1: Verbraucher müssen die neue Bedeutung und
Konfliktbehandlung explizit berücksichtigen. Pfad und Download-Dateiname
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

## Kandidatenschranke

Ein Metadaten-Kandidat benötigt gleichzeitig:

1. Genau ein G-, R-, RE- und NIR-Objekt.
2. Vier endliche Irradiance-Werte, jeweils mindestens 10.
3. Eine gemeinsame endliche GPS-Position in den geografischen Wertebereichen;
   das bisherige Nullpositions-Sentinel nahe 0/0 bleibt ausgeschlossen.
4. Bekannte gemeinsame relative Höhe von mindestens 1 m über Start.
5. Durchgängig die Modellangabe `M3M` und keine widersprüchlichen Metadaten.

Blocker: `missing-bands`, `duplicate-bands`, `missing-irradiance`,
`low-irradiance`, `invalid-gps`, `unknown-relative-altitude`,
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

In der Sitzung vom 01./02.11.2026 wurden **vor dieser v2-Änderung** am Pi
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
Die Zahl neuer Metadaten-Kandidaten darf erst nach einem echten v2-Lauf genannt werden.

Regressionen: `backend/test/smart-farming-captures.test.js` prüft fehlende
Irradiance-Werte, GPS-/Höhengrenzen, Modell-/Metadatenkonflikte, Duplikate bei
umgekehrter Reihenfolge, ETag-basierten Headercache und Manifest-Konsistenz.
`scripts/smart-farming-captures-browser-ci.js` prüft die ausgelieferte Seite
mit synthetischen Metadaten: Status, Konflikte ohne Download-Gewinner,
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
v2-Manifest vergleichen, ausschließlich aggregierte Band-/Blockerzähler
ausgeben und die LAN-/Tailscale-Grenzen erneut prüfen. Keine Roh-UUIDs, GPS,
Objektschlüssel oder Token in Abnahmeberichte übernehmen. Erst danach folgt
eine gesonderte Abnahme echter Pixel, Bandregistrierung, Kalibrierung und
überlappender Flugbilder für einen nachvollziehbaren Mosaiklauf.
