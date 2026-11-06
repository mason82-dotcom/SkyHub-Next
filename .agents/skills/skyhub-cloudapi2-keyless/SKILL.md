---
name: skyhub-cloudapi2-keyless
description: Read-only development guidance for the DJI Cloud API 2 reference portal in SkyHub Next; never activates DJI runtime or drone controls.
---
# SkyHub Cloud API 2: keyless development

Use this repository-local skill when editing the SkyHub-owned Cloud API 2 portal, client, module catalog, device projections, mock simulator, or AI prompt templates. It is **not** the DJI manufacturer plugin and does not install DJI libraries.

## References and boundaries

- DJI source: https://github.com/dji-sdk/Cloud-API-2/tree/main/devkit/skills (SDK core, device management, frontend, map and troubleshooting).
- The source is a **documentation/reference dependency**, not a runtime plugin installation. Pin and review upstream changes before adopting any code; this skill is SkyHub-owned, not a verbatim third-party copy.
- Current implementation: `backend/cloud-api2-portal.js`, `frontend/public/cloud-api2-*.mjs`, `frontend/public/cloud-api2.js`, `frontend/public/cloud-api2.html`.
- The SkyHub Cloud API 1.x registry is the only live data origin. Never claim this is an official Cloud API 2 backend or SDK.

## Required fail-closed rules

1. Keep all portal API calls same-origin `GET /api/cloud-api2/{status,devices,capabilities}`, behind the existing SkyHub API authorization. No new unrestricted endpoints.
2. Do not create MQTT publishers, DJI Cloud API 2 bridges, DRC/flight tasks, waypoint dispatch, mission release, camera control, device mutation, or automatic configuration.
3. Treat model names, device statuses, and telemetry as untrusted. Never expose serial numbers, coordinates, raw payloads, tokens, secrets or identifiers in the public portal projections.
4. Synthetic data remains in browser memory with `synthetic=true`, `hardwareVerified=false` and `flightReady=false`; never present simulation as live data or certify devices from CI.
5. Manufacturer AI/MCP tooling is not automatically allowed. In particular, DJI `fh_*` flight/control capabilities are **out of scope** and must never be enabled by a suggestion, import or deploy step.
6. A module link is navigation to an existing SkyHub page, **not** Cloud API 2 interoperability or verification. Do not claim linked modules are active on a live Pi without a dedicated runtime test.
7. Do not make a change to the Pi, broker, Docker stack, device pairing, native DJI runtime, firmware, secrets or production deployment within this skill.

## Review and verification

- `node --test backend/test/cloud-api2-keyless.test.js backend/test/cloud-api2-module-catalog.test.js`
- `node --check frontend/public/cloud-api2.js`
- `node --check frontend/public/cloud-api2-modules.mjs`
- Verify the three manufacturer categories (documentation / optional Java SDK / MCP with flight capabilities) are never conflated.
- Keep the existing test gates and require separate evidence for RC Pro Enterprise + Mavic 3M and RC Plus 2 + Matrice 4T. CI PASS is not hardware acceptance.
