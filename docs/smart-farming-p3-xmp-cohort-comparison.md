# M3M P3.8 – Privater Vergleich mehrerer XMP-Strukturberichte

**Stand: 02.11.2026.** Rein lesendes Offline-Labor; kein SkyHub-HTTP-Endpunkt, keine Docker-/Pi-Bereitstellung, keine DJI-/Agras-Steuerung. Der Worker vergleicht ausschließlich **bereits erzeugte P3.6c-Strukturberichte**, niemals Original-TIFFs direkt. Der P3.6c-Worker aus PR #250 führt bei deren Erstellung eigene TIFF- und Evidenzprüfungen durch.

## Voraussetzungen und Vertrauensgrenzen

Zwei bis acht P3.6c-Berichte müssen getrennt erzeugt werden. Jeder Bericht wird als kanonisches JSON mit abschließendem Newline in einer privaten 0600-Datei unter einem geschützten 0700-Verzeichnis archiviert. Der SHA-256-Wert jedes Berichts muss **vor dem Vergleich unabhängig** gespeichert worden sein. Der P3.8-Worker prüft, ob diese bereitgestellten Hashes zu den aktuellen Dateien passen; er kann weder den Zeitpunkt ihrer Archivierung noch ihre Vertrauenswürdigkeit beweisen.

Der Bericht ist lediglich eine datensparsame Strukturübersicht. Er belegt keine DJI-Herkunft, keinen Firmwarestand, keine voneinander unabhängigen physischen Aufnahmen und keine radiometrische Kalibrierung. Die Zähler sind syntaktische Markerhäufigkeiten, keine Sensormesswerte.

## Implementierung

`backend/workers/m3m_private_xmp_cohort_compare.py` liest maximal acht Reports von je höchstens 16 KiB, verweigert nichtkanonisches JSON, doppelte Schlüssel, zu offene Dateirechte, Symlink-Aliasse, unerwartete Felder, unzulässige Wissenschafts-Flags und unmögliche Markerzähler. Es führt eine zweite Integritäts-/Schema-Prüfung nach der ersten Auswertung durch.

Als Ergebnis erscheinen ausschließlich:
- Spannweiten der sieben verpflichtenden DJI-XMP-Fehlzähler je vier Bänder
- Spannweiten der 14 zusätzlichen dokumentierten Feldpräsenzzähler
- Spannweite unbekannter DJI-Markernamen **nur als Zahlen**, ohne Namen oder Werte
- Anzahl verschiedener beobachteter Strukturmuster, überlappender VignettingData/VignettingPolynomial-Marker und vollständig vorhandener Pflichtmarker

Zur Musterbildung werden die vier Positionen nach ihren beiden Zählwerten paarweise normalisiert; ein abweichendes Eingabe-Order allein gilt nicht als neue Struktur. Vollständig identische Berichte können dieselbe Struktur ergeben, belegen aber ausdrücklich keine getrennten Kameras oder Aufnahmen. Eine unterschiedliche Struktur belegt **keine andere Firmwareversion**.

## Privater Aufruf

Die folgenden Pfade und SHA-256-Pins sind Platzhalter für unabhängig gesicherte Daten.

~~~bash
python3 backend/workers/m3m_private_xmp_cohort_compare.py \
  --report /privat/xmp-berichte/aufnahme-a.json \
  --report /privat/xmp-berichte/aufnahme-b.json \
  --report-sha256 EXTERN_GESICHERTER_SHA256_A \
  --report-sha256 EXTERN_GESICHERTER_SHA256_B \
  --require-uniform
~~~

**Exit 0:** Berichte sind formal gültig und unterscheiden sich im Modus `--require-uniform` nicht; ohne diese Option bedeutet 0 lediglich, dass der Vergleich erfolgreich war. **Exit 3:** Mindestens zwei validierte Berichte weisen verschiedene Strukturen auf. **Exit 2:** Mindestens ein Eingabebeleg oder seine Sicherheitsanforderungen ist ungültig; kein privater Report wird ausgegeben.

Kein Exit-Code und kein Ergebnisflag dürfen als Firmware-, DLS-, Panel-, Sensor-, Index-, Agronomie- oder Flugfreigabe interpretiert werden. Die Felder `firmwareVersionsVerified`, `radiometricCalibrationVerified`, `reflectanceReady`, `agronomicUseAllowed`, `prescriptionExportAllowed` und `flightMissionAllowed` bleiben `false`.

## CI und echte Hardwareabnahme

`tests/test_m3m_private_xmp_cohort_compare.py` verwendet reale synthetische 16-bit-TIFFs zur Herstellung zweier unabhängiger P3.6c-Berichte und prüft Strukturunterschiede, Gleichheit, Reihenfolgen, nachträgliche Manipulation, nachberechnete Hashes mit gefälschten Feldern, unzulässige Rechte, verschachtelte Symlinks, verspätete Mutation und CLI-Exit-Codes. Der vollständige M3M-Python-Test-Discovery-Lauf bleibt aktiv.

Für einen echten Firmware-Vergleich müssen reale, unveränderte Mavic-3M-Originalsätze aus **separat dokumentierten** Firmwareständen lokal geprüft werden. Diese physische Zuordnung darf nicht aus der XMP-Markerstruktur selbst abgeleitet werden. Ein unabhängiger Panel-/DLS-/Geometrienachweis ist weiterhin nötig, bevor Reflektanz- oder Vegetationsindex-Ergebnisse wissenschaftlich bewertet werden.
