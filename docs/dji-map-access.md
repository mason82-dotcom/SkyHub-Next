# DJI-Kartenelemente: Workspace-Rollen und Zugriffsgrenzen (P2)

Stand: 21.10.2026; Aktualisierung der Einordnung 23.10.2026. Der **Lese-/Rollenvertrag liegt auf Main** (Commit `4d878314f8345f8cd370f0004916426523e577c0`), nicht ausschließlich auf einem isolierten Feature-Branch. **Keine Freigabe produktiver Schreibaktionen.** Im unveränderten Main-Root-Compose wird `SKYHUB_DJI_MAP_ELEMENTS_ENABLED` nicht an den Backend-Container weitergegeben; allein die `.env`-Flag aktiviert die Route daher nicht. Siehe [aktueller Projektstand](projektstand-2026-10-23.md).

## Rollen- und Lesevertrag

Die zentrale, testbare Entscheidung liegt in `backend/map-element-permissions.js`. Sie erhält ausschließlich einen **serverseitig** ermittelten Principal mit `role` und UUID-`workspaceId`. Ein Client kann weder seine Rolle noch den zugehörigen Workspace per Header, JSON oder Query-Parameter festlegen. Vor einer Leseoperation müssen der Principal, der Server-Workspace und die angefragte Route exakt übereinstimmen.

| Serverrolle | DJI-GET: verteilte Gruppen (`is_distributed=true`) | DJI-GET: private Gruppen (`is_distributed=false`) | DJI-Create/Update/Delete |
| --- | --- | --- | --- |
| `viewer` | verweigert (Dashboard ist separat) | verweigert | verweigert |
| `pilot` | erlaubt, nur im gebundenen Workspace | verweigert | verweigert |
| `operator` | im reinen Rollenvertrag erlaubt | im reinen Rollenvertrag erlaubt | verweigert |
| `admin` | im reinen Rollenvertrag erlaubt | im reinen Rollenvertrag erlaubt | verweigert |

**Wesentlich:** Der aktive API-Tokenresolver stellt ausschließlich `pilot`-Principals aus. Eine reale Operator-/Administrator-Identität existiert **noch nicht**; die entsprechenden Matrix-Zeilen beschreiben nur einen isoliert getesteten Entwurf für ein späteres Identitäts- und Rollenmanagement. Das bisherige `SKYHUB_VIEW_TOKEN` ist **keine** Operator-/Administrator-Rolle. Es dient weiterhin der vorhandenen Dashboard-/Admin-API mit deren bestehenden Separatregeln und wird von der DJI-Kartenelementroute nicht akzeptiert.

## Identität und Legacy-Kopplungen

- Der konfigurierte `SKYHUB_PILOT_ACCESS_TOKEN` wird ausschließlich in der Pilot-Kartenelementroute als `pilot` eingeordnet; er wird dadurch nicht zu einem Administrator-Token.
- Bei **neuen** freigegebenen DJI-RC-Kopplungen wird die serverseitig konfigurierte `SKYHUB_PILOT_WORKSPACE_ID` zusammen mit dem bereits gehashten Gerätetoken in Redis-Metadaten gespeichert. Kein Workspace-Parameter stammt aus dem Kopplungsantrag.
- Historisch gekoppelte Geräte besitzen noch kein gespeichertes Workspace-Feld. Sie bleiben für den bestehenden Pilot-Bootstrap und die Telemetrieanbindung gültig, erhalten aber **keinen DJI-Kartengruppen-Zugriff**, bis sie für den aktiven Workspace erneut gekoppelt wurden. Ein Workspacewechsel gewährt alten Gerätekennungen keine Rechte auf den neuen Workspace.
- Es gibt weder einen öffentlichen Principal-Introspection-Endpunkt noch neue privilegierte Client-Tokens.

## Implementierung

Die bestehende GET-Route `/map/api/v1/workspaces/:workspaceId/element-groups` verlangt weiterhin HTTPS und `x-auth-token`. Nach erfolgreicher Identifizierung und Workspace-Prüfung wird bei `is_distributed=false` für Pilot-Identitäten **403** zurückgegeben – ohne SQL-Zugriff. Standard ist weiterhin `is_distributed=true`. Ungültige Filter ergeben 400, fehlende Authentifizierung 401, fehlender Workspace 404, nicht verfügbare Datenbank 503. Auth- und SQL-Fehler werden ohne Token-/DB-Details beantwortet.

Die Map-Route wird unverändert nur registriert, wenn `SKYHUB_DJI_MAP_ELEMENTS_ENABLED=true` und die Pilot-Konfiguration vollständig ist. In `.env.example` bleibt die Flag auf **false**. Es werden keine neuen Endpunkte zum Erstellen, Bearbeiten, Sperren oder Löschen registriert, keine WebSocket-Events gesendet und keine DJI-Flugkommandos erteilt. Die Root-Backend-Authentifizierung, die bestehenden Pilot-Bootstrap-Routen, Caddy, MQTT und EMQX werden durch dieses Rollenmodul nicht verändert.

## Prüfungen und Folge-Gates

- Unit-Tests: ungültige Principals, Rollenmatrix, Workspace-Wechsel, ausschließlich geteilte Pilot-Gruppen sowie grundsätzlich verweigerte Schreibaktionen.
- Handler-Tests: Authentifizierung, private Filter **vor dem Datenbankzugriff** verweigern, Header-/Query-Rollenspoofing und redigierte Fehlerantworten.
- Realer isolierter Express-Test: Pilot-Token kann keine privaten Elemente lesen; Dashboard-Viewer-Token und LAN-Zuschauer erhalten keinen DJI-Kartenzugriff.
- Pairing-Tests: serverseitig gespeicherter Workspace und Rückwärtskompatibilität historischer ungefilterter Bootstraps.

Die folgenden Freigaben bleiben **ausdrücklich offen**: echte Operator-/Admin-Authentifizierung und Rollenzuordnung, Gruppen-/Objektberechtigungen und Lock-Semantik, konsistenter Create/Update/Delete-Pfad mit Auditing und konfliktfesten Transaktionen, WebSocket-Refresh, Pilot-2-Hardwareabnahme sowie ein Restore-Test mit realitätsnahen anonymisierten Bestandsdaten. Erst danach dürfen schreibende Funktionen separat entwickelt und aktiviert werden.

## Nächste, isolierte P2-Vorbereitung

Die [Mutationsspezifikation](dji-map-mutation-contract.md) beschreibt einen separaten, noch nicht ausgelieferten SQL-Schreibbaustein mit erwarteter Revision, Audit-Journal und Gruppen-Sperrstatus. `mapAccess()` verweigert weiterhin **alle** Schreiboperationen; insbesondere erhalten Pilot, View-Token und bestehende RC-Kopplungen keinen neuen Schreibzugriff. Die spätere vertrauenswürdige Ausstellung von Operator-/Admin-Principals ist ausdrücklich nicht enthalten.
