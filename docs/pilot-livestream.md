# DJI Pilot 2 Livestream im Dashboard (Stand 02.11.2026)

## Ablauf

```
RC Pro (DJI Pilot 2, liveshare-Modul) --RTMP:1935--> MediaMTX (Pi, docker-compose.live.yml)
        --HLS/API (Docker-Netz "live")--> SkyHub-Backend /api/live/... --> Dashboard (hls.js)
```

- **DJI-Schnittstelle:** Pilot-2-JSBridge-Modul `liveshare` (wie in der offiziellen Cloud-API-Demo): `platformLoadComponent('liveshare', {videoPublishType:'video-by-manual', statusCallback})`, dann `liveshareSetConfig(2, {url})` (Typ 2 = RTMP).
- **Nur manuell:** Publish-Typ `video-by-manual`. Der Pilot startet und stoppt auf der SkyHub-Seite in Pilot 2 („Livestream starten/beenden“) oder in der DJI-Übertragungsansicht. SkyHub sendet **kein** `live_start_push` und keinen anderen MQTT-Dienst.
- **Zugangsdaten:** Die RTMP-Adresse samt Publish-Passwort bekommt die RC nur im authentifizierten HTTPS-Bootstrap (wie die MQTT-Zugangsdaten). Sie wird nie angezeigt oder gespeichert. Das Lese-Passwort kennt nur das Backend.
- **Nur ein Pfad:** MediaMTX nimmt ausschließlich den Pfad `pilot` an; der Publisher darf nur veröffentlichen, das Backend nur lesen und die Status-API abfragen. RTSP, WebRTC, SRT, MoQ, Aufzeichnung, Playback und Metrics sind aus.
- **Dashboard:** Block „Livestream · DJI Pilot 2“ in der Seitenleiste. Er erscheint nur, wenn der Server den Livestream aktiviert hat; hls.js 1.7.3 (Apache-2.0, selbst ausgeliefert unter `/vendor/hls.js/1.7.3/`, SRI-geprüft) wird erst dann nachgeladen. Das Backend öffnet die HLS-Sitzung bei MediaMTX und gibt sie nur als URL-Parameter weiter; der Browser erhält keine MediaMTX-Cookies oder Zugangsdaten.
- **Zugriff:** `/api/live/status` und `/api/live/hls/pilot/*` sind View-Token- oder LAN-lesbar (nur GET/HEAD), außerhalb des LAN `401`. `/api/health` enthält `liveStream`.
- **Format:** H.264 (+ AAC). H.265 spielt Chromium per MSE nicht ab. Latenz mit fMP4-HLS (1-s-Segmente) typisch 3–5 s.

## Aktivieren auf dem Pi

1. In `.env`: `SKYHUB_LIVE_ENABLED=true`, `SKYHUB_LIVE_RTMP_URL=rtmp://192.168.178.63:1935` und zwei verschiedene Passwörter (`openssl rand -hex 24`) für `SKYHUB_LIVE_PUBLISH_PASS` und `SKYHUB_LIVE_READ_PASS`.
2. Relay starten: `bash scripts/pi-compose.sh up -d mediamtx` (das Overlay wird wegen `SKYHUB_LIVE_ENABLED=true` automatisch eingebunden).
3. Backend aktualisieren: `bash scripts/pi-update-backend.sh --apply` (nimmt das Backend ins Netz `live` auf).
4. Pilot-2-Seite in DJI Pilot 2 neu öffnen. Unter „Livestream an SkyHub“ auf **Livestream starten** tippen; im Dashboard erscheint nach wenigen Sekunden das Bild.
5. Prüfen: `curl -s http://127.0.0.1:4001/api/health | grep -o '"liveStream":{[^}]*}'`.

Zurück: zuerst `bash scripts/pi-compose.sh rm -sf mediamtx` (solange `SKYHUB_LIVE_ENABLED=true` noch gesetzt ist), dann `SKYHUB_LIVE_ENABLED=false` in `.env` und das Backend erneut aktualisieren.

## Getestet (02.11.2026, ohne RC)

ffmpeg als RTMP-Quelle (1280×720, H.264 + AAC) gegen MediaMTX 1.21.2 und den echten SkyHub-Server: falsches Passwort und fremder Pfad abgelehnt; Dashboard in Chromium spielt ab (`currentTime` läuft), beim Stream-Ende wird das Video ausgeblendet; keine externen Anfragen. **Offen:** Abnahme mit echter RC Pro/Mavic 3M (Pilot-2-Firmware akzeptiert RTMP-URL mit Query-Parametern, Codec, Latenz).
