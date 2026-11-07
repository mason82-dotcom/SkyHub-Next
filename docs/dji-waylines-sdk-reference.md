# Motecshine DJI Waylines SDK als SkyHub-Next-Referenz

**Status: Offline-Referenzintegration; nicht flugfreigegeben.** Kein DJI-Cloud-API-Missionsversand, kein MQTT-Publish, kein Upload auf Drohnen oder RC, kein automatisches Flight-Ready-Signal.

## Herkunft / Stand

- Quellrepository: https://github.com/motecshine/dji-waylines-sdk
- geprüfter Upstream-Commit: `dd9b12d26c4c200220165e8e6d409d6dafdbfa23` (README zuletzt 09.10.2025)
- einsehbare Go-Bausteine: `converter_schema.go`, `converter.go`, `validator.go`, `actions.go`, `action_types.go`, `structures.go`, `serializer.go`, `kmz.go`
- Go-Modul in `go.mod`: `github.com/motecshine/dji-waylines` (Go 1.25.1). **README empfiehlt dagegen `github.com/motecshine/wpml`**. Nicht ungeprüft übernehmen.
- **Lizenzklärung offen:** Die README nennt MIT, aber im eingesehenen Repository-Tree ist **keine LICENSE-Datei** vorhanden. Es wird deshalb weder Drittquellcode kopiert noch das Go-Modul zur SkyHub-Abhängigkeit gemacht.

Das Go-SDK ist eine **zusätzliche Vergleichsreferenz**, keine kanonische DJI-WPML-Spezifikation und kein DJI-Zertifizierungsnachweis. DJI-WPML-Dokumentation und an DJI Pilot 2 erzeugte KMZ haben bei fachlichen Entscheidungen Vorrang. Der Upstream-Namespace von `NewDocument()` ist `1.0.6`, der bestehende SkyHub-Editor schreibt `1.0.2`; dies wird nicht ohne Schema- und Pilot-2-Prüfung global umgestellt.

## Technischer Befund und Abgrenzung

| Bereich | Befund | Entscheidung |
|---|---|---|
| Missionsobjekt | `Waylines` mit numerischen `drone_model`/`payload_model`, Speed, Height, Waypoints | Strikt begrenztes JSON-Importprofil |
| DJI-Profil | `converter.go` setzt `DroneSubEnumValue: 0` fest, obwohl Modelle Untervarianten benötigen | **Nicht übernehmen**; SkyHub nimmt eigene explizite Geräte- und Payload-Matrix |
| README-Beispiele | teils String-IDs wie `M3TD` und camelCase-Aktionsparameter | Nur dokumentierte Aliase für Payload-Index, keine heuristische Gerätezuordnung |
| Geodäsie | Go-Struktur kennt EGM96/AGL/Folgeverfahren; SkyHub benötigt überprüfbare Höhenbezüge | Import nur `relativeToStartPoint`, nur konstante Höhe |
| Aktionsgruppen | Go unterstützt weitere Action-Typen und Trigger | JSON-Import nur maximal ein `takePhoto` je Wegpunkt bei `reachPoint` und Payload 0 |
| RC-Loss | Go-Konverter: `goContinue` mit `hover`; SkyHub-Generator: `executeLostAction` mit `goBack` | Nicht als semantisch äquivalent ausgeben; DJI-/Betriebsprüfung nötig |
| KMZ | Go: Erzeugen/Parsen, SkyHub: eigener begrenzter ZIP-/XML-Validator | Bereits vorhandene SkyHub-Pipeline bleibt maßgeblich |
| Mavic 3M | SkyHub verfügt über M3M-Profil; Upstream-Enum-Liste belegt keine identische M3M-Kombination | M3M bleibt im nativen SkyHub-Editor, **nicht** freigeben für diesen SDK-JSON-Import |
| DJI Cloud API | Die Go-Bibliothek ist primär WPML-/Datei-Tooling | Keine neue API-Route, kein Remote-Missionsdispatch |

## Implementiert

- `frontend/public/wpml-waylines-reference.js`: unabhängiger, browser-/Node-kompatibler Adapter `convert(input)` und vorgeschalteter `parseJson(raw)`-Dateileser. Unterstützt ausschließlich kleine, eindeutig übertragbare `Waylines`-JSON-Entwürfe. Doppelte JSON-Schlüssel – auch durch Unicode-Escapes verdeckte und verschachtelte – sowie übertiefe Dokumente werden **abgewiesen**. Unbekannte Felder, Aktionsparameter, heterogene Wegpunkthöhen, abweichende Geschwindigkeiten und unbekannte Drohnen-/Payload-Kombinationen werden ebenfalls **abgewiesen**.
- `frontend/public/wpml-editor.html` / `wpml-editor.js`: Dateiimport ausschließlich im Browser (JSON, max. 128 KiB); kein Upload. Nach Adapterprüfung und `SkyHubWpmlPlanner.normalize()` erscheint **zuerst eine Vorschau**. Der aktive Missionsentwurf wird **nur nach gesondertem Übernahme-Klick** geändert; bei bereits gesetzten Wegpunkten ist zusätzlich eine Bestätigung erforderlich. Abbrechen, ungültige Dateien und Ablehnung erhalten den alten Entwurf. Das KMZ wird weiterhin durch den **existierenden** SkyHub-Kern generiert.
- Die Vorschau enthält Anzahl der Wegpunkte/Fotoaktionen, horizontale Segmentstrecke per sphärischer Haversine-Näherung und eine **rein nominelle** Zeit `Strecke / Sollgeschwindigkeit`. Sie ist weder tatsächliche Flugzeit noch Batteriekalkulation. Nicht berücksichtigt sind Steigflug, Kurven, Wind, Gelände, Hindernisse oder Luftraumbeschränkungen.
- `backend/test/wpml-waylines-reference.test.js`: Profilzuordnung, Offline-KMZ und Validator, ungültige und verlustbehaftete Eingaben, Editor-Anbindung und Sicherung gegen eine Mission-API.
- `backend/test/wpml-reference-editor-ui.test.js`: Headless-UI-Test für Staging/Vorschau, explizite Übernahme, Abbruch, Fehlerfälle und Bestätigung vor Überschreiben.

