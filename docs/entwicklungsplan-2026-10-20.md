# SkyHub Next: Bestandsaufnahme und Entwicklungsplan (20.10.2026)

> **Historisches Planungsdokument (Stand 20.–21.10.2026).** Maßgeblicher aktueller Repository-/PR-Abgleich: [Projektstand 23.10.2026](projektstand-2026-10-23.md). Neue offene und gestapelte Entwicklungs-PRs sind hier bewusst **nicht** als nach `main` integrierte oder auf dem Pi freigegebene Funktionen nachgetragen.


## Geltungsbereich und Schutzgrenzen

Entwicklungsbasis ist ausschließlich der Stack im Repository-Root. `stacks/legacy-skyhub/` dient als Referenz. Der Istzustand wurde nur lesend geprüft; Dienste, MQTT-Konfiguration, `.env`, Volumes und Daten wurden nicht verändert. Änderungen an laufenden Containern, Deployments, Broker-ACLs, Cutover und Git-Push erfordern eine ausdrückliche Freigabe.

## Repository und Betriebszustand

- Branch: `feature/mqtt-osd-integration`, Tracking `origin/feature/mqtt-osd-integration`. Keine Änderungen an versionierten Dateien zu Beginn der Aufnahme. `docker/` ist unversioniert; `.env`, lokale Sicherungen und `docker-compose.override.yml` sind ignoriert und müssen erhalten bleiben.
- Backend: Node.js 22, Express, Socket.IO, MQTT.js, Redis und PostgreSQL/PostGIS. `backend/server.js` verbindet Broker, Registry, Topologie, Pairing, API und Track-Persistenz. MQTT-Subscriber nutzt Port 1884; `status_reply` läuft über einen eigenen optionalen Publisher. Missionsversand antwortet mit 501.
- Frontend: Ausgeliefert werden `frontend/public/index.html` und die Pilot-2-Seite `frontend/public/pilot-login.html` mit `pilot-login.js`. Die kleine React-Datei `frontend/src/App.jsx` hat keinen Build- oder Auslieferungspfad und ist derzeit kein produktiver UI-Einstiegspunkt. Die Karte benötigt Leaflet vom CDN und OSM-Kacheln.
- Compose: Eigenes Projekt `skyhub-next`; Backend standardmäßig nur auf Host-Loopback `127.0.0.1:4001`, interne DB/Redis ohne Host-Port, MinIO nur im Profil `media`. Der lokale ARM64-Override und die beiden Dateien unter `docker/postgis/` sind Teil des Pi-Setups, aber derzeit nicht versioniert. Die Compose-Konfiguration ist syntaktisch gültig.
- Laufender Pi (Momentaufnahme): `skyhub-next-backend-1`, dessen Postgres und Redis sowie `skyhub_emqx` laufen. `skyhub_backend` erschien nicht in der Containerliste. Der lokale Health-Endpunkt meldete `online`, MQTT verbunden und abonniert, Redis bereit, Broker-Port 1884, Topologie-Publisher verbunden sowie empfangene und verwertbare OSD-Nachrichten. Der Zähler für gespeicherte Track-Punkte stand bei 0; daraus allein folgt kein Persistenzfehler, da die Track-Policy etwa 0/0 und unbewegte Punkte ausfiltert. Diese Zähler sind flüchtig und belegen keine End-to-End-Abnahme der Datenbank oder DJI-Hardware.
- Dokumentation: README, DJI-Kompatibilität, MQTT/OSD-Integration und Legacy-Cutover sind vorhanden. Teile der README schildern noch den Zustand vor dem laufenden Next-Backend und vor der erfolgreichen OSD-Abnahme. Der Cutover-Plan darf nicht als aktuelle Betriebsanweisung ohne erneuten Ist-Abgleich ausgeführt werden.
- Tests: 20 Node-Testdateien bestanden; 4 Python-Tests für die Staging-Umgebung bestanden. Syntaxprüfung von Backend und Pilot-JavaScript, `docker compose config --quiet` und `git diff --check` bestanden. CI enthält zwei teils überlappende Workflows. Es gibt kein versioniertes npm-Lockfile; das Image installiert Abhängigkeiten mit `npm install` und Versionsbereichen.

