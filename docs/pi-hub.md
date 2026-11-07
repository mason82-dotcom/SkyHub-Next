# Pi-Hub – Begleitprojekt für den Pi-Betrieb

**Pi-Hub ist ein eigenes, rein lokales Projekt** (Ordner `~/Projekte/Pi-Hub` auf dem Pi, eigenes Git-Repository, **nicht** Teil von SkyHub-Next und ohne GitHub-Remote). Es ist eine Weboberfläche im LAN, die alle Docker-Compose-Projekte, Einzelcontainer, ausgewählte systemd-Units und Projektordner des Pi mit Live-Status zeigt und Projekte und einzelne Module starten, stoppen und neu starten kann.

| Thema | Stand |
|---|---|
| Anzeige | Zustand live (Server-Sent Events, Docker-Ereignisse), CPU/RAM je Container, Verlauf mit Mini-Grafiken, Pi-Gesundheit (Drosselung, Temperaturen, NVMe-SMART), Backup-Frische, Update-Hinweise für externe Images, Log-Ansicht mit Schwärzung, maskierte Umgebung |
| Zugriff | nur LAN, Passwort, Sitzungen mit Grenzen; Steuern erst nach erneuter Passwortabfrage; geschützte Container (u. a. `skyhub-shared-minio`, `nextcloud-aio-*`) nur zur Anzeige |
| Sicherheitsarchitektur | optional getrennter Betrieb: eigener Benutzer ohne `docker`, `disk`, `sudo`, `adm` und ein **Docker-API-Filter**, der nur Lesen und Start/Stopp/Neustart nicht geschützter Container durchlässt (auf dem Pi eingerichtet) |
| Zusatzwerkzeuge | `pi-docker-logrotation.sh` (Prüfung der Log-Rotation), `pi-pipower-remove.sh`, `pi-caddy-pi-hub.sh` (HTTPS-Route, Port 4445) |

Die Dokumentation liegt im Pi-Hub-Ordner selbst (`README.md`, `docs/betrieb.md`, `docs/isolation.md`, `docs/architektur.md`, `docs/api.md`, `docs/konfiguration.md`).

**Abgrenzung zu SkyHub-Next.** Pi-Hub liest nur Zustände und führt die gelisteten Aktionen aus; es verändert weder Flugsteuerung noch DJI-Kopplung noch MQTT. Es startet Container nur über die Docker-API und systemd-Units nur über eng gefasste sudo-Regeln. Für SkyHub-Next-Updates bleibt `scripts/pi-update-backend.sh` der Weg; Pi-Hub kann einzelne SkyHub-Container neu starten, was die Telemetrie kurz unterbricht (nicht während eines Flugs).