Erlaubte Profilpaare (numerische DJI-Enum-IDs aus dem eingesehenen Upstream-Typkatalog und SkyHub-Profilmatrix):

| `drone_model` | `payload_model` | SkyHub |
|---:|---:|---|
| 77 | 66 | Mavic 3E |
| 77 | 67 | Mavic 3T |
| 99 | 88 | Matrice 4E |
| 99 | 89 | Matrice 4T |

Zulässiger JSON-Eingang: `name` (max. 70 Zeichen), `drone_model`, `payload_model`, optional `payload_position_index=0`, `template_type="waypoint"`, `global_speed` (1–15), optional `global_height` (muss mit allen Höhen übereinstimmen), optional `safe_height` (20–120, sonst Go-Default 20), optional `height_type="relativeToStartPoint"`, optional `finish_action="goHome"|"noAction"`, zwei bis 500 `waypoints` mit `latitude`, `longitude`, identischer `height` (5–120 m), optional passender `speed` und einem `takePhoto`-Action-Objekt pro Wegpunkt. `params` oder `action` darf den Payload-Index 0 enthalten. Zusatzparameter, einschließlich `global_rth_height`, werden abgewiesen, **nicht** stillschweigend weggelassen.

### Synthetischer Beispielimport

```json
{
  "name": "Waylines Referenz – Demo",
  "drone_model": 77,
  "payload_model": 66,
  "template_type": "waypoint",
  "global_speed": 5,
  "global_height": 50,
  "safe_height": 30,
  "height_type": "relativeToStartPoint",
  "waypoints": [
    {"latitude": 49.1, "longitude": 8.6, "height": 50, "actions": [
      {"type": "takePhoto", "params": {"payload_position_index": 0}}
    ]},
    {"latitude": 49.101, "longitude": 8.601, "height": 50}
  ]
}
```

Editor öffnen: `/wpml-editor.html`; lokale JSON-Datei auswählen, **Vorschau prüfen und ausdrücklich übernehmen**; anschließend den Entwurf auf der Karte überprüfen und nur als Offline-KMZ ausgeben.

> **Kein Roundtrip-Versprechen:** Dieses JSON wird nicht durch die Go-Bibliothek ausgeführt. Der SkyHub-Export besitzt eigene Sicherheitsvorgaben, insbesondere zur RC-Verlustreaktion. Strukturell valide KMZ ist nicht automatisch auf DJI Pilot 2 importierbar, und selbst erfolgreicher Import ist keine Flugfreigabe.

## Tests und weitere Abnahme

```bash
node --check frontend/public/wpml-waylines-reference.js
node --check frontend/public/wpml-editor.js
node --test backend/test/wpml-waylines-reference.test.js backend/test/wpml-reference-editor-ui.test.js
node --test backend/test/wpml-editor.test.js backend/test/wpml-compare.test.js
```

Die neue Änderung ist isoliert im Entwicklungsbranch; kein Pi-Deployment. Als nächste **separate** Schritte: Lizenz/Go-Modulpfad upstream klären, die synthetische JSON-/KMZ-Parität anhand anonymisierter DJI-Pilot-2-Exporte testen, Submodelle und RC-Loss-Verhalten pro Firmware verifizieren und erst danach mögliche Mapping-, Trigger- oder Multispektral-Erweiterungen prüfen. Hardware-Validierungsstatus muss bis dahin `false` bleiben.

## Offline-Referenz-Risikoaudit für vorhandene KMZ (Phase 4)

`backend/wpml-reference-audit.js` stellt `auditReferenceKmz(buffer)` bereit. Die CLI
`scripts/wpml-reference-audit.js` liest eine KMZ **rein lokal und nur lesend**:

```bash
node scripts/wpml-reference-audit.js /pfad/zu/einer-lokalen-mission.kmz
```

**Rückgabecodes:** `0` bedeutet *keine der explizit bekannten Referenz-Divergenzen gefunden*, **nicht** flugtauglich; `1` bedeutet Review notwendig; `2` bedeutet blockiert/ungültige Datei/Einlesefehler. Der JSON-Report enthält ausschließlich feste Fehlerkennungen und Statuswerte, **niemals XML-Werte, GPS-Koordinaten, Dateipfade, Missionsnamen oder einzelne Höhenwerte**. Die Funktion ist kein DJI-Importvalidator und kein tatsächlicher Lauf des Go-SDK.