## Priorisierter Entwicklungsplan

1. **P0 – Betriebsbild und Dokumentation korrigieren.** README und Cutover-Dokument an den tatsächlich laufenden Next-Stack, die aktuellen Ports und die bereits erfolgte OSD-Abnahme anpassen. Die Trennung zwischen historischem Befund, aktuellem Code-Default und Live-Konfiguration klar markieren. Vor jeder späteren Betriebsmaßnahme einen frischen, lesenden Ist-Abgleich durchführen.
2. **P0 – Zugriffsgrenzen gezielt prüfen.** Tests für den echten Express-/Socket.IO-Pfad ergänzen: LAN-Ansicht nur lesend, Admin-Routen vom LAN ausgeschlossen, Pilot-Bootstrap nur über HTTPS und gültige Tokens, keine geheimen Werte in öffentlichen Antworten. Caddy und EMQX nur lesend gegen die dokumentierten Regeln prüfen; Änderungen an den produktiven Diensten separat freigeben lassen.
3. **P1 – Datenpfad verlässlich nachweisen.** PostgreSQL-Verbindung und Migrationsstatus separat diagnostizierbar machen; erfolgreiche und fehlgeschlagene Track-Schreibvorgänge korrekt zählen. Mit einer isolierten Testdatenbank die Migration, Track-Abfrage und Retention prüfen. Keine produktiven Datensätze löschen oder zur Probe schreiben.
4. **P1 – Builds reproduzierbar machen.** Ein Lockfile für das Root-Backend erzeugen und den Container auf `npm ci` umstellen; ARM64-PostGIS-Override und `docker/postgis/` bewusst versionieren oder als rein lokale Betriebsdateien dokumentieren. Images und CI auf Pi-Architektur und verfügbare PostGIS-Erweiterung prüfen.
5. **P2 – Frontend und Testmatrix konsolidieren.** Unbenutzte React-Datei entweder entfernen oder in eine bewusst geplante Frontend-Migration aufnehmen. Die beiden CI-Workflows zusammenführen und die ausgelieferten HTML/JS-Seiten sowie Authentifizierungsgrenzen mit sinnvollen Regressionstests absichern. Die CI-Konsolidierung ist am 21.10.2026 umgesetzt; die nicht ausgelieferte React-Datei bleibt bis zu einer geplanten Migration unberührt.
6. **P3 – Funktionserweiterung erst nach stabiler Basis.** Medien-API, Photogrammetrie, Radiometrie und WPML-Missionen anhand eigener Anforderungen und Hardware-Abnahme planen. Die vorhandenen Python-Worker sind Demonstrationscode; daraus dürfen keine echten Messergebnisse oder Flugfunktionen abgeleitet werden.

## Prüfnachweise und offene Grenzen

Verwendet: `git status --short --branch`, Dateiliste und Codeprüfung im Root, `node --test backend/test/*.test.js`, `python3 -m unittest discover -s tests -v`, `node --check`, `docker compose config --quiet`, lesende Containerliste und lokaler `GET /api/health`. Es wurde kein Container gebaut, neu gestartet oder verändert. Die Aufnahme ersetzt weder einen DB-Integrations- und Restore-Test noch eine Live-Validierung mit DJI Pilot 2.

## Fortschritt nach der Bestandsaufnahme

