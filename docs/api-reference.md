# HTTP-, Socket.IO- und MQTT-Schnittstellen – verifizierte Main-Basis

**Historische Tabellenbasis 23.10.2026 –** `main` @ `496a1f84f22b15f85ad5442965b2cd218a93969a`. **Korrekturabgleich 25.10.2026:** [`main` @ `662cb94d`](stand-2026-10-25-main-audit.md). Grundlage: `backend/server.js`, `backend/map-element-api.js`, `backend/lan-access.js`, `backend/pilot-config.js` und `docker-compose.yml`. Keine automatische Aussage über gestapelte Feature-PRs oder das aktuell laufende Pi-Image.

## Authentifizierungsmodelle

- **View:** `Authorization: Bearer <SKYHUB_VIEW_TOKEN>` schützt das gewöhnliche `/api`-Dashboard; für Socket.IO gilt `handshake.auth.token`. Der Token ist ausschließlich ein lesender Zugang für das operative Dashboard, **keine** Pilot-Admin-Rolle im DJI-Kartensystem.
- **LAN-Ausnahme (opt-in):** Nur bei `SKYHUB_LAN_VIEW_CIDR`. Ein kontrollierter Reverse-Proxy ist zwingend; nur die explizite GET-Allowlist und Socket.IO sind tokenfrei. Anfragen zu Pilot-Verwaltung, DJI-Feldmodell-/modellbezogenen MQTT-Diagnosen und Schreiboperationen sind **nicht** durch die LAN-Allowlist freigeschaltet.
- **Pilot:** Separate HTTPS-Pilot-Konfiguration plus Pilot-Zugriffstoken oder über Redis verifizierter Pairing-Token, je nach Route. Pairing-Start und -Poll verlangen HTTPS, haben jedoch bewusst **kein vorab ausgegebenes Operator-Token**; eine Freigabe erfolgt später über die geschützte Administration.
- **DJI-Kartengruppen:** Separater `x-auth-token` (kein View-Token), exakte Workspace-UUID und Pilot-RBAC, TLS/HTTPS zwingend. Bei Pilot-Identitäten ausschließlich verteilte Gruppen.
- **Health:** `/api/health` ist ohne Token erreichbar, darf aber nicht als Gesamtbereitschaft interpretiert werden.

Die Trennung ist im Code implementiert; produktive Proxy-/ACL- und Gerätefreigaben sind **separate Betriebsprüfungen**.

## Tatsächlich gemountete Main-HTTP-Routen