Referenz auf Upstream-Commit `dd9b12d...` und die DJI-Dokumentation:
- [DJI `template.kml` / Sicherheits- und Höhenfelder](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/template-kml.html)
- [DJI `waylines.wpml` / Flugkommandos und Verlust der RC-Verbindung](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/waylines-wpml.html)

Erkannte Abweichungen, die **nur eine fachliche Warnung**, keine automatisierte Korrektur auslösen:

| Risikocode | Bedeutung |
|---|---|
| `RC_LOSS_POLICY_DIFFERS_FROM_SKYHUB_EDITOR` | Vorgabe bei RC-Signalverlust weicht von SkyHubs aktuellem Offline-Editor ab; die DJI-Feldwerte sind nicht grundsätzlich verboten |
| `TAKEOFF_REFERENCE_REQUIRES_INDEPENDENT_PROVENANCE` | `takeOffRefPoint` vorhanden; die Quelle und die tatsächliche WGS84-Ellipsoidhöhe des Referenzpunkts sind gesondert zu prüfen |
| `TAKEOFF_AGL_ZERO_REQUIRES_REVIEW` | SDK-Konverter erzeugt für die automatisch angenommene Referenz ggf. AGL-Höhe `0`; nicht als verifizierter Bodenabstand behandeln |
| `ELLIPSOID_HEIGHT_PROVENANCE_UNVERIFIED` | Ein `ellipsoidHeight`-Feld existiert; der Höhenbezug ist nicht extern verifiziert |
| `ELLIPSOID_EQUALS_OTHER_HEIGHT_REQUIRES_REVIEW` | Numerisch gleiche Höhen in zwei Referenzsystemen; das ist **nicht zwangsläufig falsch**, verlangt aber bei der SDK-Konvertierung einen Herkunftsnachweis |
| `WAYLINE_STATS_NOT_INDEPENDENTLY_VERIFIED` | `distance`/`duration` im KMZ; die Upstream-Schätzung rechnet mit ca. 111.000 m je Breiten- **und** Längengrad, was von der geografischen Breite und Route abhängige Fehler auslösen kann |

Blockierende Befunde sind u. a. `AIRCRAFT_SUBTYPE_PAYLOAD_CONFLICT`, `AIRCRAFT_SUBTYPE_UNRECOGNIZED`, `WPML_OFFLINE_VALIDATION_FAILED` und `WPML_NAMESPACE_NOT_VALIDATED_BY_SKYHUB`. Insbesondere verwendet der Upstream `NewDocument()` den Namespace `1.0.6`, während der aktuell gepinnte SkyHub-WPML-Parser nur `1.0.2` prüft. **Der Audit untersucht `1.0.6` über eine **explizite, nur lesende Namespace-Auswahl im Parser**. Es findet **kein XML-String-Rewrite** und keine Versionstransformation statt. Das Original wird nicht verändert oder neu exportiert; der Prüfstatus bleibt immer `blocked` und `offlineValid:null`.** Dies bestätigt ausdrücklich **keine** DJI-Pilot-2-Kompatibilität. Unbekannte oder gemischte Namespaces werden ebenfalls blockiert.

Geprüft werden beide XML-Dokumente innerhalb einer durch SkyHub größen- und CRC-begrenzten KMZ. Das Tool erzeugt **keine** Flugroute, sendet **keine** DJI-Kommandos und liest keine Kamera-/Ressourceninhalte. Auch ein unauffälliger Audit besitzt `flightReady:false`, `pilot2HardwareVerified:false` und `sdkOutputVerified:false`.

Tests: `node --test backend/test/wpml-reference-audit.test.js`.

## Reproduzierbare synthetische WPML-Kompatibilitätsmatrix (Phase 5)

**Ziel:** bekannte Quellcode-Abweichungen über alle fünf SkyHub-Profile reproduzierbar sichtbar machen, ohne Go-Binärdateien, private Missionen, Pilot 2 oder Hardware zu benötigen.

```bash
node scripts/wpml-reference-matrix.js
node --test backend/test/wpml-reference-matrix.test.js
```

Der Generator `backend/wpml-reference-matrix.js` erzeugt **30 lokale synthetische In-Memory-KMZ-Prüffälle**: fünf Modelle (Mavic 3E, Mavic 3T, Mavic 3M, Matrice 4E, Matrice 4T) mal sechs Szenarien. Die Fälle modellieren SkyHub-Basisexport, Go-artige RC-Loss-Einstellungen, die Upstream-Subtyp-Nullsetzung, gleiche relative/Ellipsoidhöhe, die grobe Grad-zu-Meter-Distanzschätzung und den Upstream-Namespace `1.0.6`.

Die Statuscodes sind:
- `no-listed-divergence-observed`: keine der **explizit** kodierten Auffälligkeiten in diesem künstlichen Datensatz;
- `review-required`: mindestens ein bekannter fachlicher Reviewpunkt, keine automatische Korrektur;
- `blocked`: Profil-/Schema-/Versionskonflikt oder andere blockierende Validierung.

**Evidenzgrenze:** Das CLI erzeugt ausschließlich synthetische SkyHub-KMZ mit gezielten XML-Mutationen. Weder Go-SDK-Code noch DJI Pilot 2 werden in diesem Test ausgeführt. Die beiden booleschen Felder `actualGoSdkExecutableRun:false` und `actualPilot2ImportTest:false` verhindern eine Verwechslung mit echten Fremdhersteller- oder Hardwaretests. Besonders die Mavic 3M ist kein freigegebenes Go-JSON-Importprofil, selbst wenn SkyHub einen eigenen Offline-WPML-Generator besitzt.

