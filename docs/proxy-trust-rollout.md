# Explizites Proxy-Vertrauen – Betriebsleitfaden (Draft)

**Status:** nur Sicherheitsentwurf im Feature-PR; vor Freigabe den [Code-Audit](engineering-audit-2026-10-25.md) und die jeweilige CI prüfen. Kein automatisches Upgrade oder Pi-Betriebseingriff.

## Verhalten der vorgeschlagenen Änderung

- Default `SKYHUB_TRUSTED_PROXY_IPS=`: **nur** direkte Socket-Peers `127.0.0.1` und `::1` dürfen `X-Forwarded-For` oder `X-Forwarded-Proto` beeinflussen.
- Für Caddy über Docker-Bridge muss der Betreiber **die genaue Peer-IP im Backend-Verbindungsweg** separat bestimmen (z. B. durch kontrollierte Netzwerkdiagnostik ohne Token-/Privatdatenlogging).
- Anschließend ausschließlich diese eine private Proxy-IP in `SKYHUB_TRUSTED_PROXY_IPS` eintragen; eine Liste mehrerer exakt geprüfter Proxys ist möglich (höchstens acht zusätzliche Einträge). **Keine** CIDRs, Gateway-Vermutungen oder offene Docker-Netzbereiche.
- Der Wert gelangt über `docker-compose.yml` an den Backend-Prozess. Er ist **nicht** austauschbar mit dem TSA-spezifischen `SKYHUB_DJI_TSA_TRUSTED_PROXY_IPS`, das eine getrennte Vertrauensgrenze schützt.
- Bei Veröffentlichung des Hostports außerhalb Loopback wird die Express-Proxy-Auswertung weiter nicht eingeschaltet. Öffentlichen HTTP-Direktzugang nicht als Alternative zu sauberem HTTPS-Proxy verwenden.

## Abnahme vor produktivem Update

1. Bestehenden Backend-Image-Digest, Compose-Dateien/-Overrides und privaten `.env`-Stand **ohne Veröffentlichung von Geheimnissen** erfassen; wiederherstellbaren Ausgangszustand sichern.
2. Proxypfad im isolierten Staging reproduzieren: echte Caddy-Peer-IP, Host-/Bridge-Adressen, Token-/Pilot-HTTPS, Socket.IO und LAN-View GET-Allowlist.
3. Mit fremdem Bridge-Socket-Peer und gefälschtem `X-Forwarded-For` muss der tokenfreie Zugriff **401** bleiben; mit zugelassenem echten Proxy und zulässiger Client-IP sind die bestehenden read-only-GETs erreichbar.
4. Mit gefälschtem `X-Forwarded-Proto: https` von einem nicht vertrauenswürdigen Peer dürfen Pilot-/Karten-HTTPS-Gates nicht umgangen werden.
5. Vor Ort tatsächlichen Caddy-/Tailscale-HTTPS-Zugriff auf Pilot-2-Seite und die berechtigten RC-Pairings lesend kontrollieren. Keine Flug-, DJI-Medien-Schreib- oder Storage-Mutation als Smoke-Test verwenden.
6. Nur nach dokumentierter Freigabe das Backend-Image kontrolliert wechseln; bei Fehlfunktion auf den alten geprüften Stand zurück, ohne `down -v` und ohne Datenmigration.

Ältere LAN-Tests, die jedes `172.16.0.0/12`-Peer implizit als Caddy akzeptierten, sind für dieses Sicherheitsmodell nicht mehr zulässig.

## Gemessene Ausgangslage und Prüfskript (25.10.2026, nur lesend)

Caddy läuft im Host-Netz und erreicht das Backend über den veröffentlichten Loopback-Port `127.0.0.1:4001`. Docker leitet diese Verbindung über seinen Userland-Proxy weiter, deshalb sieht das Backend als Socket-Peer **nicht `127.0.0.1`, sondern das Gateway des Standardnetzes** `skyhub-next_default`. Gemessen mit einem Wegwerf-Container im selben Netz mit gleicher Portveröffentlichung: Peer `172.25.0.1`, das Gateway dieses Netzes.

Folgen für diese Änderung:

- Mit leerem `SKYHUB_TRUSTED_PROXY_IPS` ignoriert das Backend die Header von Caddy: Das tokenlose LAN-Dashboard hinter `:4443` und die HTTPS-Erkennung der Pilot-2-Seite fallen aus.
- Mit `SKYHUB_TRUSTED_PROXY_IPS=<Gateway>` funktioniert beides, und Nachbar-Container im Docker-Netz können sich nicht mehr als LAN-Client ausgeben (in `main` können sie das mit dem bisher vertrauten Bereich `172.16.0.0/12`).
- Das Gateway vergibt Docker selbst. Wird das Netz neu erzeugt, kann es sich ändern, ohne dass eine Fehlermeldung kommt.

`scripts/pi-proxy-peer-check.sh` liest das aktuelle Gateway (`docker network inspect`) und das Caddyfile und vergleicht beides mit `SKYHUB_TRUSTED_PROXY_IPS`:

```bash
SKYHUB_TRUSTED_PROXY_IPS=$(grep '^SKYHUB_TRUSTED_PROXY_IPS=' .env | cut -d= -f2-) bash scripts/pi-proxy-peer-check.sh
```

- Ohne Argument (Plan) gibt es Befunde und die zu setzende Zeile aus, Exit 0.
- Mit `--enforce` endet es mit Exit 3, wenn Caddy das Backend bedient und kein Eintrag das Gateway nennt, oder wenn ein Eintrag kein Gateway des Netzes ist (veraltet). `scripts/pi-update-backend.sh --apply` ruft es vor Backup und Neuaufbau mit `--enforce` auf und bricht mit `REFUSED` ab, ohne etwas zu ändern. Ist das Caddyfile nicht lesbar oder nennt es den Backend-Port nicht, bleibt die Prüfung ein Hinweis.

## Festes Subnetz (opt-in)

Damit das Gateway nie von selbst wechselt, kann das Standardnetz ein festes Subnetz bekommen: `docker-compose.fixed-subnet.yml`. **Nicht beiläufig anwenden.** Docker kann das Subnetz eines vorhandenen Netzes nicht ändern; das Netz muss entfernt und neu angelegt werden, also stehen Postgres, Redis und Backend dazwischen still (`docker compose down` ohne `-v` behält die Datenvolumes). Die Variablen sind absichtlich Pflicht, damit die Datei nicht versehentlich wirkt. Ein Beispielwert ist `10.250.40.0/24` mit Gateway `10.250.40.1`; vorher gegen `docker network ls` und `ip -4 route` prüfen (auf dem Pi belegt der automatische Pool bereits `172.17.0.0/16` bis `172.28.0.0/16`).

Ablauf in einem Wartungsfenster (privilegierte Schritte nur durch den Betreiber): Sicherung wie in der Abnahme oben, Dienste stoppen, Overlay mit den Variablen zum Start verwenden, `SKYHUB_TRUSTED_PROXY_IPS` auf das neue Gateway setzen, `scripts/pi-proxy-peer-check.sh --enforce`, dann Funktionsprüfung (LAN-Dashboard ohne Token 200, fremder Peer 401, `/pilot-login` über Caddy). Ohne das Overlay genügt die Prüfung des Update-Skripts.
