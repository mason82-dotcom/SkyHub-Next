# Offline-Kartenkacheln (OpenStreetMap-Cache), Stand 02.11.2026

## Zweck

Im Feld hat der Pi oft kein Internet. Bisher blieb die Karte dann leer, weil jede Kachel direkt von `tile.openstreetmap.org` kam. Jetzt laden Dashboard, WPML-Editor und Survey-Vorschau ihre Kacheln über die eigene Route `/tiles/osm/{z}/{x}/{y}.png`. Leaflet selbst wird schon lokal ausgeliefert (`/vendor/leaflet/1.9.4/`).

| `SKYHUB_TILE_CACHE_ENABLED` | Verhalten |
|---|---|
| `false` (Standard) | `302`-Weiterleitung auf `https://tile.openstreetmap.org/…`, also wie bisher. Der Browser sendet dabei nur die Origin als Referer. |
| `true` | Das Backend lädt eine Kachel **erst, wenn sie angezeigt wird**, speichert sie unter `SKYHUB_TILE_CACHE_DIR` (Compose: Volume `tile_cache`) und liefert sie danach von der Platte. |

## Regeln im Cache-Modus

- **Kein Vorab- oder Massendownload.** Es gibt bewusst kein Werkzeug, das ganze Gebiete herunterlädt; das verbietet die [OSMF-Tile-Policy](https://operations.osmfoundation.org/policies/tiles/). Für ein Einsatzgebiet die Karte vorher **zu Hause mit Internet** in den benötigten Zoomstufen ansehen; die gesehenen Kacheln sind danach offline verfügbar.
- Kacheln gelten mindestens **7 Tage** als frisch, länger, wenn die Cache-Header von OSM das erlauben. Danach wird mit `If-None-Match`/ETag nachgefragt.
- **Ohne Internet** wird eine abgelaufene Kachel trotzdem ausgeliefert (`X-SkyHub-Tile: stale`). Eine nie gesehene Kachel antwortet mit `504` (JSON); die Karte zeigt dort eine Lücke.
- Upstream-Schutz: höchstens 4 gleichzeitige Abrufe, 300 Abrufe pro Minute, eindeutiger User-Agent `SkyHub-Next/0.1 tile cache (+Repository-URL)`. Gleichzeitige Anfragen derselben Kachel teilen sich einen Abruf.
- Nur echte PNGs bis 512 kB werden gespeichert, keine Fehlerseiten. Koordinaten werden auf z 0–19 und die Kachelpyramide begrenzt.
- Größenlimit `SKYHUB_TILE_CACHE_MAX_MB` (Standard 512, erlaubt 16–20480). Bei Überschreitung werden die am längsten nicht genutzten Kacheln gelöscht, bis 90 % erreicht sind.
- Die Route braucht kein Token und liefert keine SkyHub-Daten. Im LAN reicht Caddy sie wie alle Dashboard-Pfade durch; eine Caddy-Änderung ist nicht nötig.
- `/api/health` enthält `tileCache` (Anzahl, Bytes, Treffer, Abrufe, `stale`, Fehler, verdrängte Kacheln).
- Die Attribution `© OpenStreetMap` bleibt auf allen Karten sichtbar.

**Pi-Betriebsstand 02.11.2026:** aktiviert (512 MB, Volume `skyhub-next_tile_cache`); Live-Dashboard über Caddy lädt Leaflet und Kacheln ausschließlich vom Pi.

## Aktivieren auf dem Pi

Das ist eine bewusste Betriebsänderung, kein automatisches Deployment:

1. In `.env` `SKYHUB_TILE_CACHE_ENABLED=true` setzen (optional `SKYHUB_TILE_CACHE_MAX_MB`).
2. Backend gezielt neu bauen und anlegen, immer mit den Overlays: `bash scripts/pi-compose.sh up -d --build backend` (siehe [Betrieb](ops.md)). Nicht während einer Live-DJI-Sitzung.
3. Prüfen: `curl -sI http://127.0.0.1:4001/tiles/osm/10/536/347.png` zeigt beim zweiten Aufruf `X-SkyHub-Tile: hit`.

Zurück zum alten Verhalten: Variable auf `false` setzen und das Backend neu anlegen. Das Volume `tile_cache` kann bleiben oder mit `docker volume rm skyhub-next_tile_cache` gelöscht werden.
