# SkyHub Smart Farming – P3.5b: prüfbarer Referenz-Indexvergleich (Offline)

**Stand:** 02.11.2026. Aus historischem Draft #144 isoliert auf aktuellen `main` konsolidiert; P3.5a mit kanonischem Referenzmanifest und zusätzlichen Pfadprüfungen wurde bereits in PR #242 übernommen. **Nur Quellcode und synthetische Offline-Abnahme, kein Pi-Deployment, keine DJI-/Pilot-2-/Agras-Aktion.**

## Ergänzung gegenüber P3.5a

Der bisherige P3.5a-Worker prüft vier Float32-Reflektanzbänder (`red`, `green`, `red_edge`, `nir`) gegen getrennt gespeicherte, extern gepinnte Referenz-GeoTIFFs. Der neue Worker `backend/workers/m3m_private_reference_indices.py` berechnet aus diesen Referenzbändern nochmals **direkt** vier Indizes und vergleicht die Ergebnisse mit den bestehenden numerischen SkyHub-Index-TIFFs. Eine Umrechnung aus kolorgebenden PNG-/Preview-Pixeln findet nicht statt.

**Formeln (Referenzwerte als Float64, numerische Quelle als Float32):**

| Index | Formel |
|---|---|
| NDVI | (NIR − Red) / (NIR + Red) |
| NDRE | (NIR − Red Edge) / (NIR + Red Edge) |
| GNDVI | (NIR − Green) / (NIR + Green) |
| OSAVI | 1,16 × (NIR − Red) / (NIR + Red + 0,16) |

Es gelten `NoData=-9999`, verpflichtende gemeinsame Gültigkeit **aller vier** Referenzkanäle, endliche Floats, Nenner > 1e−6 und numerische Intervallprüfung. Die Quelle und die Referenz müssen sich in CRS, Pixelmaßen, Affintransformation, Float32-Datentyp und NoData-Feld **exakt** decken. Maximal 2 Millionen Pixel und 256×256-Streaming-Fenster; keine Reprojektion mit unkontrollierter Interpolation. Die Quelldaten werden nicht verändert.

## Vertrauenskette

1. **Vorher:** P3.5a verifiziert den gesamten 11-Artefakte-SHA-256-Siegelbeleg einschließlich ursprünglicher NDVI-/NDRE-/GNDVI-/OSAVI-Pixelmathematik und vier separat gehashten Referenz-TIFFs. Ein bitidentischer Vierband-Klon wird als mögliche zirkuläre Referenz abgewiesen.
2. **Vergleich:** P3.5b liest Referenzbänder und Originalindexraster separat, berechnet vier Indexformeln neu und vergleicht nur numerisch gültige gemeinsame Pixel.
3. **Nachher:** Die vollständige Quelle und alle Referenzdateien werden erneut gegen die vorher **unabhängig archivierten** SHA-256-Pins geprüft. Ein externer Pin darf nicht während des Vergleichs von den vorgefundenen Dateien abgeleitet werden.
4. **Keine Provenienz-Beförderung:** Der P3.5a-Audit kann numerische Abweichungen belegen, nicht die Unabhängigkeit eines Labors und nicht die DJI-M3M-Herkunft. P3.5b behält diese Einschränkung bei.

## Diagnosewerte

Je Index enthält der Bericht: `sharedValidPixels`, `sourceIndexValidPixels`, `referenceDerivedValidPixels`, `sourceOnlyValidPixels`, `referenceOnlyValidPixels`, `maskIntersectionOverUnion`, `meanSignedError`, `meanAbsoluteError`, `rmse`, `p95AbsoluteError` und `withinExploratoryLimits`.

**Ausschließlich experimentelle Platzhalter:** `MAE ≤ 0,05`, `RMSE ≤ 0,08`, `p95(|Δ|) ≤ 0,15`, `Masken-IoU ≥ 0,95`. Die Werte sind weder publizierte DJI-M3M-Akzeptanzgrenzen noch sensor-/agronomisch validiert. Auch wenn `allIndicesWithinExploratoryLimits=true` gilt, bleiben **alle** Readiness-, Kalibrierungs-, Herkunfts-, Rezept- und Flugflags `false`.

Die Ausgabe ist nur eine kleine whitelisted JSON-Zusammenfassung: **keine Dateipfade, GPS-Koordinaten, Capture-UUIDs, Quell-XMP, TIFF-Daten, Rohbilder oder Hashes**. Es gibt keine eingebundene HTTP-Route, kein Backend-Mounting, keinen Browser-Upload und keine persistente Datenablage.

## Isolierter Testbefehl

```bash
python3 backend/workers/m3m_private_reference_indices.py \
  --bundle /privat/geprueftes-rasterbundle \
  --seal /privat/rasterbundle.seal.json \
  --seal-sha256 <unabhaengiger-64-hex-wert> \
  --reference-dir /privat/referenzvierbaender \
  --reference-manifest-sha256 <zweiter-unabhaengiger-64-hex-wert>
```

Beide Pins müssen getrennt und vorab im unveränderlichen Operatorregister bzw. Auditbeleg abgelegt sein. Die Beispieldateipfade/Hash-Platzhalter sind keine echten Prüfdatensätze.

## Tests und offene wissenschaftliche Abnahme

Die echte Offline-GitHub-Acceptance enthält `tests/test_m3m_private_reference_indices.py`, das synthetische GeoTIFFs von P3.5a wiederverwendet. Die neuen Fälle prüfen korrekte Indexformeln, kleine und große Bandabweichungen, NoData-Drift, Rasterversatz, falsche Pins, manipulierte Quellen- und Referenzraster, bitgleiche Scheindaten und Manipulation unmittelbar vor dem abschließenden Siegelvergleich.

**Nicht geprüft:** tatsächliche DJI-M3M-Rohdaten, DLS-/Panel-/Vignettierungs-Kalibrierung, Spektralantwort/Strahlungskorrektur, unabhängiger Referenzsensor, Geotag-Provenienz, RTK-/GCP-/Orthomosaik-Bandregistrierung, agronomische Feldmessungen sowie QGIS-GUI-Abnahme. Bis diese Gates gesondert dokumentiert und erfüllt sind, gibt es keine quantitative Vegetationsgesundheitsdiagnose, Dünge-/Spritzkarte oder Flugmission.

**Zusätzlicher Regressionstest:** Bei vier Referenzbändern mit Reflektanz 0 werden die Nenner von NDVI, NDRE und GNDVI ungültig, sodass die gültige Pixelmasken-Überlappung sinkt. **OSAVI bleibt aufgrund des additiven Terms `+0,16` mathematisch definiert**, liefert aber eine entsprechend große numerische Abweichung zum unveränderten Quellindex. Die Prüfung unterscheidet somit gezielt Gültigkeitsmasken- und Wertabweichungen; keine davon schaltet wissenschaftliche Freigaben frei.