- README und Cutover-Dokument trennen den früheren Staging-Plan vom beobachteten laufenden Next-Stack. Das lesende Preflight-Skript akzeptiert den vorhandenen Loopback-Port 4001 nur, wenn Docker ihn ausdrücklich dem Next-Backend zuordnet; die Prüfung auf dem Pi bestand.
- Der LAN-Zugriff ohne Token ist jetzt auf die vorhandenen lesenden API-Routen begrenzt. Neue GET-Routen werden nicht automatisch freigegeben. Ein Integrationstest startet die echte Express-/Socket.IO-App isoliert auf einem zufälligen Loopback-Port; er prüft HTTP- und Socket-Authentifizierung, Admin-Ausschluss, HTTPS-/Token-Pflicht für den Pilot-Bootstrap und den Ausschluss von Pilot-Geheimnissen aus öffentlichen Antworten.
- `backend/package-lock.json` fixiert die npm-Abhängigkeiten. Beide CI-Workflows installieren daraus mit `npm ci`; das Backend-Image nutzt `npm ci --omit=dev`. `npm ci` lokal und anschließend die gesamte Node-Suite mit **120/120 Tests** bestanden; 4/4 Python-Tests, Syntax- und Compose-Prüfung bestanden. Der neue Integrationstest verbindet sich nur mit einem lokalen Testport; produktiver Broker und Redis wurden nicht angesprochen.
- Weiter offen: live Caddy-/EMQX-Regeln erneut lesend abgleichen, den Datenpfad mit isolierter Testdatenbank prüfen und die ARM64-PostGIS-Dateien bewusst einordnen. Bis zu diesem Zwischenstand gab es kein Deployment oder Git-Push.

## Weiterentwicklung nach Freigabe zur Docker-Integration und zum Push

- `docker/postgis/` und `docker-compose.arm64.yml` bilden das bisher nur lokal verfügbare Pi-PostGIS-Setup versioniert ab. Das lokale `docker-compose.override.yml` bleibt ignoriert und unverändert. Die explizite ARM64-Compose-Konfiguration ist gültig und verwendet `skyhub-next_pgdata_arm64`; CI prüft sie auf beiden Branch-Gruppen.
- Die Track-Persistenz trennt jetzt erfolgreich bestätigte Datenbank-Writes von ausstehenden, übersprungenen und fehlgeschlagenen Writes. Der Health-Endpunkt zeigt, ob eine Datenbank konfiguriert und die additive Migration erfolgreich war. Nach einem Migrationsfehler wird erneut versucht; nach einem Insert-Fehler kann der nächste geeignete Punkt erneut geschrieben werden. Isolierte Tests decken diese Fälle ab.
- Noch ausstehend ist eine Integration mit einer **separaten Testdatenbank**. Es wurden keine produktiven Track-Daten zur Probe geschrieben oder gelöscht und kein Container neu erstellt.

Abschlussprüfung dieses Entwicklungsblocks: **123/123 Node-Tests**, **4/4 Python-Tests**, Syntaxprüfung, beide Compose-Varianten und `git diff --check` bestanden. Ein lokaler Backend- oder ARM64-Image-Build wurde auf dem Pi nicht ausgeführt; der Feature-Branch-CI-Workflow prüft den Backend-Build nach dem Push. Der Code wurde nicht auf die laufenden Dienste ausgerollt.

## Fortschritt am 21.10.2026

- Die lesende DJI-Map-Element-GET-Route bleibt per Feature-Flag deaktiviert. Sie bindet Workspace und Token, verarbeitet Filter parametriert und hat Regressionstests für Mehrfachparameter und sichere Beispiel-Defaults. Die PostGIS-Migration ist weiterhin nur ein Entwurf; produktive Datenbanken wurden nicht verändert.
- Das Karten-Dashboard kennzeichnet jetzt sichtbare gespeicherte Flugspuren auch dann, wenn kein gültiger Gerätestandortmarker vorhanden ist. Strict-UI-Audit und ein isolierter Chromium-Test dieses Zustands bestanden.
- Das CI prüft jetzt auch die Inline-JavaScript-Syntax des tatsächlich ausgelieferten Dashboards, ohne die Seite oder externe Dienste auszuführen. Regressionstests decken gültige, fehlerhafte und unvollständige Script-Tags ab.
- Die überlappenden GitHub-Actions-Workflows wurden zu einem Workflow mit den bisherigen Prüfungen auf Feature- und Develop-Branches sowie Pull Requests zusammengeführt. Build, Smoke-Test, Python-Suite und Compose-Sicherheitsprüfungen laufen damit gemeinsam.