Der zusätzlich lesende Prüfer kann nun auch `1.0.6`-KMZ nach den **inhaltlichen** Go-SDK-typischen Risikomustern untersuchen. Das erfolgt mit expliziter Namespace-Auswahl im Read-only-Parser, ohne die XML-Dokumente umzuschreiben. Die archivierte Version bleibt unverändert und ihr Abnahmestatus bleibt blockiert. Ein grober Haversine-Vergleich markiert starke Abweichungen zwischen der im XML notierten `distance` und der horizontalen Segmentstrecke als `WAYLINE_DISTANCE_DIFFERS_FROM_SPHERICAL_APPROXIMATION`. Es werden keine Strecken-, Koordinaten- oder sonstigen Rohwerte ausgegeben. Diese Distanzprüfung ist **keine** Flugzeit-, Gelände- oder Energieberechnung.

### Echte Referenzen einbringen – ausschließlich offline

Die realen Vergleichsdateien werden **nicht erfunden** und nicht in Git eingecheckt. Nach rechtmäßiger Bereitstellung durch den Operator können ein tatsächlicher Go-SDK-Export und ein DJI-Pilot-2-Export lokal analysiert werden:

```bash
node scripts/wpml-reference-audit.js /lokaler/pfad/go-sdk.kmz
node scripts/wpml-reference-audit.js /lokaler/pfad/pilot2.kmz
node scripts/wpml-compare.js /lokaler/pfad/skyhub.kmz /lokaler/pfad/pilot2.kmz
```

Der Vergleich verwendet bestehende Privacy-Redaction und ist nur für vom aktuellen Parser akzeptierte Namespace-Versionen aussagekräftig; für `1.0.6` zunächst den separaten Risikoprüfer verwenden. Ein echter Pilot-2-Import, einschließlich Firmware- und Gerätekennung, bedarf einer **separaten, dokumentierten Hardwareabnahme**. Selbst dabei darf `flightReady:false` nicht implizit aufgehoben werden.

## Lokaler Evidenzvergleich für tatsächlich bereitgestellte Referenz-KMZ (Phase 6)

`backend/wpml-reference-evidence.js` und `scripts/wpml-reference-evidence.js` verbinden die bisherigen einzelnen Offline-Audits und den strukturellen KMZ-Vergleich in einem reproduzierbaren Ablauf. **Weder Dateien noch Manifeste werden an einen Server übertragen.** Es wird keine echte Referenzdatei automatisch heruntergeladen, kein Go-SDK ausgeführt und kein DJI-Pilot-2-Import behauptet.

### Beispiel für ein lokales Manifest

Erstelle im Repositoryverzeichnis einen vom Git ignorierten Ordner `.local-wpml-evidence/` und lege **nur lokal** folgende Datei `references.json` an:

```json
{
  "schema": "skyhub-wpml-reference-fixtures-v1",
  "files": {
    "skyhub": "skyhub.kmz",
    "goSdk": "go-sdk.kmz",
    "pilot2": "pilot2.kmz"
  }
}
```

Die KMZ-Dateien müssen im selben Verzeichnis oder in dessen Unterordnern liegen. Mindestens **zwei** der drei kontrollierten Rollen sind nötig, die dritte ist optional. Nur lokale, reguläre Dateien sind zulässig; Symlinks, absolute Pfade, `..`-Pfadbestandteile, zusätzliche Manifestfelder und Dateien außerhalb des Manifestverzeichnisses werden abgewiesen. Ein fehlender oder beschädigter Import erzeugt **keine** Rohdaten- oder Pfadfehlerausgabe.

```bash
node scripts/wpml-reference-evidence.js .local-wpml-evidence/references.json
node --test backend/test/wpml-reference-evidence.test.js
```

**Rückgabewerte:** `0` = keine der expliziten Befunde und kein struktureller Unterschied gefunden; `1` = fachlicher Review notwendig, einschließlich abweichender KMZ oder byteidentischer angeblich unterschiedlicher Quellen; `2` = blockierter/ungültiger/untereinander nicht vergleichbarer Eingang. Auch `0` bestätigt **weder Dateiauthentizität noch DJI-Importfähigkeit**.

Das Werkzeug prüft die einzelnen Dateien mit `auditReferenceKmz()` und vergleicht alle vorhandenen Rollen paarweise mit `compareKmz()`, jedoch **nur wenn beide KMZ innerhalb des nativ unterstützten SkyHub-Namespaces `1.0.2` offline-valide sind**. Dateien mit `1.0.6` werden zwar innerhalb des separaten lesenden Audits untersucht, der semantisch nicht verlässliche Cross-Namespace-Vergleich bleibt jedoch als `skipped-noncomparable-or-blocked` gekennzeichnet. Es gibt **keine** automatische Namespace-Konvertierung als Flugmission.

