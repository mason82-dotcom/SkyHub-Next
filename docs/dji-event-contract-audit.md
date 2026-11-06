# P1 – DJI event contract audit (isolated, read-only)

Scope: Synthetic, offline inspection of DJI Cloud API event envelopes. The
`guipie/dji_server` project was used as a protocol and architecture reference;
no upstream GPL-3.0 source has been copied. Existing SkyHub parsers are reused.

## Scope and boundaries

- `backend/dji-event-contract-audit.js`: synchronous, redacted event contract inspector.
- `backend/test/dji-event-contract-audit.test.js`: offline Node regression tests.
- No wiring to `backend/server.js`, `backend/mqtt-ingest.js`, MQTT, Docker,
  database, flight dispatch, DRC, Pi services or device hardware.
- Requires caller-supplied **trusted** expected gateway SN; compares with the
  MQTT topic and any device-reported gateway field. Does not authorize the caller.
- Rejects malformed/oversized JSON, unsupported topics, retained, stale and
  future packets, unknown methods, invalid time and malformed reply flags.
- No raw payload, IDs, credentials, locations or ICAO values appear in the result.

## Critical `need_reply` distinction

| Wire value | Reported `replyObligation` | Side effects |
| --- | --- | --- |
| Integer `1` | `required` | None: no ACK is published |
| Integer `0` | `not-required` | None |
| Missing | `unknown` | None: do not infer zero |
| Other (boolean/string/null/etc.) | Rejected | None |

The flag describes the envelope only. It is **not** evidence that a specific
firmware/device is obligated to acknowledge an event and is never publication
authorization. This audit intentionally cannot send `events_reply`.

The `flighttask_progress` shape is validated using the existing SkyHub mission
parser; `airsense_warning` and `hms` reuse the existing allowlisted parsers.
For other recognized event types only the common envelope is checked.
`shapeValidated=false` must not be mistaken for complete payload validation.
Similarly, `accepted=true` does not imply a valid flight task or completion.

## Offline checks

```bash
node --test backend/test/dji-event-contract-audit.test.js
node --test backend/test/dji-flighttask-observation.test.js \
  backend/test/dji-flighttask-correlation-guard.test.js \
  backend/test/dji-flighttask-multimission-router.test.js
node scripts/dji-protocol-parity-audit.js
```

Existing flighttask reducer/journal modules handle idempotency, workspace
correlation and conflicting events. This inspector stores **no** history and
does not deduplicate retries. These issues must remain separate from an ACK
publisher and must be assessed against applicable DJI documentation and real
device/firmware captures before considering any runtime change.

## Acceptance gates

1. No MQTT publish, subscribe, broker connect, hardware action or stored data.
2. Explicit zero differs from missing `need_reply`.
3. Unknown method never gets a reply verdict or leaks its name.
4. Gateway mismatch, retained/stale/future, invalid payload fail closed.
5. `hardwareVerified`, `operationVerified` and `flightReady` stay false.

Reference implementation for analysis only:

- https://github.com/guipie/dji_server/blob/main/Dji.Application/Cloud/MqWaylineService.cs
- https://github.com/guipie/dji_server/blob/main/Dji.Application/Cloud/MqMediaService.cs
- https://github.com/guipie/dji_server/blob/main/Dji.Application/Cloud/MqAirSenseService.cs
- https://github.com/mason82-dotcom/SkyHub-Next/blob/main/docs/dji-rpc-lifecycle-observation.md

## P1.2 – Device-family and exact pairing gate (offline)

Module: `backend/dji-event-profile-audit.js`, with regression tests in
`backend/test/dji-event-profile-audit.test.js`.

The new **pure** inspector calls the existing P1.1 event parser first. Only
after the topic, gateway, bounded payload, `need_reply` flag and source-time
have passed those checks does it invoke a caller-supplied *synchronous*
`resolveTrustedPair(gatewaySn)` callback. That callback MUST resolve the
device from an independently authenticated workspace registry or a validated
test fixture. MQTT envelopes, self-declared model fields and user-supplied
pairing names cannot authorize it. This module does not itself implement
authentication or make a device online; it cannot be wired to public input
without a separate authorization review.

### Typed profile matrix (strict and intentionally narrow)

| Trusted gateway `domain:type:subType` | Profile | Required aircraft for Pilot / allowed paired aircraft for Dock |
| --- | --- | --- |
| `2:144:0` RC Pro Enterprise | `pilot-rc-pro-m3m` | `0:77:2` Mavic 3M |
| `2:174:0` RC Plus 2 Enterprise | `pilot-rc-plus2-m4t` | `0:99:1` Matrice 4T |
| `3:1:0` DJI Dock | `dock-1` | `0:67:0` M30; `0:67:1` M30T |
| `3:2:0` DJI Dock 2 | `dock-2` | `0:91:0` M3D; `0:91:1` M3TD |
| `3:3:0` DJI Dock 3 | `dock-3` | `0:100:0` M4D; `0:100:1` M4TD |

This is **not** a device-support list for full DJI control or firmware
compatibility. It is a **closed set of synthetic event-inspection profiles**
for the exact SkyHub pairs and the DJI Dock protocol families. Other known
models are intentionally rejected rather than inferred by shared type ID.
Dock may be classified with an identified Dock gateway and no aircraft
binding, but it never invents an aircraft. An explicitly provided but
incompatible aircraft binding is rejected.

Pilot profiles currently permit only the existing SkyHub *read-only parser
candidates* `hms` and `airsense_warning`. That is NOT evidence that either
device actually emitted these event shapes on a particular firmware.
Dock profiles recognize the P1.1 allowlist of Dock events, including
`flighttask_progress`, `flighttask_ready`, `file_upload_callback`, OTA/log
progress and AirSense/HMS. For all events, only the envelope and explicitly
marked parsers are validated. `shapeValidated=false` does not mean complete
method-specific payload validation. No publisher or flight authorization
is created for either family.

### Safety and evidence

- `need_reply=1` is reported as `required`; no `events_reply` is sent.
- Missing `need_reply` stays `unknown`; `0` stays `not-required`.
- Mispaired, untyped, unsupported or cross-gateway model bindings fail closed.
- Retained, stale, future, malformed and unexpected events are rejected
  **before** consulting the registry resolver.
- Neither raw payload nor device SN, credentials, AirSense ICAO/position,
  flight ID or object-storage key can leave in the audit DTO.
- All DTOs retain `hardwareVerified=false`, `operationVerified=false` and
  `flightReady=false`. Even a matched, terminal Dock progress event provides
  only event-shape evidence, not a flight completion.
- Nothing is imported by `backend/server.js` or `backend/mqtt-ingest.js`.
  No Pi/Broker/FlightHub/DRC/MinIO runtime change is performed.

Run offline (no Docker, MQTT or DJI hardware needed):

```bash
node --test backend/test/dji-event-profile-audit.test.js
node --test backend/test/dji-event-contract-audit.test.js
```

Reference protocol materials (no copied upstream source):

- https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dock-to-cloud/mqtt/dock/file.html
- https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dock-to-cloud/mqtt/dock/dock2/log.html
- https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dock-to-cloud/mqtt/dock/dock3/hms.html
- https://github.com/mason82-dotcom/SkyHub-Next/blob/main/backend/catalog.js
