# TAK / CloudTAK-Ausgang

SkyHub sendet die Live-Positionen der Fluggeräte (optional auch der Fernsteuerungen) als **Cursor on Target 2.0** an einen
TAK Server; CloudTAK, ATAK, WinTAK und iTAK zeigen, was der Server verteilt. Nur ausgehend, standardmäßig **aus**
(`backend/tak.js`, Entwurf `docs/entwurf-missionsfreigabe-ndvi-tak-2026-11-04.md` §5).

## Was gesendet wird
- je Gerät höchstens 1/s, bei Positionsänderung oder spätestens alle 5 s (Herzschlag);
- nur frische Positionen mit geprüfter Quellzeit, nie 0/0, nie älter als 30 s; bei getrennter Verbindung wird **nicht**
  gepuffert (veraltete Positionen sind gefährlicher als keine);
- `uid="SKYHUB-<Seriennummer>"`, Typ `a-f-A-M-H-Q` (einstellbar), `stale` = Quellzeit + 15 s, `hae` = Ellipsoidhöhe,
  `<track>` mit Kurs und Geschwindigkeit, Rufzeichen „Modell + letzte 4 Zeichen der Seriennummer“, Akku und Höhe über Start.

## Einschalten (`.env` auf brix)
```
SKYHUB_TAK_ENABLED=true
SKYHUB_TAK_SERVER=tak.example.org:8089        # TLS-Streaming-Port des TAK Servers
SKYHUB_TAK_CERT=/run/tak/client.pem           # Client-Zertifikat (PEM), vom TAK Server ausgestellt
SKYHUB_TAK_KEY=/run/tak/client.key
SKYHUB_TAK_CA=/run/tak/truststore-ca.pem      # CA des TAK Servers (Server wird geprüft)
SKYHUB_TAK_KEY_PASSPHRASE=                    # falls der Schlüssel verschlüsselt ist
SKYHUB_TAK_INCLUDE_RC=false                   # Fernsteuerungen als Bodeneinheit a-f-G-U-C
SKYHUB_TAK_TEAM=Cyan
```
Die Zertifikatsdateien gehören **nicht** ins Repo: per brix-eigener Compose-Überlagerung read-only nach `/run/tak` einbinden.
Ein `.p12` aus dem TAK Server vorher in PEM umwandeln (`openssl pkcs12 -in client.p12 -out client.pem -clcerts -nokeys`,
`… -out client.key -nocerts -nodes`).

## Multicast (ohne TAK Server)
`SKYHUB_TAK_MULTICAST_ENABLED=true` sendet zusätzlich an 239.2.3.1:6969 (TTL 1). Aus dem Docker-Bridge-Netz des Backends
erreicht Multicast das Heimnetz **nicht**; dafür bräuchte der Backend-Container Host-Netzwerk. Für den Betrieb daher den
TAK-Server-Weg nutzen.

## Status
`GET /api/tak/status`: verbunden, gesendet, verworfen, Multicast-Zähler, letzter Fehler (ohne Pfade und Geheimnisse).
