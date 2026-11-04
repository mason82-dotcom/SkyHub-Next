# Entwurf: Missionsfreigabe, NDVI, TAK/CloudTAK (04.11.2026)

**Referenz:** DJI Cloud API **1.18** (Demo-SDK in `third_party/dji-cloud-api-demo`, Feldabgleich `docs/dji-118-field-audit.md`).
**Risiken:** `docs/risikoanalyse-missionsversand-ndvi-tak-2026-11-04.md` (IDs M*, N*, T*, B*).

## 1. Anforderungen

| | Funktional | Nicht funktional |
|---|---|---|
| Missionsfreigabe | Route (WPML-Revision) prüfen, freigeben, zurückziehen; Pilot 2 sieht nur freigegebene, gültige Revisionen | Nie ein Start oder Steuerbefehl aus SkyHub; Freigabe nachvollziehbar (wer, wann, welcher Hash, welche Prüfungen); fail-closed |
| NDVI | Aus M3M-Aufnahmen (G/R/RE/NIR, TIFF + XMP) NDVI berechnen, Kalibrierstatus je Aufnahme, Vorschau und GeoTIFF | Läuft getrennt vom Backend; begrenzter Speicher; Ergebnis reproduzierbar (Eingangs-Hashes) |
| TAK | Drohnen (und optional Piloten) als CoT an TAK Server (TLS) oder Multicast-SA im LAN | Nur ausgehend; Standard aus; keine veralteten Positionen; Geheimnisse nur als Dateien |

**Annahmen.** Ein bis zwei Fluggeräte, ein Workspace, ein Heimnetz. Telemetrie 0,5–1 Hz je Gerät. Eine Route hat höchstens einige
tausend Wegpunkte. NDVI-Serien bis einige hundert Aufnahmen (je 4 Bänder à ~2,5 MB).

## 2. Überblick

