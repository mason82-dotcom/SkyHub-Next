---
name: skyhub-drc-safe-integration
description: Safe DJI DRC integration review for SkyHub-Next RC Plus 2/Matrice 4, isolated simulator tests and controlled operator acceptance.
---
# SkyHub DRC – controlled activation and fail-closed development

Apply for `backend/drc-*.js`, `frontend/public/drc.*`, the RC simulator, or the existing DRC operational setup.

## Contracts and supported equipment
- DJI Cloud API 1.x RC Plus 2 + Matrice 4E/4T: flight and payload commands via the established `drc-runtime` / `drc-session` only.
- RC Pro Enterprise + Mavic 3E/3T/3M: payload/camera only; **never** add flight methods for RC Pro.
- Cloud API 2 PaaS/DevKit reference portal is a separate **GET-only** system. Do not mount DRC actions through it.
- Read `docs/drc-matrice4.md`, the DRC safety model in `docs/drc-matrice4.md`, `UX-CONTRACT.md` and `DESIGN.md` before changes.

## Hard safety boundaries
1. Do not turn on `SKYHUB_DRC_ENABLED`, edit production .env, create broker publish credentials, start scripts/brix-drc-setup.sh, change RC pairing, issue live MQTT commands or fly real aircraft as part of development.
2. Fail closed on missing/expired RC DRC state, no independent uplink heartbeat, broker disconnect, wrong gateway/model, missing operator lease, hidden tab and stale controller input.
3. Ensure only an explicit operator lease renews authority. Never infer authority from motion/payload packets.
4. No auto-takeoff, no autonomous flight dispatch or silently enabled control path. Emergency stop/hand-back must remain available for authenticated safety operations; document that loss of transport cannot guarantee hand-back.
5. All tests and simulations must use fake/isolated transports. Synthetic PASS never means a real RC/Pilot-2/hardware or flight acceptance.
6. Keep a separately logged and manually approved hardware acceptance with propellers removed, verified pilot takeover, independent kill/abort, timeout, network-loss testing.

## Checks
```sh
node --test backend/test/drc-rc-simulator-e2e.test.js backend/test/drc-session.test.js backend/test/drc-runtime.test.js backend/test/drc-payload.test.js backend/test/drc-protocol.test.js
node --check frontend/public/drc.js
```
For integration changes, test synthetic HTTP -> MQTT -> RC path, broker drop before/after handback, stale retained packets and moving actuator-stream cutoff. Synthetic MQTT still does not prove real Mosquitto/WLAN operation.

CI on the final commit is mandatory before changing a Draft PR to ready. No automatic merge or deployment.