Der strukturierte JSON-Bericht enthält nur vordefinierte Rollen, Kategorien, Befunde, boolesche Prüffelder und Aggregatzahlen. **Keine** GPS-Koordinaten, Missionsnamen, Dateinamen, Pfade, Roh-XML, KMZ-Bytes oder SHA-Fingerprints werden ausgegeben. Die Rollen `goSdk` und `pilot2` sind **unbestätigte Bedienerangaben**. Insbesondere müssen `actualGoSdkExecutableRun:false`, `actualPilot2ImportTest:false`, `pilot2HardwareVerified:false` und `flightReady:false` bleiben.

Für eine spätere echte DJI-Hardwareabnahme ist eine getrennte, nachvollziehbar dokumentierte Prüfung von Fluggerät, Firmware, DJI Pilot 2, Kameraaktionen und Höhenbezügen erforderlich. Ein paarweiser XML-Vergleich – selbst bei Gleichheit – ist kein Nachweis für Hardwarekompatibilität oder sicheren Flug.

## Detailuntersuchung: WPML-XML-Namespaces sind Kennungen, keine XSD-Dateien (Phase 7)

**Untersuchungsstand 23.10.2026:** Der [W3C-XML-Namespace-Standard](https://www.w3.org/TR/xml-names/) definiert einen Namespace als URI-Kennung. Die URI muss **keine** XML-Schemadatei (.xsd) zurückliefern. Ein `xsi:schemaLocation` wäre eine *gesonderte* Schema-Referenz, die hier nicht automatisch abgerufen oder ausgeführt wird. Eine vermeintliche Versionsnummer im Namespace beweist allein **keine** Vorwärts-/Rückwärtskompatibilität.

Belegte Quellen und ihre Reichweite:

| Herkunft | Beobachtung | Evidenzgrenze |
|---|---|---|
| [DJI Cloud API, template.kml](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/template-kml.html) und [waylines.wpml](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/waylines-wpml.html) | DJI verwendet in den veröffentlichten Mustern `xmlns:wpml="http://www.dji.com/wpmz/1.0.2"` | Dokumentierte Beispiele und Feldtabellen, keine vorliegende `1.0.6`-XSD |
| [motecshine/dji-waylines-sdk – serializer.go](https://github.com/motecshine/dji-waylines-sdk/blob/main/serializer.go) | `MarshalTemplate` und `MarshalWaylines` setzen bei leerer Namespace-Angabe `1.0.6` | Go-SDK-Implementierungsentscheidung, keine offizielle DJI-Kompatibilitätsbescheinigung |
| SkyHub-Next `backend/wpml.js` / `wpml-editor-core.js` | `1.0.2` ist der Default des Validators und der **einzige** Wert des WPML-Exports | Andere Versionen bleiben von Flugfreigabe und regulärer Erstellung ausgeschlossen |

In den überprüften Repository-Dateibäumen von `dji-sdk/Cloud-API-Doc` und `motecshine/dji-waylines-sdk` wurde **keine** `*.xsd`, `*.dtd` oder `*.rng`-Datei gefunden. Daraus folgt **nicht**, dass DJI intern überhaupt kein Schema verwendet. Die direkten Namespace-URLs sind keine verlässlichen Schema-Endpunkte.

### Technisch relevante Korrektur

Der Parser erkennt die beiden Kennungen nun **explizit und strikt getrennt**:

- `parseXml(xml)` und `validateDocuments(template,waylines)` verwenden weiterhin ausschließlich `1.0.2`. Bestehende Generatoren und Validierung bleiben dadurch unverändert.
- Nur die gezielte Audit-Funktion verwendet `parseXml(xml, "http://www.dji.com/wpmz/1.0.6")` und `validateDocuments(template,waylines,namespace)` für eine **partielle, rein lesende Inhaltsprüfung**. Dabei bleibt `offlineValid:null`, `reviewStatus:"blocked"`, `flightReady:false` und `pilot2HardwareVerified:false`.
- Der bisherige textuelle Ersatz `1.0.6 → 1.0.2` wurde entfernt. Das schützt auch davor, dass ein zufällig in einem XML-Kommentar auftretender URI-String mit der echten Root-Deklaration verwechselt wird.
- **Namespace-Shadowing** wird abgelehnt: ein verschachteltes `xmlns:wpml` oder `xmlns` könnte denselben sichtbaren Elementnamen auf eine andere XML-Sprache umdeuten. Der derzeitige Parser arbeitet mit wörtlichen QName-Namen, nicht vollständig mit expandierten Namespace-Namen. Diese ausdrücklich begrenzte Implementierung weist eine solche lokale Umschaltung deshalb ab, statt sie stillschweigend zu interpretieren.
- Auch URI-Abweichungen wie `https` statt `http`, `wpml` statt `wpmz` oder `1.0.7` werden nicht automatisch gleichgesetzt. Gemäß W3C werden Namespace-URIs bei der Zuordnung grundsätzlich als Zeichenfolgen verglichen.
- Keine DTD-Auflösung, kein externes Schema-Fetching, keine Ausgabe von GPS-Koordinaten oder Roh-XML und **keine** neue Flug-API.

Tests: `node --test backend/test/wpml-namespace-compat.test.js backend/test/wpml-reference-audit.test.js`.

**Offene Abnahme:** Ein echter Pilot-2-/FlightHub-2-KMZ-Export mit unverändertem Namespace, Fluggeräte-/Firmwareprofil und XML-Feldinventar ist erforderlich, um das tatsächlich verwendete Dialektprofil weiter einzugrenzen. Weder eine erfolgreiche partielle Validierung noch der Namespace allein genügen für einen Hardware-Nachweis.

## P0: Lokale Routenbibliothek und unveränderliche Revisions-Snapshots (Phase 8)

Der Browser-Prototyp `/wpml-route-library.html` ergänzt den bestehenden einfachen WPML-Editor **ohne Änderung der DJI-Datenbank oder Cloud-APIs**. Die Bibliothek liegt im Browser-Origin unter dem separaten Schlüssel `skyhub.wpml.local-route-library.v1` und wird **nur nach ausdrücklichem Klick auf „Revision lokal speichern“** persistent abgelegt. Der Inhalt einschließlich GPS-Positionen liegt **unverschlüsselt in `localStorage`**. Nicht für öffentlich zugängliche oder geteilte Geräte verwenden; kein automatisches Speichern, Backup, Upload, Cross-Browser-Sync oder Multiuser-ACL.

Funktionen des `wpml-route-library-core.js`:
- Routen neu erstellen, benennen, mit Ordnerzeichenfolge kategorisieren, filtern, duplizieren und nach Bestätigung vollständig löschen;
- revisionsweise speichern und beliebige Revision explizit laden; eine neue Revision überschreibt **nie** die Plandaten einer vorherigen Revision;
- 32 Routen, maximal 12 Revisionen je Route, insgesamt höchstens 512 KiB JSON; keine automatische Historienkürzung;
- für eine konkrete Revision mit `taskSnapshot()` einen von der Bibliothek losgelösten, rekursiv eingefrorenen **Offline-Task-Referenzsnapshot** erzeugen. Dieser ist weder ein geplanter Flugauftrag noch ein persistierter DJI-Task-Plan;
- bei unlesbarem/ungültigem Bibliotheksinhalt oder überlaufendem Speicher keine stillschweigende Reparatur oder Datenüberschreibung.

Die Routen lassen sich über `/wpml-route-library.html` interaktiv bearbeiten. Der neue Bildschirm enthält eine eigene Punktliste, Ordnerfilter, Revisionsauswahl, Gruppenliste und einen lokalen KMZ-Export. Revisionen mit Höhenmodus, Legacy-Fotoflags oder Foto-Intervall-Optionen, die der aktuelle Bildschirm **noch nicht verlustfrei bearbeiten kann**, werden beim Laden **abgelehnt, statt stillschweigend vereinfacht**. Die ursprünglichen Daten in der Bibliothek bleiben erhalten.

## P1: Geordnete Wegpunktaktionen – konservative ausführbare WPML-Teilmenge

`frontend/public/wpml-action-draft.js` beschreibt pro Wegpunkt höchstens **eine `reachPoint`-Action Group mit maximal acht Aktionen**, einschließlich deren Reihenfolge. Der vorhandene `wpml-editor-core.js` serialisiert die Gruppen jetzt im generierten `waylines.wpml` in DJI-konforme Elementstrukturen:

| Aktion | Einschränkung |
|---|---|
| `takePhoto` | Kamera-Payload-Position fest 0, keine unbewiesene Objektivauswahl |
| `hover` | 0,1–120 Sekunden |
| `rotateYaw` | −180° bis +180° |
| `startRecord` / `stopRecord` | Nur ausgewogene, entlang der Flugroute sortierte Start-/Stop-Paare |

Nicht implementierte WPML-Aktionen wie `zoom`, `focus`, `gimbalRotate`, `orientedShoot`, Drittanbieter-KI und Kamera-spezifische Linsenprofile werden **abgewiesen**, niemals kommentarlos ausgelassen. Ebenso werden bisherige Wegpunkt-Photo-Flags und Foto-Intervall-Auslöser **nicht** gemeinsam mit dem neuen Action-Group-Modell akzeptiert, solange ein semantisch sicherer Merge fehlt. Jeder Export verbleibt bei `flightReady:false`, `cameraHardwareVerified:false`; auch gültiges WPML bedeutet **keine** bestätigte Pilot-2-Kompatibilität.

Das UI unterstützt das Hinzufügen, Entfernen und Umordnen von Wegpunkten sowie das Anlegen, Bearbeiten und Umordnen der Aktionseinträge. Eine spätere P1-Ausbaustufe benötigt erst gesicherte Go-/Pilot2-Referenzdateien für weitere Trigger, Kameraparameter und Onboard-KI.

```bash
node --test backend/test/wpml-library-actions.test.js
```

**Grenze P0:** Es handelt sich bewusst um eine browserlokale MVP-Bibliothek, **nicht** um die spätere zentrale, serverseitige Routenverwaltung mit projektweiten Ordnern, Berechtigungen, Team-Synchronisation und transaktionalen Datenbanksnapshots. Diese Funktionen verlangen vor einem Server-Rollout eine eigenständige Authentifizierungs-, Datenmodell- und Migrationsprüfung.

## P0-Weiterentwicklung: Zentrales Schema (Phase 9, noch deaktiviert)

`backend/db/migrations/003_wpml_route_library_draft.sql` ist ein **nicht aktiviertes Entwurfsschema** für eine zukünftige zentrale SkyHub-Next-Routenbibliothek. Der laufende Server installiert dieses Schema **nicht automatisch**, die Browserbibliothek wurde **nicht** auf serverseitiges Speichern umgestellt, und es wurden **keine** Routen-CRUD- oder Dispatch-Endpunkte eingebaut.

Das Schema ist für die spätere Mehrmandantenverwaltung ausgelegt:
- `skyhub_wpml_folders` – Ordner je `workspace_id`;
- `skyhub_wpml_routes` – Routen und aktuelle Revision, mit arbeitsbereichsgebundenen Fremdschlüsseln;
- `skyhub_wpml_route_revisions` – vollständige JSON-Snapshots plus SHA-256-Fingerprint und Unveränderlichkeits-Trigger;
- `skyhub_wpml_task_snapshots` – nicht ausführbare, unveränderliche Referenzen auf eine konkrete Routenrevision.

**Sicherheitsstatus:** Auf allen vier Tabellen ist PostgreSQL Row-Level Security mit `FORCE` aktiviert. **Es gibt absichtlich keinerlei Freigabepolicy oder automatisch vergebene SQL-Berechtigung.** Das führt zu *Default Deny*, bis unabhängige Operator-/Admin-Identitäten, Workspace-Bindung und Zugriffstests nachgewiesen sind. Es wird bewusst **kein** Operator-Zugriff aus einem DJI-Pilot-2-Pairing-Token oder dem globalen Dashboard-View-Token abgeleitet. Privilegierte PostgreSQL-Superuser und Tabellenbesitzer können unter Umständen trotz Schutzmaßnahmen ein Schema ändern; separate Datenbankrollen, Migration-ACLs, Verschlüsselung/Backups und Betriebskontrollen sind vor einer Aktivierung erforderlich.

CI führt die Datei ausschließlich in einer **temporären PostGIS-Testdatenbank** aus, inklusive Mandanten-Fremdschlüsseln, `flight_ready=false`, `dispatch_allowed=false`, unveränderlicher Revisionen und `TRUNCATE`-Schutz. Dazu:
```bash
# Nur in der dedizierten CI-Datenbank mit SKYHUB_TEST_DATABASE_URL
node --test backend/test/wpml-route-schema.integration.test.js
```

## P1-Weiterentwicklung: Aktionsvorlagen, Batch-Editing und Routenumkehr

Die Action-Draft-API `frontend/public/wpml-action-draft.js` stellt nun `applyTemplate()` und `reverseRoute()` bereit. Die separate Oberfläche `/wpml-route-library.html` bietet passende Bedienelemente.

- Vorlagen: `photo`, `hoverPhoto` (2 s Schweben + Foto) und `yawPhoto` (Yaw 0° + Foto).
- Batch-Auswahl: `alle`, einzelne Wegpunktnummern oder Bereiche wie `1,3-5`. Doppelte und ungültige Auswahl, überschrittene Acht-Aktionen-Grenze sowie unausgewogene Video-Start-/Stop-Zustände führen **ohne Teiländerung** zum Abbruch.
- Vorhandene Aktionen können pro Wegpunkt **ersetzt oder ergänzt** werden; die aktionsinterne Reihenfolge bleibt erhalten. Alle neuen Daten werden vor dem KMZ-Export nochmals normalisiert.
- Routenumkehr: Wegpunkte und ihre `reachPoint`-Aktionsgruppen werden konsistent umnummeriert. Die Umkehr wird ausdrücklich bestätigt, ist für Video-Start/Stopp, Intervallaktionen, Legacy-Fotos, variable/ungeklärte Höhenbezüge und unbekannte Felder jedoch **gesperrt**.
- Nach einer Umkehr muss die Route erneut hinsichtlich Heading, Gimbal, Kamerablickrichtung, Gelände, Hindernissen, Flugrichtung und RTH geprüft werden. `requiresReview:true`, `headingAndRthRevalidationRequired:true` und `flightReady:false` bleiben bindend.

Zusätzlicher P0-Schutz: Die Bibliothek unterscheidet zwischen einer **nur ausgewählten** Route und dem tatsächlich **in den Editor geladenen** Routenentwurf. Ein Klick auf „Revision speichern“ darf keine nur ausgewählte fremde Route mit einem nicht zugeordneten Entwurf überschreiben. Neue Tests simulieren dafür die Browseroberfläche direkt.

```bash
node --test backend/test/wpml-action-batch.test.js backend/test/wpml-route-library-ui.test.js
```

**Grenze:** Das sind weiterhin Offline-Planungs- und Vorschaufunktionen. Es gibt keine DJI-FlightHub-2-Aktionsparität, keine automatisch validierte Richtungsumkehr bei Video und keinen in SkyHub freigegebenen autonomen Flug.

## Phase 10 – Repository-Identität und datensparsamer Revisionsvergleich (23.10.2026)

Das kanonische Projekt liegt seit der Umbenennung unter
[**mason82-dotcom/SkyHub-Next**](https://github.com/mason82-dotcom/SkyHub-Next).
Alle neuen PR-, Clone- und CI-Verweise verwenden nur diese Adresse.
Die lokale Git-Remote-Umstellung und die notwendige Trennung von
`~/Projekte/SkyHub` (Legacy) sind in der Main-basierten
[WPML-Integrationsprüfung](wpml-main-integration.md) abgegrenzt.
Die ältere Repository-Identitätsprüfung aus dem gestapelten Entwicklungsbranch
wurde **nicht** als neuer Skriptzwang auf `main` übertragen.

**P0-Fortsetzung:** Das lokale Bibliotheksmodell bietet jetzt
`compareRevisions()` und `restoreRevision()`.

- `compareRevisions()` liefert nur die Anzahl geänderter Wegpunktpositionen,
  Höhen-/Fotoattribute, betroffene Profil-Feldnamen und Flags für geänderte
  Action-Groups/Intervalle. **Keine** Koordinaten, Missionsnamen, unverifizierte
  Messwerte oder Dateipfade verlassen den Vergleich. Der Vergleich ist
  positionsbasiert, erkennt aber **keine** sichere geometrische oder
  flugbetriebliche Gleichwertigkeit zweier Routen.
- `restoreRevision()` fügt den vollständig validierten Plan einer früheren
  Revision als **neue Revision** an; die ältere Historie wird nicht geändert.
  In der Browseroberfläche wird dafür eine explizite Bestätigung verlangt.
  Ein möglicherweise abweichender aktueller Editordraft bleibt unverändert.
- `/wpml-route-library.html` bietet zwei zusätzliche Kontrollen:
  „Mit aktueller Revision vergleichen“ und
  „Als neue Revision wiederherstellen“. Nach einer Wiederherstellung muss
  die neue Revision gesondert in den Editor geladen werden, bevor weitere
  Revisionen an die Route angehängt werden können.
- Bestätigte Wiederherstellung und Differenzprüfung funktionieren weiterhin
  **nur lokal im Browser**; die zentrale SQL-Migration ist weiterhin
  deaktiviert, die Berechtigungsprüfung für zentrale Schreibzugriffe offen.

Neue Regressionstests prüfen Revisionsdifferenzen, Historienerhalt,
Fehlzuordnungs-Sperre und eine Browser-Revisionswiederherstellung. Auch hier
bleiben `flightReady:false`, `dispatchAllowed:false` und das Erfordernis
eines eigenständigen DJI-Pilot-2-Hardwaretests unverändert.

## P0 lokale Datensicherung nach der Repository-Umbenennung (Phase 11)

Die Seite `/wpml-route-library.html` unterstützt jetzt eine **explizite lokale JSON-Sicherung** und eine zweistufige Wiederherstellung:

1. `Bibliothek als JSON sichern` zeigt zuerst eine Bestätigung, dass die exportierte Datei **alle Wegpunkt-Koordinaten, Routennamen, Kamera- und Missionsparameter UNVERSCHLÜSSELT** enthält. Ohne Bestätigung wird keine Datei erzeugt. Die Download-Datei bleibt lokal auf dem Benutzergerät.
2. `Gesicherte lokale JSON-Datei wählen` liest höchstens **512 KiB UTF-8** direkt im Browser. Eine streng geprüfte JSON-/Schema-Validierung mit **doppelter-Schlüssel-Erkennung** lehnt mehrdeutige, unvollständige oder manipulierte Dateien ab. Vor dem Speichern wird nur eine redigierte Vorschau aus **Anzahlen** angezeigt (Routen, Revisionen, Wegpunktvorkommen); niemals GPS, Namen, Pfade oder Rohdaten.
3. `Geprüfte Sicherung übernehmen` verlangt eine **zweite ausdrückliche Bestätigung** für das vollständige Ersetzen der bisher lokal gespeicherten Bibliothek. Vorher bleibt `localStorage` unverändert. Ein abgebrochener asynchroner Dateilesevorgang kann keine spätere Freigabe reaktivieren.
4. Nach erfolgreicher Übernahme werden die aktive Routenbindung und die Auswahl aufgehoben. Der aktuell geöffnete Editorentwurf bleibt als **nicht automatisch gespeicherter Entwurf** erhalten. Eine importierte Revision muss ausdrücklich neu geladen werden.

**Wichtige Grenzen:** Eine JSON-Backupdatei ist **keine verschlüsselte Sicherung**, kein geräteunabhängiges Cloud-Backup, keine DJI-WPML-KMZ-Datei und kein Flugauftrag. Die vollständige Bibliothek wird aus technischen Gründen höchstens bis 512 KiB lokal gespeichert; größere Exporte/Importe werden ohne Teilerfolg abgelehnt. Es findet **kein** Dateiupload an SkyHub-, DJI- oder andere Backend-Endpunkte statt. Wer den Browser-Speicher löscht, ohne eine Sicherung anzulegen, verliert die lokalen Bibliotheksdaten.

Sicherheitsregeln für Sicherungen: `schema:skyhub-local-waypoint-backup-v1`, eng begrenzte erlaubte Objektfelder, vollständige Offline-Missionsvalidierung pro Revision, keine implizite Erhöhung von `flightReady` oder `dispatchAllowed`. Alte oder fremde JSON-Formate werden nicht automatisch interpretiert.

```bash
node --test backend/test/wpml-route-backup.test.js backend/test/wpml-route-library-ui.test.js
```

Die weiterhin geplante zentrale P0-PostGIS-Bibliothek (Migration `003_wpml_route_library_draft.sql`) bleibt **nicht aktiviert**. Der sichere Browser-Sicherungsprozess ist kein Ersatz für serverseitige Rollenprüfung, Mandantentrennung, Audit-Logging oder Backup-Verschlüsselung.