```
                 Browser (Dashboard, Routeneditor)           DJI Pilot 2 (RC Pro / RC Plus 2)
                         │ HTTPS (Caddy, Pi)                         │ HTTPS (Caddy, Pi)
                         ▼                                           ▼
┌──────────────────────────────── Backend (Node.js, brix-node) ──────────────────────────────────┐
│ WPML-Speicher ──► Flughüllen-Prüfung ──► Freigabe-API ──► Freigabe-Tabelle (PostgreSQL)          │
│   (MinIO, write-once)   (mission-envelope)   (Admin-Token)       │                                │
│                                                                 ▼                                │
│                                     Wayline-Bibliothek (Pilot 2): nur gültige Freigaben           │
│                                                                                                  │
│ MQTT-Eingang ──► Registry (Live-Zustand) ──► CoT-Ausgang ──► TAK Server (TLS 8089) / Multicast   │
│                                                                                                  │
│ NDVI-API ──► Auftrag (PostgreSQL) ◄── NDVI-Worker (Python, eigener Container) ──► MinIO-Ergebnis   │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 3. Missionsfreigabe (Phase 1)

### Ablauf
1. Route wird wie bisher im WPML-Speicher abgelegt (write-once, ID = aus dem SHA-256 abgeleitete UUID).
2. **Prüfen** (`POST /api/wpml/missions/:id/check`, lesend): Flughülle aus `waylines.wpml` berechnen und gegen Grenzen prüfen.
3. **Freigeben** (`POST /api/wpml/missions/:id/release`): nur mit **Freigabe-Token** (`SKYHUB_MISSION_RELEASE_TOKEN`, ≥ 32
   Zeichen, getrennt vom Ansichts-Token), nur ohne Prüffehler, mit ausdrücklicher Bestätigung jeder Warnung und der Checkliste
   (Luftraum geprüft, Sichtflug, Zielgerät). Speichert SHA-256, Zielgerät, Prüfergebnis, Ablauf, Quelle.
4. **Pilot 2** listet nur Revisionen mit gültiger Freigabe (nicht abgelaufen, nicht zurückgezogen, Hash stimmt mit dem Objekt
   überein); `…/waylines/:id/url` liefert nur für diese eine Download-URL.
5. **Zurückziehen** (`DELETE …/release`): sofort aus der Bibliothek. Eine neue Freigabe einer Revision derselben Wurzel ersetzt die
   vorige (je Routenfamilie höchstens eine freigegebene Revision).

### Oberfläche (`frontend/public/missionsfreigabe.html`, Stand 04.11.2026)
Liste der Routen auf dem Server mit Status „in Pilot 2 sichtbar bis …“ (`GET /api/wpml/release`; `visible` nach denselben Regeln wie
die Pilot-2-Bibliothek: Hash und Fluggerät müssen noch passen), Prüfung mit Flughülle, Fehlern, einzeln zu bestätigenden Warnungen und
Checkliste, Gültigkeit in Stunden, Freigeben und Zurückziehen mit Grund, Verlauf. Lesen geht im Heimnetz ohne Token, wenn der
WPML-Heimnetzzugang eingeschaltet ist (`wpml-lan-auth.js`); Freigeben und Zurückziehen brauchen immer SkyHub-Zugang **und**
Freigabe-Token. Tokens werden nicht gespeichert. Erreichbar über die Routenverwaltung und die Übersicht.
Offen: Prüfmeldungen kommen englisch vom Server (die Bestätigung erfolgt mit dem exakten Text); eine deutsche Anzeige wäre zusätzlich.

### Flughülle (`backend/mission-envelope.js`)
Aus `wpmz/waylines.wpml` (ausführbare Datei, DJI WPML 1.0.x laut 1.18):
- Höhenmodus `wpml:executeHeightMode`: `relativeToStartPoint` (Höhe relativ zum Start), `realTimeFollowSurface` (Höhe über Grund),
  `WGS84` (ellipsoidisch). Bei `WGS84` ist die Höhe über dem Start nur mit `wpml:takeOffRefPoint` (Template, Breite, Länge, Höhe)
  berechenbar; fehlt er, ist das ein **Fehler**.
- Je Wegpunkt `wpml:executeHeight`, `wpml:waypointSpeed`, Koordinaten; global `wpml:autoFlightSpeed`, `wpml:globalRTHHeight`,
  `wpml:takeOffSecurityHeight`.
- Kennzahlen: maximale/minimale Höhe über Start, maximale Geschwindigkeit, Streckenlänge (Haversine), geschätzte Flugzeit
  (Strecke / Geschwindigkeit je Abschnitt), größte Entfernung vom ersten Wegpunkt bzw. Startpunkt, kleinster Wegpunktabstand.
- Grenzen (Konfiguration, konservative Standardwerte): Höhe ≤ 120 m, RTH-Höhe ≤ 120 m, Geschwindigkeit ≤ 15 m/s (DJI-Wert aus dem
  bestehenden WPML-Test), Flugzeit ≤ 25 min, Entfernung ≤ 2 000 m, Wegpunktabstand ≥ 0,5 m (Warnung). Fehler blockieren.

### Datenmodell (PostgreSQL, `CREATE TABLE IF NOT EXISTS` beim Start wie bei der HMS-Historie)
```
wpml_mission_release(
  id bigserial PK, wayline_id uuid NOT NULL, root_id uuid NOT NULL, sha256 char(64) NOT NULL,
  drone_model_key text NOT NULL, payload_model_keys text[] NOT NULL,
  envelope jsonb NOT NULL, acknowledged jsonb NOT NULL,
  released_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, released_from inet,
  revoked_at timestamptz, revoked_from inet, revoke_reason text)
