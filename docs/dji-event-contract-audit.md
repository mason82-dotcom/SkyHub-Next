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