## Ergänzung: Isolierter PostGIS-Integrationsnachweis (21.10.2026)

Für den offenen P1-Datenpfad ist ein dedizierter CI-Job mit echter PostgreSQL-15/PostGIS-Datenbank ergänzt. Er überprüft Schema- und Track-Migration, Zeitstempel, 0/0-Filter und Retention sowie die getrennte, noch nicht produktiv aktive DJI-Map-Element-Migration inklusive Workspace-Isolation und transaktionalem Rollback. Siehe [Testumfang und Schutzgrenzen](postgis-isolated-validation.md). Diese Änderung startet keine Pi-Container, verändert keine Live-DB und aktiviert die DJI-Kartenelementroute nicht. Der CI-Erfolg ist vor der Übernahme zu prüfen. Weiter offen: externe Dump-/Restore-Probe, Workspace-Rollenmodell und DJI-Pilot-2-Hardwaretest.

## P1-Folgeprüfung: echte Backup-/Restore-Technik, ausschließlich mit Testdaten

Ergänzend zum transaktionalen PostGIS-Integrationstest wurde ein separater, durch GitHub Actions geschützter `pg_dump`/`pg_restore`-Test implementiert. Die Testdatenbank und die Ziel-Datenbank werden nur innerhalb eines eigens erzeugten, netzwerkisolierten Containers verwendet; das Archiv wird nicht exportiert. Mit synthetischen Daten werden Schema, DJI-Gruppen verschiedener Workspaces und PostGIS-Flugspuren vor und nach der Wiederherstellung geprüft. Die technischen Prüfdetails und der noch erforderliche betriebliche Restore einer anonymisierten Sicherung stehen in [PostGIS-Validierung](postgis-isolated-validation.md). Dies ist **keine** Wiederherstellungsfreigabe für die Pi-Datenbank. Die CI muss auf dem letzten Commit grün sein, bevor der Schritt als abgenommen gilt.

## Fortschritt P2: Zugriffstrennung für DJI-Kartenelemente

Das serverseitige Rollenmodell für die DJI-Kartenelement-GET-Route ist ergänzt: Nur Pilot-Identitäten im richtigen Workspace und nur veröffentlichte Gruppen werden tatsächlich gelesen. Die bisherige Pilot-Kopplung speichert künftig den Workspace als Geräte-Metadatum. Altgeräte ohne Metadatum bleiben beim Bootstrap kompatibel, erhalten aber keinen Karten-Gruppenzugriff ohne Neukopplung. Privates `is_distributed=false`, manipulierte Workspace-/Rollenparameter und spätere Schreiboperationen werden für Pilot strikt verweigert. `viewer`, `operator` und `admin` sind im reinen Policy-Modul definiert; weder Operator- noch Administratorrechte werden aktuell über bestehende Tokens ausgegeben. Prüfungen und Grenzen: [DJI-Kartenberechtigungen](dji-map-access.md). Die Karte und der Pilot-Schreibpfad bleiben ohne Hardwareabnahme deaktiviert.

## Fortschritt P2: Interner Schreibvertrag, ohne Live-Freigabe

Die Karten-Transaktionen sind intern als **nicht angebundener** Baustein modelliert: Gruppen-Sperren, `expectedRevision`/Compare-and-Swap, Audit-Journal und vollständiges Rollback inklusive Auditfehlern. Die separate Migration `002_dji_map_mutation_contract.sql` ist nur ein isoliert getesteter Entwurf, keine automatische Schemaänderung. Unit- und echte SQL-Integrationstests wurden ergänzt; CI validiert weiterhin die bestehende Lese- und Backup-/Restore-Linie. Details und offene Sicherheitsfreigaben: [DJI-Mutationsvertrag](dji-map-mutation-contract.md). Es wurden weder Pi-Dienste noch DJI-Schreibaktionen aktiviert.
