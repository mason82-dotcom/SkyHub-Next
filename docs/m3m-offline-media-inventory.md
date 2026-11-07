# Mavic 3M – isolierte Dateinamen-Inventur (Phase 1)

**Review-Stand 23.10.2026.** Aus dem historischen [PR #23](https://github.com/mason82-dotcom/SkyHub-Next/pull/23) wurde nur ein eigenständiger Offline-Baustein für den aktuellen SkyHub-Next-Main-Stand portiert. [PR #24](https://github.com/mason82-dotcom/SkyHub-Next/pull/24) enthält eine deutlich größere, **nicht** mit diesem Modul zusammengeführte MinIO-/HTTP-/Pilot-2-Kette. Dieses Dokument ist keine Aussage über aktuell auf dem Pi gestartete Dienste.

## Implementierte, feste Grenzen

- `backend/m3m-media-inventory.js` ist eine **synchrone, rein funktionale** Gruppierung **ausschließlich von Dateinamen**. Es öffnet keine Dateien, verbindet sich nicht zum Netzwerk und kennt keine MinIO-Zugangsdaten.
- `scripts/pi-m3m-media-inventory.js` ist ein **opt-in CLI**, das nur die unmittelbaren Einträge eines vom Betreiber angegebenen **absoluten Verzeichnisses** per `readdir` auflistet. Keine Rekursion, keine Dateinutzdaten und kein Verfolgen von Symlinks.
- `backend/test/m3m-media-inventory.test.js` testet Namen, fehlende/duplizierte Kanäle, Grenzen, Datenschutz und eine lokale Verzeichnisfixture mit Platzhalterdateien.
- Maximal **20.000 Verzeichniseinträge**, davon höchstens **12.000 Aufnahmegruppen**. Grenzverletzungen führen zu Fehlern, nicht zu einem unvollständigen Erfolg.
- **Keine neue API:** keine HTTP-Route, kein S3-Reader, kein MQTT-Publish, kein Pilot-2-Upload, keine Datenbankmigration oder DJI-Kommandos. Das Modul wird im Main-Backend nicht automatisch aufgerufen.
- CLI-Ausgabe nur **Zähler, feste Bandnamen und statische Warntexte**. Keine Originalnamen, Aufnahme-IDs, Dateipfade, Geräteseriennummern, EXIF-/XMP-/GPS-Metadaten oder Credentials.

## Bewusst enge Namenskonvention

Es werden nur diese DJI-ähnlichen Muster angenommen:

```text
DJI_YYYYMMDDHHMMSS_NNNN_D.JPG             -> RGB
DJI_YYYYMMDDHHMMSS_NNNN_MS_G.TIF           -> Green
DJI_YYYYMMDDHHMMSS_NNNN_MS_R.TIF           -> Red
DJI_YYYYMMDDHHMMSS_NNNN_MS_RE.TIF          -> Red Edge
DJI_YYYYMMDDHHMMSS_NNNN_MS_NIR.TIF         -> Near Infrared
```

Groß-/Kleinschreibung der Erweiterungen kann abweichen, für `MS` wird auch `.TIFF` erkannt und für RGB `.JPEG`. Andere Dateinamen sind unbestätigt. Eine Aufnahmegruppe entsteht nur bei identischer 14-stelliger Zahlenfolge und 4-stelliger Sequenz. Diese Zeichenfolge wird **nicht** als echte Uhrzeit, RTK-Position oder Geräte-ID interpretiert.

### Berichtsschema `skyhub-m3m-media-inventory-v1`

| Feld | Bedeutung |
| --- | --- |
| `totalEntries`, `classified`, `unrecognized`, `invalid` | Dateieinträge und Klassifizierung |
| `bandCounts` | Summen für `RGB`, `G`, `R`, `RE`, `NIR` |
| `captureGroups` | Zahl eindeutiger *Namens*-Gruppierungen |
| `spectralSets` | Gruppen mit exakt G/R/RE/NIR, ohne Doppelkanal |
| `fiveChannelSets` | Gruppen mit exakt RGB/G/R/RE/NIR, ohne Doppelkanal |
| `partialSets` | Gruppen ohne einen vollständigen Fünf-Kanal-Satz oder mit Duplikat |
| `duplicateSets`, `missingBands` | Ambiguität und fehlende Band-Namen |

**Fünf ausdrücklich feste Negativ-Flags:** `radiometricCalibrationVerified=false`, `bandCoregistrationVerified=false`, `reflectanceReady=false`, `ndviReady=false`, `ndreReady=false`.

Selbst `fiveChannelSets=1` bestätigt **nur das Namensmuster** – nicht TIFF-Inhalt, Pixelabgleich, Reflexionskalibrierung, Sonnenlichtsensor, Pflanzengesundheit oder NDVI/NDRE.

## Nicht-destruktive Prüfungen

Im isolierten Entwicklungscheckout, ohne Pi-Containerwechsel:

```bash
node --check backend/m3m-media-inventory.js
node --check scripts/pi-m3m-media-inventory.js
node --test backend/test/m3m-media-inventory.test.js
node scripts/pi-m3m-media-inventory.js --help
```

**Optional, erst wenn die Dateien bereits lokal vorliegen und das Verzeichnis ausdrücklich für diese Prüfung freigegeben ist:**

```bash
node scripts/pi-m3m-media-inventory.js --directory /absoluter/pfad/zu/m3m-bildern
```

Kein MinIO-Bucket-Mount, kein Root eines Backups, keine S3-Volume-Datenablage als Eingabeverzeichnis angeben. Die Prüfung verändert keine Dateien, aber ein Dateinamen-Listing ist ein lesender Zugriff auf geschützte Dateisysteminformationen. Fehlerantworten dürfen die Eingabepfade nicht zurückmelden.

## Historische Evidenz vs. heutiger Integrationsstand

Am **21.10.2026** wurde ein isolierter Pi-5-Worktree des alten PR #23 mit **7/7 Node-Tests** und CLI-Hilfe geprüft; die lokale Testfixture enthielt **synthetische Dummy-Dateien**. Der echte M3M-Bildbestand wurde dadurch **nicht** inhaltlich analysiert.

Ein ebenfalls historisch gemeldeter S3-Teilausschnitt des Pi-MinIO umfasste 100 direkte Einträge; nur **drei** Namenshinweise (RGB, R, NIR) waren darin klassifiziert. Diese Einzelbeobachtung beweist **nicht**, welche Gruppen im gesamten Bucket vorhanden sind. Sie ist keine Freigabe für einen kompletten Medienreader.

**Folgende Schritte sind unabhängig zu reviewen:** tatsächliche JPEG-/TIFF-/XMP-Inhalte, korrekte Sensorband-Zuordnung und Metadaten; S3-GET-only-ACL, begrenzte Pagination, Prefix-Scopes und Auth; verifizierte DJI-Pilot-2-Medien-Registrierung; Kalibrierungs-/Reflexions- und Bandregistrierungsqualität. Kein Zusammenführen gestapelter STS-/M3M-/Thermal-PRs ohne eigene Gates.

## Referenzen

- [Gesamter Projektstand](projektstand-2026-10-23.md)
- [Integrationsprioritäten](integration-priorities-2026-10-23.md)
- [Konfigurations- und Rechteabgrenzung](config-reference.md)
- [DJI-M3M-Produktübersicht](https://ag.dji.com/mavic-3-m)
- [DJI Cloud API – Pilot Media Management](https://developer.dji.com/doc/cloud-api-tutorial/en/feature-set/pilot-feature-set/pilot-media-management.html)
