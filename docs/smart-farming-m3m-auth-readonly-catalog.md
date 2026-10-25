# SkyHub-Next – authentifizierter M3M-Smart-Farming-Katalog (experimentell)

Stand: 23.10.2026 · Entwicklungsbranch `feature/m3m-auth-readonly-catalog-20261023`

**Entwicklungsstand, nicht aktiviert und nicht deployed.** Diese Implementierung
stellt ausschließlich bereinigte NDVI-/NDRE-/GNDVI-/OSAVI-**Kennzahlen**
für experimentelle M3M-Kandidaten zur Verfügung. Es werden **keine**
GeoTIFFs, Kacheln, Koordinaten, Gerätekennungen, Verordnungen oder
Flugmissionen über die API angeboten.

## Existierende Authentifizierung

Die API von SkyHub-Next besitzt bereits `createHttpAuth({secret,lanAccess})`
und `app.use('/api', auth)`. Der neue Router unter
`GET /api/smart-farming/candidates/` und
`GET /api/smart-farming/candidates/:candidateId` wird nur bei
`SKYHUB_M3M_CATALOG_ENABLED=true` eingebunden. Er fordert die
bestehende Authentifizierungs-Middleware **nochmals explizit** an.

Der vorhandene LAN-Zugriff ohne Token ist nur für bestimmte bekannte
SkyHub-Pfade erlaubt und **nicht** für diesen Katalog. Der Bearer-Token
`SKYHUB_VIEW_TOKEN` ist also zwingend erforderlich, auch im LAN.
Andere HTTP-Methoden haben keine Katalogroute.

Die API setzt `Cache-Control: no-store` und
`X-Content-Type-Options: nosniff`; Authentifizierungsfehler ergeben
401, unbekannte IDs 404 und unlesbare oder inkonsistente Registrierungen
eine generische 503-Antwort ohne interne Dateipfade.

## Konfigurationsvertrag – nur isolierte Testumgebung

```text
SKYHUB_M3M_CATALOG_ENABLED=true
SKYHUB_M3M_CATALOG_ROOT=/geschuetzt/smart-farming-katalog
SKYHUB_M3M_CATALOG_SHA256=<extern gepinnter SHA256 von catalog-manifest.json>
```

Die bestehende, produktive `.env` und der Raspberry Pi bleiben
unverändert. Diese Einstellungen sind vorerst ausschließlich für
einen separaten, isolierten Testserver vorgesehen.

Das private Verzeichnis hat eine feste, nicht vom Browser steuerbare
Struktur:

```text
/geschuetzt/smart-farming-katalog/
  catalog-manifest.json
  entries/
    testfeld-001/
      candidate.json
    testfeld-002/
      candidate.json
```

`candidate.json` wird zuvor **offline** durch
`backend/workers/m3m_smart_farming_candidate.py` nach vollständiger
SHA-256-Beleg- und Pixel-QA erstellt. Der Katalog öffnet ausschließlich
die explizit im **gepinnnten** Manifest aufgelisteten privaten
Kandidaten. Ein Client kann niemals einen absoluten Pfad anfordern
oder eine neue Registrierung erzeugen.

### Manifestformat

Das Manifest ist kompaktes kanonisches JSON
`JSON.stringify(obj) + '
'`, ohne weitere Einrückung:

```json
{"schema":"skyhub-m3m-smart-farming-catalog-manifest-v1","entries":[{"candidateId":"m3m-exp-0123456789abcdef01234567","slot":"testfeld-001","candidateSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}
```

**Nur Syntaxbeispiel:** ID und SHA-256 müssen in realer Verwendung aus dem
echten bereits geprüften Kandidaten stammen und zueinander passen.
Der Katalog erlaubt maximal 100 Einträge; IDs sind eindeutig,
der `slot` enthält nur Kleinbuchstaben, Ziffern und Bindestriche.
Dateipfade und freie Dateinamen sind ausdrücklich keine Manifestfelder.

Ein Beispiel zur manuellen Erstellung auf dem isolierten Testrechner
(alle Pfade sind Platzhalter und die Datei muss vorher unter dem
richtigen privaten Slot abgelegt sein):

