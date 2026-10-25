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