| Methode | Route | Zugriff / Codeverhalten |
| --- | --- | --- |
| GET | `/` | Statisches Hauptdashboard; Port standardmäßig nur Host-Loopback |
| GET | `/pilot-login` | Statische Pilot-2-Webview, mit CSP |
| GET | `/api/health` | Ohne Token; aggregierte Status-/MQTT-/Topologie-/Track-Zähler, `online`/`degraded` beschreibt zunächst Broker+Subscription, keine Flugsicherheit |
| GET | `/api/pilot/status` | Ohne Token; begrenzte Pilot-Konfigurationsbereitschaft, fehlende **Schlüsselnamen**, keine Secret-Werte |
| GET | `/api/devices` | View oder freigegebene LAN-GET-Ausnahme; Live-Registry-Snapshot |
| GET | `/api/topology` | View oder LAN-GET-Ausnahme; begrenzte Rollen-/Gateway-Topologie |
| GET | `/api/events` | View oder LAN-GET-Ausnahme; normalisierte Geräteereignisse |
| GET | `/api/diagnostics/mqtt-shapes` | View oder LAN-GET-Ausnahme; aggregierte Feld-/Topic-Formen |
| GET | `/api/diagnostics/mqtt-model-shapes` | **View-Token erforderlich**, keine LAN-Ausnahme; modellbezogene Feldnamen |
| GET | `/api/diagnostics/dji-fields?model=…` | **View-Token erforderlich**, keine LAN-Ausnahme; bekannte 1.18-Schemafelder; **Regex-Fehler mit [PR #61](https://github.com/mason82-dotcom/SkyHub-Next/pull/61) behoben und HTTP-getestet**; sechs bekannte Modelle, unbekannte Schlüssel 404, ungültige Syntax 400 |
| GET | `/api/drone/:sn/telemetry` | View oder LAN-GET-Ausnahme; konkreter zuletzt bekannter Geräte-Snapshot |
| GET | `/api/drone/:sn/track?minutes=60` | View oder LAN-GET-Ausnahme; historische PostGIS-Punkte, `minutes` 1–1440, Default 60 |
| POST | `/api/pilot/bootstrap` | Pilot-Konfiguration + HTTPS + Pilot-/Pairing-Bearer-Token, sonst 503/403/401 |
| POST | `/api/pilot/pair` | Pilot-Konfiguration + HTTPS + Redis; begrenztes Pairing starten, mögliches 429 |
| GET | `/api/pilot/pair/:id` | Pilot-Konfiguration + HTTPS + Redis; Pairing-Abfrage ohne Administrator-Freigabe |
| GET | `/api/pilot/session` | Pilot-Konfiguration + HTTPS + Pilot-/Pairing-Bearer-Token; begrenzte Topologie-Ack-/Telemetriezeiten |
| GET | `/api/pilot-admin/pairings` | View-Token; **nicht** durch LAN-Ausnahme freigegeben; Caddy-LAN-Site blockiert Pilot-Admin |
| POST | `/api/pilot-admin/approve` | View-Token, explizite sechsstellige Pairing-Code-Freigabe; eine **echte Verwaltungsaktion** |
| DELETE | `/api/pilot-admin/devices/:id` | View-Token; Widerruf bereits gekoppelter Geräte, **echte Verwaltungsaktion** |
| GET | `/map/api/v1/workspaces/:workspaceId/element-groups` | **Optionaler** Pilot-Karten-GET-Handler außerhalb des normalen `/api`-Auth-Pfads; erfordert `SKYHUB_DJI_MAP_ELEMENTS_ENABLED=true` *im Prozess*, vollständige Pilot-Konfiguration, HTTPS, `x-auth-token`, gebundenen Workspace und zulässigen `is_distributed`-Filter. Root-Compose reicht das Flag standardmäßig als `false` weiter; Freischaltung erfordert zusätzlich die genannten Pilot-/HTTPS-/Workspace-Prüfungen |

**Wichtig:** Das Wort „read-only“ bezeichnet den Telemetrie-/Flugsteuerungszweck, **nicht** jeden HTTP-Verb. Pairing-Freigabe, Geräte-Widerruf sowie optionale `status_reply`-Topologie-Publikation sind bewusst eingeschränkte zustandsändernde Vorgänge. Sie sind keine DJI-Flugsteuerung. `/api/pilot-admin/*` benötigt zusätzlich eine vertrauenswürdige Betreiber-Zugangsführung; das View-Token selbst ist nicht mit einer separaten rollenbasierten Benutzerverwaltung gleichzusetzen.

## Zusätzliche Main-Routen mit Feature-Gates (25.10.2026)

Diese Routen **existieren im Quellcode**, sind aber nicht sämtlich im Standard-Compose aktiviert. Sie bleiben hinter dem jeweiligen Auth- und Konfigurationsvertrag.

| Methode | Route | Default / Schutz |
| --- | --- | --- |
| GET | `/api/media/status`, `/api/media/buckets`, `/api/media/objects`, `/api/media/m3m/inventory` | `SKYHUB_MEDIA_ENABLED=false`; View-Authentifizierung, explizite S3-Reader-Credentials, kein PUT/DELETE |
| GET | `/api/media-library/v1/workspaces/:workspaceId/assets`, `/assets/:assetId`, `/groups/:groupId/m3m-hints` | `SKYHUB_MEDIA_LIBRARY_ENABLED=false`; zusätzlich View-Bearer und workspace-gebundener Pilot-Token, HTTPS, Redis-Limit, PostgreSQL-Leseaudit und Schema 003–005 erforderlich |
| GET | `/api/dr/minio/status`, `/api/dr/minio/reports` | `SKYHUB_MINIO_DR_ENABLED=true` im Root-Compose; View-Authentifizierung; ohne Reportdaten nicht einsatzbereit |
| GET | `/api/dr/minio/composite` | Zusätzlich `SKYHUB_MINIO_DR_COMPOSITE_ENABLED=true` erforderlich; reiner Berichtszustand |
| GET | `/api/smart-farming/candidates/`, `/api/smart-farming/candidates/:candidateId` | Nur bei `SKYHUB_M3M_CATALOG_ENABLED=true` **im Backend-Prozess**; nicht im unveränderten Root-Compose durchgereicht, Auth-/Transportprüfung, reine Kandidaten-Metadaten |

Die Routen stehen in `backend/server.js`, `backend/media-api.js`, `backend/minio-dr-api.js` und `backend/smart-farming-catalog.js`. Die letzte Änderung bei Main-SHA `662cb94d` ergänzt isolierten Medien-Callback-Code, nicht automatisch eine Pilot-2-Upload- oder Missions-API.

## Socket.IO

- Auth über View-Token in `socket.handshake.auth.token` oder explizit konfigurierte private LAN-Allowlist.
- Beim Verbindungsaufbau `snapshot`; danach `device_update` und `device_event`, **keine** beliebigen Clientschreib-/Flugbefehle.
- Feldzeiten `telemetryFieldAt` und `telemetryFieldTimeVerified` sind **flüchtige Live-Daten**, werden bewusst nicht im Redis-Gerätecache persistiert.
- Neustarts, historische Topologie, neue OSD-Pakete, Messwert-Frische und valide GPS-Position sind getrennte Indikatoren.

## Passive DJI-MQTT-Subscriptions

Der Subscriber in `backend/server.js` abonniert folgende fünf Pattern mit QoS 0:

| Topic | Anwendung |
| --- | --- |
| `sys/product/+/status` | `update_topo` / Gateway-/Subgerät-Topologie |
| `thing/product/+/osd` | Flug-/Controller-OSD, validierte Messwertupdates |
| `thing/product/+/state` | Gerätestatus |
| `thing/product/+/events` | Ereignisse und HMS |
| `thing/product/+/services_reply` | Passiv empfangene Serviceantworten, **keine** Flugbefehle |

Optionale **separate** Publisher-Verbindung für `sys/product/{gateway_sn}/status_reply` nur bei `SKYHUB_TOPOLOGY_ACK_ENABLED=true` und eigenem ACL-eingeschränktem Konto. Keine `services`-, `drc/down`- oder `property/set`-Publikation durch den Main-Backendpfad.

**Integrierte Grenzen:** Retained-Pakete werden abgelehnt, zukünftige/veraltete Quellzeiten begrenzt, ein gültiges GNSS-Paar benötigt Koordinaten im selben OSD-Paket, `(0,0)` ist kein gültiger Fix, Modell-/Kameraeigenschaften werden selektiv normalisiert. Diese Prüfungen ersetzen **keinen** echten DJI-Cloud-API-1.18-Interop-Test aller Geräteklassen.

## Keine produktiven Endpunkte in Main

| Bereich | Nicht gemountet / nicht freigeschaltet |
| --- | --- |
| DJI-Medien | Die vier oben genannten **read-only GET-Endpunkte** sind auf `main` optional vorhanden, aber standardmäßig aus; Pilot-2-Upload/STS und produktive Schreib-Callbacks sind **nicht aktiv gemountet** |
| DJI Waylines | `/api/wpml/inspect` sowie reale Flugplan-Uploads/-Starts nicht in Main |
| DJI-Kartenmutationen | Create/Update/Delete der Karte ausschließlich isolierter Vertrags-/Transaktionsentwurf |
| Vision/Thermal | Kein HTTP-Endpoint für YOLO11, thermische Personendetektion oder Pixel→GPS |
| Smart Farming | Der begrenzte Kandidatenkatalog ist als **opt-in** Main-Code vorhanden; keine produktive M3M-Rohbild-zu-Reflexionskalibrierung, GIS-Tile-Auslieferung oder registrierte NDVI-/NDRE-Automatik |
| Simulation | HiveMind-Lab läuft, soweit aufgerufen, isoliert im zugehörigen Feature-PR, nicht im Main-Compose |

Für neue PRs gelten eigene Router-/Flag-/Lizenz- und Hardwarechecks. Nur ein erfolgreicher Integrationsmerge **plus** explizites Deployment kann die hier genannte Main-Schnittstellenmatrix verändern.

**Querverweise:** [Architektur](architecture.md) · [Konfiguration](config-reference.md) · [Sicherheit](security.md) · [Pilot/MQTT](mqtt-osd-integration.md) · [PR-Register](projektstand-2026-10-23.md).
