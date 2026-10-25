# MQTT / OSD integration – SkyHub Next 0.1.0

> **Profilnachtrag 23.10.2026:** Diese Seite dokumentiert die historische DJI-Abnahme auf EMQX/1884. Für den aktuellen Root-Stack ist zusätzlich Mosquitto/1883 als **ausdrückliches Opt-in** vorbereitet. Die historische RC-Pro/M3M-Abnahme überträgt sich nicht automatisch auf den Mosquitto-Broker. Weitere Sicherheits- und Betriebsschritte: [Pi-Mosquitto-Migration](pi-mosquitto-migration.md).

## Upstream reference

Functionality was reviewed against [OmerMersin/dji-cloud-platform-minimal](https://github.com/OmerMersin/dji-cloud-platform-minimal) (MIT License, © 2025 Ömer Mersin), particularly `mqtt_client.py` and `public/dashboard.html`.

The reference project **does not implement an MQTT broker**: it uses EMQX plus a Python/Paho MQTT subscriber. SkyHub Next keeps its existing EMQX instance and Node.js/MQTT.js backend. The implementation was adapted to SkyHub Next's security model, not copied wholesale.

Differences intentionally preserved:
- Existing Pi EMQX broker remains on TCP **1884**; do not launch a new EMQX instance on 1883.
- Keep the narrow subscriptions: `sys/product/+/status`, `thing/product/+/osd`, `thing/product/+/state`, `thing/product/+/events` and `thing/product/+/services_reply`. Do not subscribe to `sys/#` or `thing/#` with production credentials.
- Never print raw MQTT JSON, device serial numbers, licenses, authentication secrets or GPS coordinates into general application logs.
- Never expose MQTT credentials through a public `/api/config` endpoint.
- Pilot 2 is configured only through the existing authenticated HTTPS `POST /api/pilot/bootstrap`.
- DJI Cloud API message guards, topic allowlists, timestamp checks and GPS integrity tests continue to apply.

## Pilot 2 connection sequence (handshake)

Reconstructed from the Caddy access log, EMQX client list and SkyHub counters on 2026-10-20:

1. Pilot 2 opens `https://rpi5.fritz.box/pilot-login` (Caddy routes `/pilot-login*` and `/api/pilot/*` to 4001).
2. The page calls `GET /api/pilot/status`, then `POST /api/pilot/bootstrap` (Bearer token) for DJI app credentials and the Pilot MQTT login.
3. JSBridge: `platformVerifyLicense` → `platformSetWorkspaceId` → `platformSetInformation` → `platformLoadComponent('thing', {host, username, password, connectCallback})`.
4. Pilot 2 opens an MQTT session (client ID = RC serial), subscribes to its reply/service topics and publishes `update_topo` on `sys/product/{sn}/status`.
5. **SkyHub must answer `sys/product/{sn}/status_reply` with `result: 0`.** Only after that did the RC Pro publish OSD (observed: reply at 22:07:54, first OSD 2 s later, ~0.5 Hz).

Problems found and fixed:
- **No reply → no OSD.** `update_topo` was repeated and then the RC fell silent while the MQTT session stayed open. Fixed by enabling the topology publisher.
- **Reloading `thing` on an open session does nothing.** A second bootstrap at 21:59 did not create a new MQTT session and therefore no new `update_topo`; an unacknowledged session stayed stuck.
- **Pilot 2 reloads the page ~12 s after each bootstrap.** The old page then waited for the manual token again, so every open required typing it.

### Device pairing instead of a manual token

The page now pairs each RC once:
1. Unpaired RC: the page calls `POST /api/pilot/pair` and shows a 6-digit code.
2. On the Pi: `node scripts/pi-pilot-pair.js 123456` (or list with no argument). Approval goes to `/api/pilot-admin/*`, which requires the view token and is **not** routed by Caddy (loopback/SSH tunnel only).
3. The RC polls `GET /api/pilot/pair/{id}` and receives its own 256-bit device token **once**. It is kept in the Pilot WebView `localStorage` (as in DJI's demo auto-login); the server stores only its SHA-256 hash in Redis (`skyhub:pilot:devices`).
4. Every later open runs the handshake automatically with the device token. Revoke with `node scripts/pi-pilot-pair.js --revoke <id>`; the page then discards the token and shows a new code.

Pairing codes expire after 5 minutes, at most 5 are pending, start/poll require HTTPS. The shared `SKYHUB_PILOT_ACCESS_TOKEN` remains as a manual fallback under "Manuell mit Zugangstoken verbinden" and is never stored.

### Idempotent handshake

On every open the page:
- verifies the license only if `platformIsVerified()` is not already true;
- sets workspace and platform information (idempotent);
- loads `thing` only if it is not loaded;
- if loaded and disconnected: one automatic `thingConnect`, at most once per minute across reloads;
- if loaded and connected: asks `GET /api/pilot/session?gateway={rc_sn}` (device token) whether SkyHub acknowledged this RC's topology or receives fresh OSD from it. If neither holds after 15 s, it rebuilds the cloud session once (`platformUnloadComponent('thing')` + load), at most once per 10 minutes, so Pilot 2 publishes a fresh `update_topo`. A manual **Cloud-Sitzung neu aufbauen** button covers later cases.

Pilot credentials stay in WebView memory only; `thingGetConfigs()` is never called.

### Observed RC Pro Enterprise payloads

`GET /api/diagnostics/mqtt-shapes` on the live RC (no aircraft):
- `osd`: `app_version, capacity_percent, height, latitude, longitude, wireless_link`
- `state`: `dongle_infos`
- `status/update_topo`: `domain, type, sub_type, thing_version, sub_devices, device_secret, nonce` (secrets are never stored)

### Restart test 2026-10-20: Pilot 2 and RC restarted after pairing

Setup: RC Pro Enterprise paired (device token), Mavic 3M on, EMQX hardened (authentication + `{deny, all}` ACL), topology acknowledgement enabled. Evidence from the Caddy access log, `emqx ctl clients list`, broker metrics and the SkyHub health/events API:

| Time (CEST) | Event |
|---|---|
| 22:54:24 | Last Pilot page open before the restart: bootstrap with the stored device token, no pairing code |
| 22:55:39 | Last OSD; the RC goes offline (Pilot/RC restart) |
| 22:56:47 | RC reconnects to EMQX with the Pilot account; all 14 subscriptions granted |
| 22:56:50-51 | 3 × `update_topo`, each acknowledged with `status_reply` |
| from 22:56:52 | OSD from RC and Mavic 3M fresh again; live topology (not restored) with the aircraft as child; 8 HMS alerts active |

Findings:
- **Pilot 2 restores the cloud connection on its own.** No request to `/pilot-login` or `/api/pilot/*` after 22:54:24: Pilot keeps the thing module configuration and MQTT credentials across restarts. The pairing page is only needed for first setup or after the cloud module was unloaded.
- No new pairing code; the device stays paired.
- Broker hardening holds: authentication successes 112 → 113 (the RC), 0 failures, no authorization denials.
- Outage from last OSD to first acknowledged topology: about 70 s.

Still untested on hardware: the in-flight (`_in_the_sky`) HMS texts.

## Device-side JSBridge diagnostics

The DJI Pilot 2 login page now includes **DJI-Status prüfen**.
It queries three read-only JSBridge APIs independently:

- `platformIsVerified()`: did DJI itself confirm Cloud API license verification?
- `platformIsComponentLoaded('thing')`: did Pilot 2 load the MQTT/thing module?
- `thingGetConnectState()`: does Pilot 2 currently report an MQTT session?

A return with a nonzero `code` is shown only as a bounded numeric DJI error code; the vendor `message` and all raw return objects are never displayed. The page does not call `thingGetConfigs()`, because that can contain MQTT credentials. A clean HTTPS page hides the generic yellow HTTPS requirement advisory.

The presence of an active EMQX client with a matching username does not by itself identify the remote controller; it could be a separate test client. Correlate Pilot 2's reported status with broker client evidence before enabling topic publishing. The three diagnostic statuses are intentionally distinct and do not imply verified OSD delivery.

## OSD diagnostics

The read-only backend additionally counts allowlisted incoming MQTT **topic deliveries before parsing**, without storing raw messages:

| Health field | Meaning |
|---|---|
| `mqttObservedPackets` | Total deliveries for allowlisted DJI topic shapes, including subsequently rejected messages |
| `mqttObservedOsdPackets` | Raw deliveries on `thing/product/{sn}/osd`, before JSON, timestamp and registry checks |
| `mqttLastObservedOsdAt` | Last delivery time of an OSD topic; not proof of valid telemetry |
| `mqttObservedChannelCounts` | Per-channel observed deliveries without serial numbers |
| `mqttOsdMessages` | OSD messages accepted after validation and registry handling |
| `mqttValidTelemetryUpdates` | OSD updates with usable telemetry fields |
| `mqttLastTelemetryAt` | Last accepted usable OSD update (backend reception time) |
| `topologyReplySent` / `topologyReplySkipped` / `topologyReplyLastAt` | `status_reply` publications, skipped replies (validation failed or publisher offline), last successful reply |

Counters are in-memory and reset on backend restart. A raw OSD delivery **does not** imply authenticated DJI origin, a fresh aircraft position, valid GPS, or a current device session.

Diagnostic interpretation:
- `mqttObservedOsdPackets=0` with `mqttObservedChannelCounts.status>0`: the subscriber receives some status topics, but no OSD topic matching the allowed pattern. Check Pilot-to-broker MQTT publishing, routing and broker ACL.
- Observed OSD above zero but accepted OSD zero: examine `mqttDroppedByReason`, timestamp validation and JSON shape.
- Accepted OSD above zero but telemetry updates zero: compare against the DJI Cloud API 1.18 OSD field layout; never infer missing values as zero.
- Positive telemetry updates: then check the time and age; old packets are not a live flight feed.

The separate, optional `update_topo` acknowledgment publisher remains **off by default** (`SKYHUB_TOPOLOGY_ACK_ENABLED=false`). Enable it only after verifying the dedicated EMQX write ACL on `sys/product/+/status_reply`; do not reuse Pilot credentials as a server publisher.

## Hardware finding 2026-10-20: RC Pro Enterprise online, no OSD

Observed live on the Pi with a DJI RC Pro Enterprise (topology `domain 2 / type 144 / sub_type 0`, thing version 1.2.0) logged in through `/pilot-login`:

- EMQX lists a client whose client ID is the RC serial number; it subscribes to `sys/product/{sn}/status_reply`, `thing/product/{sn}/services`, `property/set`, `events_reply`, `requests_reply`, `state_reply` and `sys/product/{sn}/network/probe`. This is the RC itself, not a test client.
- SkyHub received `update_topo` six times within ~100 s and 25 `state` messages, but **zero OSD topic deliveries**. `sub_devices` was empty (no aircraft in the topology).
- EMQX had delivered **0 messages** to the RC: no `status_reply` was ever sent, because `SKYHUB_TOPOLOGY_ACK_ENABLED` was off.

Per DJI Cloud API, the cloud acknowledges `update_topo` on `sys/product/{gateway_sn}/status_reply` with `data.result=0`; until then Pilot 2 repeats `update_topo` and does not treat the device as online. The missing reply is therefore the leading explanation for absent OSD. It is a hypothesis until a reply is sent and OSD is observed.

Consequences in code:
- `pi-mqtt-osd-check.js` now reports this case explicitly (status present, OSD absent, reply disabled).
- Health adds `topologyReplySkipped` and `topologyReplyLastAt`; a reply that fails validation or has no connected publisher is logged (without payload) instead of being silent.
- `GET /api/diagnostics/mqtt-shapes` (view token required) lists channel, method, `need_reply` count and top-level **field names** of received messages. No values, coordinates or serial numbers. Use it to align the parser with the real firmware instead of ad-hoc sniffing.

### EMQX access control (not changed by SkyHub)

The existing `skyhub_emqx` (5.3.0) has no authenticator configured and `acl.conf` ends with `{allow, all}`, while TCP 1884 is published on all interfaces. Consequently any LAN client can connect anonymously and publish to any topic, including `thing/product/+/services` and `property/set`. The "publish-only on `status_reply`" restriction for the topology publisher is **not enforced** by the broker today; the separate account only keeps the roles distinguishable for when ACLs are introduced.

Hardening is scripted: `node scripts/pi-emqx-harden.js plan|apply|verify|rollback`.
`apply` exports an EMQX backup, creates a temporary dashboard admin through `emqx ctl` (deleted afterwards), enables the built-in database authenticator with the three accounts from `.env`, verifies logins, sets the ACL with `{deny, all}`, verifies 9 permission probes and checks that the connected RC keeps delivering OSD. Any failed check rolls back to the previous state automatically. Configuration is stored by EMQX in its data volume and survives restarts of the same container.

Probe result before hardening (2026-10-20): anonymous login and wrong passwords accepted; the topology publisher could send `services` commands; the Pilot account could read all OSD and forge `status_reply`.

The original manual plan for reference:
1. Enable the built-in database authenticator; create distinct users for Pilot 2, the SkyHub read-only subscriber and the topology publisher.
2. ACL: Pilot user may publish its own `thing/product/{sn}/#` / `sys/product/{sn}/status` and subscribe to the reply/service topics; SkyHub subscriber subscribe-only on the five allowlisted patterns; topology publisher publish-only on `sys/product/+/status_reply`; final rule `{deny, all}`.
3. Then re-verify with `emqx ctl clients list` and the health counters.

## Local validation on the Raspberry Pi

**Updated 2026-10-23:** The old `feature/mqtt-osd-integration` checkout
instruction is obsolete. The covered MQTT adapter is already in `main`;
do **not** switch branches inside an existing Pi deployment merely to check
historical integration. Hardware acceptance for RC Pro Enterprise + M3M was
documented on 2026-10-20/21; further DJI 1.18 device support remains partial.
The broker/ACL details above are observations dated 2026-10-20, not current
verified EMQX state. See [project status](projektstand-2026-10-23.md).

```bash
cd ~/Projekte/SkyHub-Next
git status --short --branch
git rev-parse HEAD
docker compose -p skyhub-next ps

# Source-only checks in the existing checkout; no branch switching.
node --check backend/server.js
node --check backend/mqtt-metrics.js
node --check frontend/public/pilot-login.js
node --test backend/test/*.test.js
docker compose -p skyhub-next config --quiet
```

None of these commands deploys, restarts or changes containers. Do **not** `git reset --hard`, `git clean -fd`, `docker compose down -v`, or blindly `git add .` on the Pi.

After those checks, a deployment of **only** the backend can be considered separately. Retain the current Compose override and Caddy routes. Do not switch broker ports, Docker project names, or start extra stacks.

## Validation boundary

The October 20–21 hardware observations **did** establish a working RC Pro Enterprise / Mavic 3M topology and real accepted OSD after the separately controlled `status_reply` path was enabled; see [RC Pro + M3M hardware report](hardware-rc-pro-m3m.md). This is a **device-/firmware-/time-specific** result, not a blanket Cloud API 1.18 conformance statement. RC Plus 2/M4T, Dock, 1.18 service contracts, media, wayline upload and flight controls each require their own acceptance. Version remains **0.1.0** unless explicitly released.
