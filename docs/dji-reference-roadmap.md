# DJI Cloud API als Referenz für SkyHub Next

> **Planungsabgleich 23.10.2026:** Die folgenden P1/P2-Aussagen dokumentieren den damaligen Hauptbranch/isolierte Entwürfe. Aktuelle Entwicklungen zu Medien-STS, WPML, Smart Farming, Thermal, YOLO11 und Simulator sind ausschließlich im [PR-/Integrationsregister](projektstand-2026-10-23.md) als offenen Branch-Stand ausgewiesen; sie sind nicht als produktive DJI-Funktion freigegeben.

Stand: 21.10.2026. Ausgangspunkt ist die [DJI Tutorial Reading Map](https://developer.dji.com/doc/cloud-api-tutorial/en/tutorial-map.html#tutorial-overview). Diese Einstiegsseite ist ein Wegweiser durch die Cloud API, keine Spezifikation für Kartenelemente. Für konkrete Verträge gelten die jeweils verlinkten DJI-Funktions- und API-Seiten. SkyHub Next übernimmt daraus Funktionen gezielt für den Root-Stack; `stacks/legacy-skyhub/` bleibt Referenz.

**Versionsreferenz:** [DJI Cloud API 1.18](https://developer.dji.com/doc/cloud-api-tutorial/cn/), veröffentlicht am 13.10.2026. Für künftige Arbeit zuerst die aktuelle offizielle Release-Seite und die zugehörigen Funktionsseiten prüfen; die englische Startseite zeigt noch einen älteren Stand. Die 1.18-Release-Liste nennt Ground-Station- und Dock-Erweiterungen, aber keine Änderung am Pilot-2-Kartenelementvertrag. Ein Pilot-Schreibpfad bleibt bis zur gesonderten Abnahme deaktiviert.

## Fachlicher Abgleich

| DJI-Referenz | Konsequenz für SkyHub Next | Stand |
| --- | --- | --- |
| [Cloud-Architektur](https://developer.dji.com/doc/cloud-api-tutorial/en/overview/product-architecture.html): Gateway, Pilot 2 bzw. Dock und Cloud kommunizieren über MQTT, HTTPS und WebSocket. | Gerätetopologie und Telemetrie getrennt von Benutzeraktionen behandeln. Der Browser erhält nur freigegebene Daten. | MQTT-OSD und lesendes Dashboard vorhanden. |
| [Pilot-2-Onboarding](https://developer.dji.com/doc/cloud-api-tutorial/en/feature-set/pilot-feature-set/pilot-access-to-cloud.html): Lizenz, Token, Workspace und Cloud-Modul sind Voraussetzungen. | Diagnose muss „Webseite geladen“, „Pilot verbunden“ und „Telemetrie empfangen“ klar unterscheiden. | Seite, DJI JSBridge, Lizenz, Thing-Modul und MQTT-Status werden separat angezeigt; OSD-Empfang folgt nach Sitzungsprüfung. Hardware-Abnahme offen. |
| [Kartenelemente](https://developer.dji.com/doc/cloud-api-tutorial/en/feature-set/pilot-feature-set/pilot-map-elements.html): Pilot fordert Gruppen per HTTPS vom Cloud-Server an; Aktualisierungen laufen über WebSocket. | SkyHub muss die Serverrouten und einen eigenen Elementspeicher bereitstellen. WGS84-Koordinaten beibehalten; Berechtigungen und Workspace-Zuordnung serverseitig prüfen. | GET-Route und Caddy-Pfad sind implementiert, standardmäßig deaktiviert; Schemaentwurf noch nicht angewendet. |
| [Elementgruppen abrufen](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/https/map-elements/obtain.html), [erstellen](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/https/map-elements/create.html), [aktualisieren](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/https/map-elements/update.html), [löschen](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/https/map-elements/delete.html) und [WebSocket-Meldungen](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/websocket/map-elements/message-push.html). | Pilot-kompatible IDs, Gruppen, GeoJSON, Berechtigungen und Ereignisreihenfolge als eigenen Adapter modellieren. | Nicht implementiert. `map_annotations` ist noch kein DJI-kompatibler Elementspeicher. |
| [Medienverwaltung](https://developer.dji.com/doc/cloud-api-tutorial/en/feature-set/pilot-feature-set/pilot-media-management.html) und [Wayline-Verwaltung](https://developer.dji.com/doc/cloud-api-tutorial/en/feature-set/pilot-feature-set/pilot-wayline-management.html). | Upload, Objektablage, Wiederanlauf und Missionsstatus separat entwerfen und an unterstützter Hardware prüfen. | MinIO optional und derzeit inaktiv; keine Medien- oder Wayline-API. |

## Priorisierte Umsetzung

1. **P1 · Lesende Einsatzkarte.** Geräte aus der Liste auf der Karte finden, alle gültigen Positionen einpassen, fehlende/ungültige Koordinaten erklären und historische `(0, 0)`-Trackpunkte nicht darstellen. Die Kartenlegende zählt jetzt aktuelle, zeitlich ungeprüfte und ältere Positionen getrennt. Das statische Dashboard bietet dazu eine kompakte Geräteliste mit lokaler Suche, Statusfilter und aufklappbaren Messwerten. Karteninteraktion bleibt lesend; es werden keine Befehle an Fluggeräte gesendet.
2. **P1 · DJI-Antwortvertrag isoliert halten.** Der [lesende Elementvertrag](dji-map-element-contract.md), Normalisierer und unverbundene Leseadapter prüfen Gruppenformat, Workspace-Isolation und GeoJSON ohne produktiven Datenpfad. Die DJI-GET-Route ist eine SkyHub-Serverroute für Pilot 2, kein externer DJI-Dienst. Rollen und Sichtbarkeit sind vor der Integration festzulegen. `map_annotations` darf nicht stillschweigend als DJI-Elementgruppe behandelt werden.
3. **P2 · Gemeinsame Kartenelemente.** Eine lesende GET-Route samt Workspace-Bindung, `x-auth-token`, App-Shared-Gruppe und begrenzten Filtern ist implementiert, aber per Feature-Flag deaktiviert. Vor Aktivierung: Rollen festlegen, [additiven Schemaentwurf](dji-map-element-contract.md#separater-speicherentwurf) in separater PostGIS-Testdatenbank samt Wiederherstellung prüfen und das DJI-API-Modul auf Pilot-Hardware validieren. WebSocket-Refresh sowie Create/Update/Delete, Konflikt- und Offline-Verhalten bleiben getrennte Folgearbeiten. Der lesende Heimnetzzugang erhält keine Schreibrechte.
4. **P3 · Medien und Missionen.** MinIO-Speicherort, Backup, Zugriff und Upload-Pfad klären; danach Medienbibliothek und WPML-Lebenszyklus getrennt entwickeln. Keine Mission aus einer bloßen UI-Aktion starten und keinen Status als erfolgreich anzeigen, bevor die Geräteantwort ihn bestätigt.

## UI-Leitlinien

- Die Karte zeigt nur Koordinaten mit gültigem Wertebereich und schließt `(0, 0)` aus. Frische, letzte Meldung und fehlende Position bleiben verständliche Textzustände.
- Karte und Geräteliste verweisen auf dieselbe Gerätekennung. Jede reine Kartenaktion hat eine bedienbare Alternative in der Liste.
- Warnungen behalten ihre fachliche Bedeutung; Farbe allein transportiert keinen Alarm oder Verbindungsstatus. Tastaturfokus und schmale Displays bleiben nutzbar.
- Schreibaktionen für gemeinsame Elemente erhalten einen eigenen Rechte- und Bestätigungsfluss. Die aktuelle Monitoring-Seite suggeriert keine verfügbaren Flug- oder Missionsbefehle.

Die DJI-Seiten beschreiben Protokoll und Interaktionen, aber liefern keine unmittelbare Freigabe für SkyHub-Next-Deployments, MQTT-ACL-Änderungen, Medienaktivierung oder Änderungen an produktiven Daten.

## Isolierter Datenbanknachweis vor Pilot-2-Aktivierung (21.10.2026)

Zur P1/P2-Grenze wurde ein optionaler PostGIS-Integrationstest mit dedizierter CI-Testdatenbank ergänzt: DDL mit Wiederholung und Savepoint-Rollback, Workspace-Fremdschlüssel, Filter, leere DJI-Gruppen, invalides GeoJSON sowie historische Flugspur/Retention. Der Codepfad bleibt aus, bis die eigentliche Pilot-Hardwareabnahme, die Rollenentscheidung und eine separate Dump-/Restore-Probe erledigt sind. Ablauf und Grenzen: [PostGIS-Isolationstest](postgis-isolated-validation.md). Der offene Repository-Cleanup-PR #4 bleibt davon unabhängig.

## P1 Backup-/Restore-Absicherung für DJI-Kartenelemente

Für den bislang ausstehenden Wiederherstellungsnachweis wurde ein CI-isolierter `pg_dump`/`pg_restore`-Durchlauf mit synthetischen Kartenelementen aus zwei Workspaces und PostGIS-Flugspur ergänzt. Die aus dem Dump frisch wiederhergestellte Datenbank wird auf workspace-gebundene Gruppen, Geometrie, Indexe und Fremdschlüssel geprüft. Diese technische Absicherung ändert **nicht** die Roadmap-Freigabeschranken: echtes Backup-/Recovery-Verfahren für einen anonymisierten Pi-Datenbestand, Rollen-/Berechtigungsentscheidung und Pilot-2-Hardwareabnahme sind weiterhin offen. Details unter [PostGIS-Validierung](postgis-isolated-validation.md).

## P2 · Workspace-Rollen und DJI-Kartengruppen (21.10.2026)

Der [Workspace-Rollenvertrag](dji-map-access.md) ist als isoliertes, fehlertolerantes RBAC-Modul umgesetzt und mit Unit-, Handler- und HTTP-Tests abgesichert. Der produktiv vorgesehene Tokenresolver gibt ausschließlich **Pilot-Read-Only** zurück, erlaubt nur `is_distributed=true` und bindet neue RC-Kopplungen an den serverseitigen Workspace. Ältere Kopplungen ohne Workspace-Zuordnung bleiben zum Bootstrap gültig, nicht aber für Kartenelemente. Operator/Admin werden derzeit **nicht** als reale Rollen ausgegeben. Create/Update/Delete und WebSocket-Refresh bleiben deaktiviert. Der Pilot-2-Hardwaretest und eine spätere Freigabe konkreter Operatorrollen stehen aus.

## P2 · Konfliktfeste Schreibtransaktionen als isolierter Entwurf (21.10.2026)

Nach dem Read-only-RBAC-Schutz ist ein [interner Mutationsvertrag](dji-map-mutation-contract.md) für DJI-Kartenelemente ergänzt: eine additive, **nicht angewendete** Revisions-/Auditmigration, ein vom Server entkoppelter Transaktionsbaustein mit gruppenweiser SQL-Sperre, Versionsvergleich (CAS), Rollback bei fehlerhaftem Audit und eigene PostgreSQL-Integrationstests. Weder die tatsächliche Operator-/Admin-Authentifizierung noch HTTP-Create/Update/Delete oder DJI-WebSocket-Synchronisation ist aktiviert. Diese P2-Arbeit ist Vorbereitung; hardwaregetestete und autorisierte Schreibpfade bleiben weitere Meilensteine.