```bash
node - <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const root = '/geschuetzt/smart-farming-katalog';
const slot = 'testfeld-001';
const candidateFile = path.join(root, 'entries', slot, 'candidate.json');
const raw = fs.readFileSync(candidateFile);
const candidate = JSON.parse(raw);
const candidateSha256 = crypto.createHash('sha256').update(raw).digest('hex');
const manifest = {
  schema: 'skyhub-m3m-smart-farming-catalog-manifest-v1',
  entries: [{candidateId: candidate.candidateId, slot, candidateSha256}]
};
fs.writeFileSync(path.join(root, 'catalog-manifest.json'),
  JSON.stringify(manifest) + '\n', {flag:'wx',mode:0o600});
NODE
sha256sum /geschuetzt/smart-farming-katalog/catalog-manifest.json
```

Den Hash des Manifests nur über eine **unabhängig kontrollierte
Konfiguration** freigeben. Änderungen an Kandidatendateien erfordern
eine neue Version, neue SHA-Pins und kontrollierte Prüfung. Ein aus
dem jeweils vorliegenden Manifest automatisch neu gelesener Hash
wäre kein unabhängiger Schutz gegen Austausch.

## Prüfumfang am Lesezeitpunkt

Bei **jeder GET-Anfrage** wird die Manifestdatei gegen den extern
gepinnnten SHA-256 geprüft. Für sämtliche gelisteten Kandidaten
werden die Kandidatendateien gegen ihre im Manifest gepinnten
SHA-256 geprüft. Die Klasse `CatalogError` verweigert
unklare oder unerwartete JSON-Schemas, ungültige Indizes,
unplausible Kennzahlen, fehlende Dateien, direkte Symlinks,
mehrfach verlinkte Dateien sowie alle echten oder nachträglich
manipulierten Freigabeflags.

Der Browser erhält nur fest definierte Felder: `candidateId`,
experimenteller Status, vier Indexnamen und deren gültige
Pixelzahlen und mean/min/max. Private Dateipfade, Herkunftsdaten,
sämtliche Raster-URLs und unerwartete JSON-Felder werden
nicht durchgereicht.

**Kritische Unterscheidung:** Der GET-Endpunkt prüft die
Integrität der *Kandidatendateien*, er führt **keine erneute GeoTIFF-
Raster-QA und keine erneute Prüfung der ursprünglichen DEDAL-
Software oder Aufnahmequellen** aus. Daher lauten die Ausgabefelder
`recordSha256VerifiedAtRead=true` und
`rasterQaRecheckedAtRead=false`.
Keine Kartenkacheln dürfen auf dieser Grundlage veröffentlicht werden.
Für einen späteren Tile-Dienst sind eine zusätzliche serverseitige
Bindung an unveränderliche Artefakte sowie erneute
Raster- und Rechteprüfung zwingend.

## Tests und Entwicklungsgrenzen

`backend/test/smart-farming-catalog.test.js` enthält
**19 lokale Node-22-Tests**, die ohne Netzwerk oder Express-Server
Katalog-Sanitizing, Pins, Dateisystemvalidierung, Rollen- und
Pfadeinschränkungen sowie verpflichtende Router-Authentifizierung
prüfen. Alle 19 liefen lokal erfolgreich.

`backend/test/smart-farming-catalog-http.test.js` ergänzt
**3 echte Express-HTTP-Tests**: anonyme und fehlerhafte Tokens,
gültiger Bearer-Token, fehlende und beliebige IDs, POST-Ablehnung,
generische Fehler und fehlende Pfadoffenlegung. Diese Tests
laufen auf der isolierten GitHub-CI mit Node 22 und dem gepinnten
`backend/package-lock.json`; ein erfolgreicher CI-Abschluss
ist gesondert zu bestätigen.

Es gibt **keine** Änderungen an DJI-Kommandos, MinIO, PostGIS,
MQTT, aktiven Kartenlayern, Betriebsfreigaben oder
Raspberry-Pi-Produktivdiensten. Das gesamte Feature bleibt
standardmäßig deaktiviert.

## Nächster Schritt

Nach positiver CI das Frontend als separaten, klar mit
„Experimentell / nicht kalibriert“ gekennzeichneten **Metadaten-Tab**
anbinden. Die Anzeigen müssen auth-pflichtig, ohne Kachel-/GIS-
Endpunkte und ohne Agrarexport bleiben. Wissenschaftliche
Hardwareabnahme und echte DEDAL-Kalibrierung sind eigene Gates.
