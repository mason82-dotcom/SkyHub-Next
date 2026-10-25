# Sicherheitsmodell – SkyHub Next

Diese Regeln gelten für den aktiven Root-Stack. Die historische Konfiguration unter `stacks/legacy-skyhub/` darf nicht als freigegebene aktuelle Sicherheitskonfiguration interpretiert werden. Sicherheitsbeobachtungen vom 20.10.2026 sind **zeitbezogene Diagnosebefunde**, keine permanente Aussage über den laufenden Broker.

`SKYHUB_PILOT_ENABLED` und `SKYHUB_TOPOLOGY_ACK_ENABLED` sind standardmäßig deaktiviert. Änderungen am Broker, an ACLs, an Caddy oder am produktiven HTTP-Port gehören nicht zu diesem Dokumentations-Cleanup.

**Weiterführend:** [MQTT/OSD und EMQX](mqtt-osd-integration.md), [Betrieb](ops.md), [Migration](legacy-migration.md).

## Status und Sicherheitsabgrenzung (23.10.2026)

Bezieht sich auf `main`, Commit `496a1f84f22b15f85ad5442965b2cd218a93969a`.
Die experimentellen STS-/XMP-/YOLO-/Thermal-/WPML-Module der
[PR-Übersicht](projektstand-2026-10-23.md) sind **nicht** Teil der hier beschriebenen
freigegebenen Runtime und erhalten durch ein grünes CI-Ergebnis keine automatische
Produktivberechtigung. In Main ist die Spuraufzeichnung standardmäßig deaktiviert.
Das optionale MinIO-Compose-Profil veröffentlicht keine Hostports.

**Proxy-/LAN-Vertrauensgrenze:** Der Main-HTTP-Code aktiviert Proxy-Vertrauen
bei Loopback-Bindung; die LAN-Ausnahme liest einen weitergereichten
`X-Forwarded-For`-Header für lokale/private Peers. Daher ist eine **strikt
kontrollierte Reverse-Proxy-Konfiguration** erforderlich: Backend nur auf
Loopback veröffentlichen, keinen alternativen ungefilterten Proxy bzw.
direkten Fernzugang bereitstellen und den Client-IP-Header durch den
vertrauenswürdigen Proxy korrekt neu setzen. Die LAN-Option niemals als
vollwertige Benutzer-Authentifizierung oder als allgemeine VPN-Freigabe
verstehen. Bis zur gesonderten Abnahme `SKYHUB_LAN_VIEW_CIDR` leer lassen.

## Sicherheitsmodell

- `SKYHUB_VIEW_TOKEN` schützt reguläre `/api`-Telemetrie- und Diagnose-Routen sowie Socket.IO. **Ausnahmen:** `/api/health` und `/api/pilot/status` sind öffentliche aggregierte Statusrouten; bei expliziter `SKYHUB_LAN_VIEW_CIDR` gibt es eine eng begrenzte **nur lesende** LAN-Ausnahme für benannte Geräte-/Ereignis-/Track-Routen und Socket.IO. Pilot-HTTPS/Pairing sowie Karten-Gruppen verwenden eigene Guards; die Pilot-Administration bleibt von der LAN-Ausnahme ausgeschlossen.
- Web-Frontend standardmäßig nur auf 127.0.0.1:4001 des Hostsystems; für entfernten Zugriff SSH-Tunnel oder vertrauenswürdigen HTTPS-Reverse-Proxy einsetzen.
- Keine standardmäßig veröffentlichten Postgres-, Redis- oder MinIO-Ports.
- Kein DISABLE_AUTH; keine im Code hinterlegten Datenbank-, MQTT- oder MinIO-Kennwörter.
- MQTT-Subscriber bleibt read-only. Eine optionale, standardmäßig deaktivierte Topologie-Bestätigung nutzt einen separaten ACL-eingeschränkten Publisher.
- Keine DJI-Flug- oder Missionssteuerung. POST /api/mission/create antwortet absichtlich mit HTTP 501.
- Kein Vortäuschen von Telemetrie: unbekannte Werte null, aktualisierte Werte nur aus echten osd-Meldungen, Frischegrenze 15 Sekunden.

## Caddy HTTPS-Vertrauen auf dem Raspberry Pi (20.10.2026)

