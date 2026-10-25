# DJI-Kartenelemente: lesender Adaptervertrag

Stand: 21.10.2026. Referenzversion ist **DJI Cloud API 1.18**, laut [offizieller chinesischer Release-Seite](https://developer.dji.com/doc/cloud-api-tutorial/cn/) am 13.10.2026 veröffentlicht. Die englische DJI-Startseite zeigt noch einen älteren Versionsstand. Die 1.18-Release-Liste nennt neue O4-Ground-Station- und Dock-Funktionen; Änderungen am Pilot-2-Kartenelementvertrag werden dort nicht genannt. Das ist ein Abgleich der Release-Liste, keine Behauptung, dass jede Kartenelement-Implementierung bereits auf Pilot 2 abgenommen wurde.

DJI Pilot 2 ruft beim SkyHub-Cloud-Server `GET /map/api/v1/workspaces/{workspace_id}/element-groups` auf; SkyHub muss die Gruppen aus seiner eigenen Ablage liefern. DJI stellt dafür keinen separaten Cloud-GET-Dienst bereit, den SkyHub als Client abfragen könnte. Der Pilot-2-Workflow benötigt außerdem die passende App-Shared-Gruppe und reagiert auf WebSocket-Aktualisierungen mit einem erneuten Gruppenabruf.

Der reine Normalisierer `backend/map-element-contract.js` prüft und normalisiert eine bereits geparste Hülle in genau diesem Antwortformat. Er hat keinen Netzwerk-, Datenbank- oder MQTT-Zugriff und ist weder ein DJI-Client noch in die laufende API eingebunden. Eine spätere SkyHub-Route muss Berechtigung, Workspace-Zuordnung, Speicherung und Antwort erst selbst sicherstellen.

> **Integrationsstand 23.10.2026:** Das Datenmodell und der GET-Adapter sind
> im Main-Repository vorhanden und isoliert SQL-getestet. Die Migrationen 001/002
> werden vom Root-Compose **nicht** automatisch bei bestehenden Datenbanken
> angewendet; die Map-Flag wird nicht an das Backend weitergereicht. Damit
> sind „Quellcode vorhanden“, „SQL isoliert getestet“ und „in Pilot 2 aktiv“
> ausdrücklich verschiedene Zustände. [Projektstand](projektstand-2026-10-23.md).

## Separater Speicherentwurf

`backend/db/migrations/001_dji_map_elements.sql` ist ein additiver, noch nicht angewendeter Entwurf. Gruppen und Elemente werden zusammengesetzt nach Workspace, Gruppe und DJI-ID abgegrenzt; Geometrie wird als JSONB gespeichert, damit GeoJSON und optionale Höhenwerte erhalten bleiben. Die Fremdschlüsseldefinition löscht Elemente nicht kaskadierend. Das SQL ist weder Teil des Serverstarts noch gegen eine Datenbank ausgeführt. Vor einer Integration braucht es eine isolierte PostGIS-Migration samt Backup-/Wiederherstellungstest und eine Berechtigungsentscheidung.

`backend/map-element-store.js` stellt darauf aufbauend einen Leseadapter bereit. Er akzeptiert nur UUID-Workspace-IDs, nutzt einen parametrisierten `SELECT`, erhält leere Gruppen, prüft gespeicherte Geometrien vor der Antwort erneut und serialisiert die normalisierten Werte in DJIs Wire-Format (`is_lock`, Zeitstempel mit Unterstrichen und `resource.content`). Die GET-Route ist nur bei `SKYHUB_DJI_MAP_ELEMENTS_ENABLED=true` und vollständiger Pilot-Konfiguration registriert; sie verlangt HTTPS, `x-auth-token` und die konfigurierte Workspace-ID. `group_id` und `is_distributed` werden als begrenzte Filter behandelt (Standard für `is_distributed`: `true`). Ohne Datenbank antwortet sie mit 503. Caddy leitet den Pfad zum Backend weiter, aber die Konfiguration wurde hier nicht neu geladen. Store- und Handler-Tests verwenden Fake-Abhängigkeiten und führen kein SQL gegen eine Datenbank aus.

Die Route lädt noch nicht das DJI-JSBridge-API-Modul in Pilot 2. Das bleibt bis zum isolierten Datenbanktest und Hardware-Abnahme deaktiviert; `.env.example` setzt die Feature-Flag auf `false`.

## Eingang und Ausgabe

- Erwartet wird die DJI-Hülle `{code: 0, data: [...]}`. Eine fehlerhafte Hülle oder Gruppe wird abgewiesen. Gruppen brauchen ID und Elementliste. Fehlende optionale Namen fallen auf die ID zurück; unbekannter Typ und Sperrstatus bleiben `null`. Typ `2` bezeichnet die App-Shared-Gruppe, die Pilot für die Synchronisierung benötigt.
- Pro gültigem Element werden ID, Name, Geometrieart, gültige WGS84-Koordinaten im GeoJSON-Format `[Länge, Breite, optionale Höhe]`, bekannte Darstellungsattribute und Zeitstempel übernommen. Unbekannte Felder werden nicht weitergereicht. Ein fehlerhaftes oder doppelt vorhandenes Element wird gezählt und ausgelassen; andere Elemente der Gruppe bleiben erhalten.
- Darstellungsart ist die GeoJSON-Geometrie `Point`, `LineString` oder `Polygon`. `resource.type` bleibt separat als Diagnosewert erhalten. Die DJI-Beispiele markieren Linien und Polygone teils mit `resource.type: 0`; daraus darf die Darstellungsart nicht abgeleitet werden.
- Offene Polygonringe (Außenring und Löcher) werden nur in der **lesenden Kopie** geschlossen und Löcher in ihrer GeoJSON-Reihenfolge erhalten. Die Eingabe bleibt unverändert. Ungültige Koordinaten, degenerierte Linien/Flächen und unbekannte Geometrien werden ausgelassen. Grenzen: 100 Gruppen, 5000 Elemente insgesamt, 2000 Eckpunkte je Element über alle Ringe einschließlich ergänzter Ringschlüsse.

## Noch nicht an die produktive API anbinden

Die bestehende Tabelle `map_annotations` hat numerische IDs, keine Workspace- und Gruppenbindung sowie keinen DJI-Elementvertrag. Sie ist keine App-Shared-Gruppe. Für eine spätere Synchronisierung braucht es ein eigenes Schema mit Workspace-, Gruppen- und Element-IDs, Sperrstatus, Zeitstempeln und klarer Mandantentrennung. Migration, Schreibrechte und Hardware-Abnahme erfolgen getrennt.

Der spätere Schreibpfad muss die [Create](https://developer.dji.com/doc/cloud-api-tutorial/cn/api-reference/pilot-to-cloud/https/map-elements/create.html)-, [Update](https://developer.dji.com/doc/cloud-api-tutorial/cn/api-reference/pilot-to-cloud/https/map-elements/update.html)- und [Delete](https://developer.dji.com/doc/cloud-api-tutorial/cn/api-reference/pilot-to-cloud/https/map-elements/delete.html)-Routen gegen Rollen, Gruppensperre, Workspace-Zugehörigkeit und Konflikte prüfen. Der lesende Heimnetzzugang erhält keine Schreibrechte. Nach bestätigter Speicherung müssen [WebSocket-Meldungen](https://developer.dji.com/doc/cloud-api-tutorial/cn/api-reference/pilot-to-cloud/websocket/map-elements/message-push.html) und ein erneuter Gruppenabruf bei `map_group_refresh` konsistent sein. Ereignisse dürfen keinen unbestätigten Erfolg vortäuschen.

Quellen: [DJI Cloud API 1.18 Release](https://developer.dji.com/doc/cloud-api-tutorial/cn/), [Elementliste und Beispieldaten](https://developer.dji.com/doc/cloud-api-tutorial/cn/api-reference/pilot-to-cloud/https/map-elements/obtain.html), [Pilot-2-Kartenelemente](https://developer.dji.com/doc/cloud-api-tutorial/cn/feature-set/pilot-feature-set/pilot-map-elements.html), [WebSocket-Elementmeldungen](https://developer.dji.com/doc/cloud-api-tutorial/cn/api-reference/pilot-to-cloud/websocket/map-elements/message-push.html).

## Zugriffssicherung seit P2: getrennte Workspace-Rollen

Vor dem SQL-Lesezugriff wird der Principal über [DJI-Kartenrollen](dji-map-access.md) geprüft. Die DJI-Pilot-Identität darf nur verteilte Kartengruppen (`is_distributed=true`) ihres gespeicherten Workspaces abrufen; `is_distributed=false` liefert für sie 403 ohne Datenbankabfrage. Das frühere Server-Flag aktiviert weiterhin nur den GET-Pfad und bleibt standardmäßig aus. Ein Dashboard-Viewer-Token und eine anonyme LAN-Ansicht berechtigen nicht zum DJI-Kartenelementzugriff. Rollen `operator`/`admin` sind bislang nur ein isoliert getesteter Vertragsentwurf und werden nicht von der aktuellen Authentifizierung ausgestellt. Historische Pilot-Geräte ohne gespeicherte Workspace-Bindung müssen für DJI-Karten erneut gekoppelt werden. Nicht enthalten: reale Privilegierungsverwaltung, Schreib-API und WebSocket-Synchronisierung.
