# P3 – FlightHub 2 OpenAPI V2 provider, opt-in pure reader

Standalone independent from P0/P1/P2/P4/P5 and from DJI MQTT, Pilot 2 Cloud API and DJI Cloud API 2.
AeroNexus reference: `src/aeronexus/read_only_transport.py`, `flighthub_device_list.py`.

The module is **not imported into server.js**, so it has no runtime network access or Cloud commands.
When explicitly instantiated it requires a caller-provided exact HTTPS origin allowlist, private bearer token
and validated project UUID; it only sends a whitelisted GET device-list request, no follow-up requests,
no redirects and no retries. It emits sanitized, bounded fields excluding SN, GPS and credentials.
The test endpoint is synthetic; exact production origin, API auth and response shape remain to be confirmed
against the live FlightHub 2 EU OpenAPI before enabling.

Run: `node --test backend/test/aeronexus-flighthub-reader.test.js`.
No flight execution, asset synchronization or equipment merge. No hardware or Pi deployment.
