# M3M: isolierter, prefixgebundener S3-ListObjectsV2-Vertrag

**Stand 23.10.2026.** Ausgangsbasis: [PR #24](https://github.com/mason82-dotcom/SkyHub-Next/pull/24) enthält eine funktionsreiche MinIO-/HTTP-/Pilot-2-Integration. Für diesen kleinen, unabhängigen PR wurde **nur das Lese-/Pagination-Konzept** herausgelöst und gegen den aktuellen Main-Stand sowie die bereits gemergte [lokale Dateinamen-Inventur #68](https://github.com/mason82-dotcom/SkyHub-Next/pull/68) gehärtet. **Nicht Teil der aktuellen SkyHub-HTTP-Runtime.**

## Komponenten und echte Grenzen

- `backend/m3m-s3-read-contract.js`: ein explizit und *separat* vorgegebener `allowedPrefix`, fest der Bucket `dji-cloud`, ausschließlich **ListObjectsV2** mit `Delimiter:'/'` und höchstens 200 Listeneinträgen pro Aufruf. Der Adapter exportiert keine `GetObject`-, `PutObject`-, `DeleteObject`-, `HeadObject`- oder `STS`-Operation.
- `backend/m3m-s3-inventory.js`: sammelt ausschließlich direkte Objektnamen unter dem geprüften Prefix, lehnt fehlerhafte Antwortseiten, doppelte Objektschlüssel über Seiten, manipulierte/wiederholte Cursors und unvollständige Scans ab. **Maximal 101 Seiten und 20.000 direkte Einträge**; keine Teilausgabe bei Fehler.
- **Einzige öffentliche Ergebnisform:** das bestehende Schema `skyhub-m3m-media-inventory-v1` mit RGB/G/R/RE/NIR-**Zählwerten**, gruppiert nach streng validiertem Dateinamenmuster. Keine Objektpfade, Objektkeys, Zeitstempel, ETags, signierten URLs, Geräte-/Capture-IDs, Pixel, XMP oder Telemetrie in der Rückgabe.
- `backend/test/m3m-s3-read-contract.test.js`: synthetische ListObjectsV2-Antworten und vollständige Fail-Closed-/Privatsphäre-Regression. **Kein Netzwerkaufruf** in der CI.
- Ohne `allowedPrefix` und ohne explizite `listOnly`-Injektion lässt sich kein Storage-Adapter erzeugen. Kein selbstständiger AWS-/MinIO-Client wird erstellt; das verhindert ungewollten produktiven Zugriff oder die Übernahme alter S3-Root-Credentials aus PR #24.

## Schnittstelle – nur für kontrollierte Offline-Staging-Caller

```js
const {createScopedListOnlyStorage}=require('./backend/m3m-s3-read-contract');
const {inventoryM3MFromS3}=require('./backend/m3m-s3-inventory');

// listOnly muss ein bereits separat freigegebener, nur zum
// Auflisten berechtigter ListObjectsV2-Funktionsadapter sein.
// Hier ist absichtlich KEIN realer S3-Zugriff implementiert.
const storage=createScopedListOnlyStorage({
  allowedPrefix:'missions/flight-001/',
  listOnly: async ({Bucket,Prefix,Delimiter,MaxKeys,ContinuationToken}) => {
    // Testbeispiel ohne Netzwerk. Im separaten Staging später
    // ausschließlich einen überprüften ListObjectsV2-Aufruf injizieren.
    return {Contents:[],IsTruncated:false};
  }
});
const report=await inventoryM3MFromS3(storage,'missions/flight-001/');
// report enthält ausschließlich Zähler und fest false gesetzte Readiness.
```

Ein Prefix muss aus **mindestens zwei wörtlichen Segmenten** bestehen, ausschließlich ASCII-Buchstaben, Zahlen, Unterstrich/Minus und abschließendem Slash. URL-Encoding, `..` und Backslash sind absichtlich nicht zulässig. Die tatsächliche Leseanforderung muss *innerhalb des unabhängig festgelegten* `allowedPrefix` liegen. Diese Beschränkung ergänzt eine S3-/MinIO-Policy, ersetzt sie aber nicht.

## Noch zu integrieren und gesondert abzunehmen

1. **Nur-lesender echter S3-Transport** über einen *gepinnten* AWS-SDK-v3-Client (oder ein separat geprüftes S3-SDK). Dafür zunächst Package-Lock, Endpoint/TLS/Origin, DNS-/SSRF-Grenzen, Scope-gebundene IAM-Policy, GET/LIST- versus PUT/DELETE-Negativtests und isolierte MinIO-Testinstanz prüfen. Dieser PR ergänzt **keine Abhängigkeiten** und liest **keine echten Buckets**.
2. **Auth- und HTTP-Schnittstelle** ausdrücklich separat: niemals den Worker ohne korrekt eingeschränkte View-/Rollen-Authentifizierung an `backend/server.js` montieren. `/api/media/*` existiert auf dieser Main-Basis weiterhin nicht.
3. **DJI-Medienidentität** getrennt prüfen: Objektnamen sind keine gesicherte Quelle für DJI-Kamerabänder, Format, Zeitstempel oder Vollständigkeit eines Flugs. S3-Liste ist ohne Snapshot keine transaktional konsistente Momentaufnahme; ein neu hinzukommendes Objekt könnte trotz eindeutiger Cursors die Bilanz verändern. Bis zu zusätzlicher stabiler Inventar-/Versionierungsprüfung bleiben diese Befunde **„filename-hints-only“**.
4. **Agronomische Verwertbarkeit:** `radiometricCalibrationVerified`, `bandCoregistrationVerified`, `reflectanceReady`, `ndviReady` und `ndreReady` sind **immer false**. Kein DJI-Cloud-API-1.18-, M3M-Rohbild-, Bandregister-, NDVI- oder Flugbereitschaftsnachweis.

## Nicht-destruktive Entwicklerprüfung

```bash
node --check backend/m3m-s3-read-contract.js
node --check backend/m3m-s3-inventory.js
node --test backend/test/m3m-s3-read-contract.test.js
```

Die CI testet alle relevanten Node-/Python-Module und den PostGIS-Staging-/Restore-Pfad in Wegwerf-Umgebungen. **Es werden keine Pi-Dateien, Docker-Profiles, S3-Buckets oder DJI-Geräte berührt.**

**Querverweise:** [lokale M3M-Dateinamen-Inventur](m3m-offline-media-inventory.md), [Integrationsstrategie](integration-priorities-2026-10-23.md), [Sicherheit](security.md), [Konfiguration](config-reference.md).
