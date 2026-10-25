# SkyHub Next – technischer Review und Proxy-Trust-Gate (25.10.2026)

> **Quellcode-Review, keine Live-Pi- oder DJI-Hardwareprüfung.** Ausgangsbasis: `main` @ [`f2a523cc46c27e0a37a0c92b22807574483f038e`](https://github.com/mason82-dotcom/SkyHub-Next/commit/f2a523cc46c27e0a37a0c92b22807574483f038e) nach dem Dokumentationsmerge #175. Die hier vorgeschlagenen Änderungen liegen **nur auf einem separaten Sicherheitsbranch** und ändern keine laufenden Pi-Dienste.

## Geprüfte Grenzen

- **HTTP, TLS/Proxy und LAN-View:** `backend/server.js`, `backend/http-auth.js`, `backend/lan-access.js`, `backend/pilot-routes.js`, `backend/pilot-auth.js`, `backend/map-element-api.js`, `backend/test/http-access.test.js`, `backend/test/lan-access.test.js`.
- **Daten und Schnittstellen:** `backend/media-api.js`, `backend/s3-storage.js`, `backend/pilot-media-http.js`, `backend/minio-dr-api.js`, `backend/map-element-permissions.js`, `backend/mqtt-ingest.js`.
- **Betrieb/Tests:** `docker-compose.yml`, `.env.example`, `.github/workflows/ci.yml`, `backend/db/schema.sql`, `backend/db/migrations/*` und `scripts/repository-hygiene.py`.
- Der Main-Git-Baum wurde erfasst, aber dieses Review ist **keine vollständige manuelle Sicherheitsprüfung aller Repository-Dateien** und kein Penetrationstest.

## P0 – X-Forwarded-Vertrauen enger begrenzen (Draft-Implementierung)

**Beobachtung am geprüften Main:** `server.js` vertraut bei Loopback-Hostbindung für `req.secure` den von Express als `loopback`, `linklocal` und `uniquelocal` klassifizierten Peers. `lan-access.js` behandelt jeden Socket-Peer aus `172.16.0.0/12` als vertrauenswürdigen Reverse-Proxy für `X-Forwarded-For`. Ein fremder Container im selben Docker-Netz kann den Backend-Container möglicherweise **direkt auf seinem internen Port** erreichen und einen Client aus dem freigegebenen Heim-LAN vortäuschen. Der tokenfreie LAN-View ist standardmäßig **aus**, doch bei expliziter Aktivierung darf seine Sicherheit nicht von pauschalem Docker-Netzvertrauen abhängen.

**Korrekturentwurf auf diesem Branch:**

1. `backend/proxy-trust.js` validiert eine kurze Liste **einzelner exakter privater/Loopback-IP-Adressen**; implizit sind nur `127.0.0.1` und `::1` vertrauenswürdig.
2. `server.js` verwendet dieselbe exakte Liste bei Express-`trust proxy` (`X-Forwarded-Proto` / HTTPS-Auswertung) und für `createLanAccess` (`X-Forwarded-For` / LAN-View).
3. `SKYHUB_TRUSTED_PROXY_IPS` wird ausschließlich als Opt-in-Konfiguration in Root-Compose durchgereicht. **Keine** CIDRs, gesamten Docker-Subnetze, öffentlichen Peers oder fremden Client-IPs zulassen.
4. Die Regressionstests prüfen zusätzlich, dass `172.18.0.2` mit gefälschtem `X-Forwarded-For` **nicht** den heimischen `192.168.178.0/24`-Viewer freischaltet, auch wenn der echte Caddy-Peer `172.18.0.1` explizit erlaubt wäre.

**Betriebs-Gate:** Diese Änderung darf **nicht blind deployed werden**. Wenn Caddy über eine Docker-Bridge-Adresse auf SkyHub zugreift, muss diese **tatsächlich beobachtete Socket-Peer-Adresse** vor dem Update explizit als `SKYHUB_TRUSTED_PROXY_IPS` gesetzt und danach HTTPS-/Pilot-2-/LAN-View-Zugriff geprüft werden. Nicht einfach die Beispieladresse `172.18.0.1` übernehmen: Docker-Gateways ändern sich je Host/Netz. Zuvor Snapshot von `.env`/Compose/Proxy-Konfiguration und bekannten funktionierenden Zugriffsweg sichern. Wenn die tatsächliche Peer-Adresse unbekannt ist: **kein Rollout**.

**Rollout-/Rollback-Hinweis:** Ausschließlich im separaten Staging mit synthetischen Token-/Header-Tests validieren. Bei fehlendem Pilot-HTTPS oder Dashboard-Zugriff den zuvor funktionierenden Image-/Compose-Stand kontrolliert wiederherstellen. Keine Änderung an Caddy, Tailscale, Mosquitto, MinIO oder dem Pi durch einen GitHub-Commit.

## Weitere offene technische Gates

| Priorität | Beobachtung | Nächste abgesicherte Maßnahme |
| --- | --- | --- |
| P1 | Es existieren die zwei Dateinamen `003_dji_pilot_media_verified.sql` und `003_wpml_route_library_draft.sql`. Eine spätere Migrationsverwaltung darf daraus **nicht** unbesehen ein einziges `003`-Release machen. WPML ist ausdrücklich nur ein nicht angewendeter SQL-Entwurf. | Eigenständiges nummeriertes, überprüftes Migrationsregister und echte isolierte PostgreSQL-Abnahme vor produktiver Anwendung. Keine automatische Umbenennung/DDL auf dem Pi. |
| P1 | `pilot-media-http.js` (Upload-Callbacks) ist isoliert und **nicht in `server.js` gemountet**. Der bestehende S3-Browser ist nur lesend und standardmäßig ausgeschaltet. | Pilot-Medien-Auth, Transaktionen, Audit, S3-HEAD, STS-IAM und Idempotenz auf dem endgültigen Integrations-SHA vor jeglicher Aktivierung nachweisen. |
| P1 | Das Root-`media`-Profil und `docker-compose.minio-shared.yml` bilden unterschiedliche Betriebsmodelle. | Storage-Mount, Netz, Objekt-ACL, Backup/Rollback und Isolierung getrennt prüfen; niemals parallel blind dieselben Datenpfade bedienen. |
| P1 | DJI-Pilot-Admin nutzt das View-Token für mutierende Pairing-Operationen; der Code ist nicht durch eine umfassende eigenständige Operator-RBAC-Ebene geschützt. | Admin-Zugang ausschließlich über gesicherten Betreiberpfad erlauben; bei späterem externen Hosting gesonderte rollenbasierte Authentifizierung und CSRF-/Origin-Konzept prüfen. |
| P2 | M3M-Rasterexperimente und WPML-Offline-Komponenten sind auf `main` teils als Labs vorhanden; viele weiterführende Module liegen in gestapelten Draft-PRs. | Originaldaten-Provenienz, radiometrische Kalibrierung, DJI-WPML-Hardwareinteroperabilität, Datenschutz und reale Abnahme vor operativer Freigabe. |

## Aktions-/Abnahmefolge

1. Die exakte Proxy-Korrektur auf einem **Draft-PR** gegen `main` isolieren; Node-Tests und die restliche CI auf **dessen finalen SHA** kontrollieren.
2. Auf Testumgebung zunächst `SKYHUB_TRUSTED_PROXY_IPS=` (nur Loopback) und danach den explizit identifizierten Reverse-Proxy-Socket testen. LAN-View ohne echten Proxy darf durch gefälschte Header nicht freigeschaltet werden.
3. Gegen aktive RC Pro Enterprise/Mavic 3M und RC Plus 2/M4T ausschließlich autorisierte **lesende** Pilot-/Topologie-/OSD-Gates prüfen, ohne Flugsteuerung und ohne Media-Upload-Simulation am produktiven System.
4. Nach dokumentierter Caddy-/Pi-Akzeptanz Freigabe des Proxy-Drafts separat entscheiden; anschließend PR-Ketten anhand des neu gemessenen Main-Branches priorisieren.

**Wichtig:** Ein grüner isolierter GitHub-Test ersetzt nicht die Prüfung des konkreten Caddy-Netzpfads auf dem Raspberry Pi.