Der Pi betreibt Caddy 2.11.4 im `host`-Netzwerk. Für
`rpi5.fritz.box:443` ist ein Zertifikat mit dem Issuer
`Caddy Local Authority - ECC Intermediate` aktiv. Der erste
`curl`-Test auf dem Pi endete mit `curl: (60) unable to get local
issuer certificate`. Das bedeutet, dass `curl` die präsentierte
Zertifikatskette mit dem **Pi-System-Trust-Store** nicht prüfen konnte.
Ein separat geprüftes Caddy-CA-Root-Zertifikat ist noch kein Nachweis,
dass DJI Pilot 2 oder seine Android-WebView derselben CA vertraut.

Lesend und ohne `-k` prüfen:

    cd ~/Projekte/SkyHub-Next
    bash scripts/pi-tls-audit.sh rpi5.fritz.box 192.168.178.63 443

Der Test prüft zuerst den Pi-System-Trust-Store und versucht anschließend
den expliziten Nachweis mit `/data/caddy/pki/authorities/local/root.crt`
aus dem bestehenden Caddy-Container. Er installiert **keine** CA,
startet/stoppt keinen Dienst und liest keine privaten Schlüssel.

**Zeitliche Einordnung:** Die damalige TLS-Vertrauensprüfung ist ein Befund vom 20.10.2026. Seitdem wurden RC-Pro-/M3M-OSD-Hardwarebeobachtungen dokumentiert, ohne dass damit eine allgemeine Cloud-API-1.18- oder TLS-WebView-Kompatibilität garantiert wäre. Main enthält Pilot-2-H5-Pairing und den optionalen Topologie-Antwortpfad; neue Medien-/STS-/KI-/WPML-Implementierungen bleiben [offene, getrennte PRs](projektstand-2026-10-23.md). Keine Pi-Dienste oder Caddy-Routen durch Branchwechsel überschreiben.

## Dashboard im Heimnetz (192.168.178.0/24)

    sudo bash scripts/pi-caddy-lan-dashboard.sh apply

Ergänzt im bestehenden Caddy eine Site auf **Port 4443**
(`https://rpi5.fritz.box:4443` bzw. `https://192.168.178.63:4443`, Caddy-interne CA).
Nur Absender aus `192.168.178.0/24` werden an `127.0.0.1:4001` weitergeleitet,
alle anderen (auch Tailscale) erhalten 403. `/api/pilot-admin/*` bleibt gesperrt:
Ein View-Token darf nicht reichen, um ein Gerät zu koppeln und so DJI-Lizenz und
Pilot-MQTT-Zugangsdaten zu erhalten. Das Backend bleibt auf Loopback gebunden.
Sicherung und Validierung vor dem Reload, automatischer Rückfall bei Fehlern;
`rollback` stellt den vorherigen Stand her, `check` testet ohne Änderungen.

### Ohne Token im Heimnetz

Mit `SKYHUB_LAN_VIEW_CIDR=192.168.178.0/24` in `.env` öffnet sich das Dashboard
über Caddy :4443 ohne Token. Erlaubt sind nur lesende GET-Abfragen und der
Live-Socket; schreibende Aufrufe brauchen weiter das Token, `/api/pilot-admin/*`
bleibt gesperrt. Ermittelt wird der Client aus Caddys letztem
`X-Forwarded-For`-Eintrag; SSH-Tunnel und lokale Aufrufe ohne diesen Header
brauchen das Token. Akzeptiert werden nur private Netze von /16 bis /32
außerhalb der Docker-Bereiche (172.16.0.0/12). Leer lassen, um das Token immer
zu verlangen. Die Kartenkacheln senden einen Referer
(`strict-origin-when-cross-origin`), wie es die OSM-Nutzungsregeln verlangen.

**DJI-1.18-Paritätsaudit:** Der nach `main` übernommene Offline-Checker besitzt weder MQTT-Verbindung noch HTTP-Route und erzeugt ausschließlich Ergebnisse über mitgelieferte synthetische Testfälle. [Verifikationsgrenzen](dji-protocol-parity-audit.md). Ein GitHub-Merge startet keinen Prozess auf dem Pi.


## PR #24: nur lesende M3M-Medien-API (Integrationsstand)

Die optionale API `/api/media/*` aus PR #24 ist ausschließlich bei explizitem `SKYHUB_MEDIA_ENABLED=true` erreichbar, hinter Bearer-Authentifizierung. Die Inventur liefert Summen, keine Objektkennungen. Die S3-Reader-Rolle darf keine PUT-/DELETE-Rechte besitzen; die `GET /api/media/objects`-Antwort enthält dagegen Objektnamen für authentifizierte Betreiber und ist **nicht** anonym. Keine dieser Schnittstellen erteilt Upload-, Radiometrie- oder DJI-Steuerberechtigungen. Eine CI-Abnahme ist keine Produktionsfreigabe auf dem Raspberry Pi.