UNIQUE (root_id) WHERE revoked_at IS NULL          -- höchstens eine aktive Freigabe je Routenfamilie
```
Abgelaufene Freigaben bleiben als Audit stehen.

### Entscheidungen und Abwägungen
- **Freigabe in PostgreSQL statt als MinIO-Metadaten:** Objekte sind write-once; Freigaben ändern sich. PostgreSQL gibt
  Transaktion und Eindeutigkeit (eine aktive Freigabe je Familie). Nachteil: Bibliothek braucht beide Speicher; fällt PostgreSQL
  aus, zeigt Pilot 2 **nichts** (fail-closed, gewollt).
- **Eigenes Freigabe-Token statt Rollenmodell:** klein, passt zum bestehenden Einzel-Token-Modell; ein echtes Benutzer-/Rollenmodell
  wäre später der Schritt bei mehreren Personen.
- **Flugaufträge nur an Fluggeräte, über Pilot 2:** 1.18 kennt `flighttask_*` nur für Docks (`AbstractWaylineService`,
  `exclude = GatewayTypeEnum.RC`). Die Freigabe nennt Fluggerät und Nutzlast aus der KMZ; Routen für die nur am Dock fliegenden
  Matrice 3D/3TD/4D/4TD (Typ 91/100) werden nicht freigegeben.
- **Docks (Entscheidung 04.11.2026):** keine Dock-Hardware vor Ort. Der Dock-Code im Backend (Profile, HMS, `dji-flighttask-*`)
  bleibt unverändert; die Oberfläche blendet Docks (Domäne 3) und Dock-Fluggeräte aus (`index.html`, `shownDevice`).

## 4. NDVI (Phase 2)

- **Worker** `backend/workers/m3m_ndvi.py` in eigenem Container (`skyhub-ndvi-worker`, Speicherlimit), Bibliotheken wie die
  bestehenden M3M-Werkzeuge (`m3m_requirements.txt`: NumPy, rasterio, tifffile, defusedxml).
- **Kalibrierkette je Band** (DJI-Multispektral-Leitfaden für M3M):
  Rohwert − Black Level → Vignettierungskorrektur (Polynom aus XMP `VignettingData`, Zentrum `CalibratedOpticalCenter`) →
  ÷ (Sensor-Gain · Belichtungszeit) → Bestrahlungsnormierung mit dem Sonnenlichtsensor (`Irradiance`, Kalibrierfaktor
  `SensorGainAdjustment`) → Reflexion. Fehlt ein Glied: Status `relative` statt `calibrated`, Ausgabe nur als relativer Index.
- **Bandausrichtung:** R und NIR werden auf das G-Band registriert (Phasenkorrelation, Verschiebung + Maßstab aus
  `RelativeOpticalCenter`); Qualitätsmaß Korrelation; unter Schwelle verworfen (N2).
- **Ergebnis:** NDVI = (NIR − R)/(NIR + R) als Float32-GeoTIFF (Cloud-optimiert) + PNG-Vorschau mit fester Farbskala, Manifest mit
  Eingangs-Hashes, Kalibrierstatus, Ausrichtungsgüte; in MinIO `mapping-results/ndvi/<auftrag>/`.
- **Aufträge:** Tabelle `ndvi_job` (Status queued/running/done/failed); Worker holt per `SELECT … FOR UPDATE SKIP LOCKED`.

## 5. TAK/CloudTAK (Phase 3)

- **CoT-Erzeugung** `backend/tak-cot.js`: je Gerät mit frischer, gültiger Position ein `<event version="2.0">` mit
  `uid="SKYHUB-<sn>"`, `type="a-f-A-M-H-Q"` (befreundet, Luft, militär. Drehflügler-UAV, übliche UAS-Kennung in ATAK; konfigurierbar),
  `how="m-g"`, `time`/`start` = Quellzeit, `stale` = +15 s, `<point lat lon hae ce le>` (hae aus Höhe über Ellipsoid, falls vorhanden,
  sonst `9999999`), `<detail>` mit `<contact callsign>`, `<track course speed>`, `<__group>` und `<remarks>` (Modell, Akku).
  Pilot (RC-Position) optional als `a-f-G-U-C` (Bodeneinheit).
- **Transporte** `backend/tak-output.js`:
  - TAK Server: TLS-Stream (Standard 8089), Client-Zertifikat + Schlüssel + CA aus Dateien, Wiederverbindung mit Backoff,
    Nachrichten ohne Puffer über 30 s (veraltet = verwerfen).
  - Multicast SA: UDP 239.2.3.1:6969, TTL 1, nur bei `SKYHUB_TAK_MULTICAST_ENABLED=true`.
  - CloudTAK spricht mit dem TAK Server; SkyHub braucht keine eigene CloudTAK-Schnittstelle (CloudTAK zeigt, was der Server verteilt).
- **Takt:** 1 Hz je Gerät, nur bei geänderter Position oder spätestens alle 5 s (Herzschlag), nie 0/0, nur verifizierte frische
  Quellzeit (T3).
- **Status:** `/api/tak/status` (verbunden, gesendet, verworfen, letzte Fehlermeldung ohne Geheimnisse).

## 6. Betrieb, Überwachung

- Health-Endpunkt erweitert um `missionRelease` (aktiv, Anzahl aktiver Freigaben), `tak` (Transport, verbunden), `ndvi` (Warteschlange).
- Pi-Hub prüft `/api/health` bereits; neue Felder erscheinen dort ohne Änderung.
- Speicher: Freigaben wenige KB; NDVI-Ergebnisse ~10 MB je Feldaufnahme; TAK nichts.

## 7. Später neu bewerten
- Rollen/Benutzer statt Einzel-Token, sobald mehrere Personen freigeben.
- Geo-Zonen-Abgleich (dipul-GeoJSON) in der Flughülle (M3).
- Orthomosaik-NDVI statt Einzelbild (ODM/DEDAL-Pfad aus den bestehenden Workern).
- TAK eingehend (z. B. Sperrgebiete als Overlay) nur mit eigener Risikoanalyse (T2).

## 8. Korrektur 04.11.2026: Cloud-Fernsteuerung über Pilot 2 (DRC)

Die Annahme „Steuerbefehle aus der Cloud nur über ein Dock“ war falsch. Sie stützte sich auf das Demo-SDK in `third_party`, das
älter ist als der 1.18-Stand. Die DJI-Referenz (developer.dji.com, *Pilot Feature Set → Live Flight Controls*,
*pilot-to-cloud/mqtt/dji-rc-plus-2/drc* und */remote-control*; im 1.18-Feldkatalog des Projekts belegt durch
`cloud_control_auth` und `drc_state` der RC Plus 2) sieht vor:

| Gerät | Cloud-Steuerung |
|---|---|
| Matrice 4E/4T + RC Plus 2 | Flug und Nutzlast: `drc_mode_enter`, Knüppelsteuerung, fly-to (ein Zielpunkt, ändern, abbrechen), one-key-takeoff, one-key-return / cancel-return, Not-Aus, Notlandung, erzwungene Landung, ~30 Nutzlastbefehle |
| Mavic 3E/3T/3M + RC Pro | nur Nutzlast (Gimbal, Zoom, Wärmebild); Pilot fliegt weiter mit den Knüppeln |

Voraussetzungen und Folgen laut DJI: Der Pilot muss eine Anfrage auf der RC bestätigen (`cloud_control_auth_request`);
**während der Cloud-Steuerung sind Drehrad, Knüppel, Rückkehr- und Not-Aus-Taste der RC wirkungslos**; DJI empfiehlt einen
eigenen MQTT-Broker für die DRC-Verbindung. Flugaufträge (`flighttask_*`) gibt es für RC-Gateways weiterhin nicht.

SkyHub implementiert das **nicht**. Es wäre ein eigenes Vorhaben mit eigener Risikoanalyse: Die Cloud wird zum Steuerer,
die RC verliert ihre Notfallfunktionen.
