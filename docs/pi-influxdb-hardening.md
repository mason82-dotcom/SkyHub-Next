# Host-InfluxDB absichern (Port 8086)

**Stand 24.10.2026 · Opt-in · gehört nicht zu SkyHub Next.** Auf dem Pi läuft ein eigenständiger InfluxDB 1.13.1 (OSS, systemd-Unit `influxdb`).
Er lauscht auf allen Schnittstellen (`*:8086`) und beantwortet Abfragen ohne Zugangsdaten (HTTP 200 statt 401). Jeder im Netz
kann damit Messdaten lesen, schreiben und löschen. SkyHub Next verwendet InfluxDB nicht.

`scripts/pi-influxdb-harden.js` ändert **nur ein systemd-Drop-in** (`/etc/systemd/system/influxdb.service.d/skyhub-harden.conf`) mit
`INFLUXDB_HTTP_AUTH_ENABLED` und/oder `INFLUXDB_HTTP_BIND_ADDRESS`. InfluxDB lässt Umgebungsvariablen die Config-Datei überschreiben, die
Config selbst wird weder gelesen noch geändert. Rollback bedeutet: Drop-in löschen.

| Befehl | Wirkung |
| --- | --- |
| `node scripts/pi-influxdb-harden.js status` | Lesend: Dienst, Drop-in, ob Abfragen ohne Anmeldung durchgehen |
| `node scripts/pi-influxdb-harden.js clients [s]` | Lesend: beobachtet Verbindungen (nur Adressen, keine Daten), sortiert nach LAN/Docker/lokal |
| `node scripts/pi-influxdb-harden.js plan --auth --bind 127.0.0.1:8086` | Lesend: zeigt das geplante Drop-in |
| `sudo node scripts/pi-influxdb-harden.js apply --auth` | Legt Admin an (Passwort nur in `/etc/influxdb/skyhub-admin.cred`, root, 0600), schaltet Auth ein, startet neu, prüft, bei Fehler Rollback |
| `sudo node scripts/pi-influxdb-harden.js apply --bind 127.0.0.1:8086` | Begrenzt die Schnittstelle (ohne Auth) |
| `sudo node scripts/pi-influxdb-harden.js verify` | Prüft den angewendeten Zustand (401 ohne Anmeldung, 200 mit Admin, von außen nicht erreichbar) |
| `sudo node scripts/pi-influxdb-harden.js rollback [--drop-user]` | Entfernt das Drop-in, startet neu; `--drop-user` löscht auch Admin und Zugangsdatei |

## Vor `apply`: Clients klären

1. `node scripts/pi-influxdb-harden.js clients 120` zeigt, wer verbindet. **Docker-Adressen (172.16–31.x)** sind Container, die über die Bridge
   zugreifen (z. B. Home Assistant, Grafana, Telegraf).
2. `--auth`: Jeder Client braucht danach Zugangsdaten (den Admin aus der Zugangsdatei oder besser einen eigenen Benutzer mit
   eingeschränkten Rechten). Clients ohne Anmeldung bekommen 401.
3. `--bind 127.0.0.1:8086`: Container (über die Docker-Bridge) und andere Geräte erreichen den Dienst nicht mehr. Getestet: Auch die
   Bridge-Gateways (`172.17.0.1` u. a.) sind dann zu. Für Container eher `--auth` verwenden oder eine Bridge-Adresse binden.

Beides lässt sich kombinieren. Ein Neustart unterbricht den Dienst kurz, Clients mit Retry holen auf.

## Grenzen

- Geprüft gegen einen Wegwerf-InfluxDB 1.13.1 (Umgebungsvariablen überschreiben die Config, Admin-Anlage, 401/200, Bind begrenzt die
  Schnittstelle, Entfernen öffnet wieder). **Nicht** geprüft: `apply` als root gegen den echten Dienst mit seiner Config.
- `rollback` lässt den Admin und die Zugangsdatei bestehen, solange `--drop-user` fehlt. Steht `auth-enabled = true` bereits in der
  Config-Datei, bleibt Auth nach dem Rollback an (das Skript ändert die Config nicht).
- TLS wird nicht eingerichtet. Die Anmeldung im LAN läuft unverschlüsselt (Basic Auth über HTTP). Für Zugriff von außen ein
  TLS-Frontend (z. B. Caddy) verwenden.
- InfluxDB 2.x/3.x ist ein anderes Produkt und wird nicht unterstützt (das Skript prüft nur die 1.x-API).
