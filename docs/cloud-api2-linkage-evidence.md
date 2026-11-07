# DJI Cloud API 2 reference portal – verifiable evidence linkage, P0

**Status: 07.11.2026.** This is a SkyHub-owned keyless audit on top of existing Cloud API 1.x data. No DJI Cloud API 2 runtime, PaaS, bridge or MCP server is activated.

## Scope and trust boundary

- Read-only `GET /api/cloud-api2/linkage` is mounted **after** `app.use('/api',auth)`. The existing explicitly configured, trusted home-LAN **GET/HEAD read-only allowlist** now includes this aggregate endpoint. Outside that LAN, valid existing view-token authentication is still required. No token is requested or embedded in the frontend.
- Query is explicit on operator click in the **Nachweise** section; no polling or automatic request on page load. No writes, MQTT publishes, DRC actions, mission dispatch, new database tables or Pi/container changes.
- Backend reads bounded snapshots from `registry.snapshot()`, existing `wpmlStore.all()`, and workspace-scoped `SELECT count(*)` from `dji_pilot_media_verified`. A missing/malformed source becomes `unknown` or `unavailable`, never an implied zero or success.
- No individual identifier is returned: no serial number, WPML ID, SHA digest, media ID, object key, session identifier, workspace UUID, source filename, GPS coordinate or mission label. All exposed counts have maximum bounds. No data correlation by similar filename, approximate timestamp, coordinates or model name.

## Actual verification levels

| Evidence | What can be established | What it cannot prove |
| --- | --- | --- |
| DJI registry topology | Aircraft model key can be derived from a subdevice with currently online aircraft with fresh, timestamp-verified OSD and live, timestamp-verified topology (restored snapshots excluded) | Historic execution by that serial number; pilot/airframe acceptance |
| WPML store | SHA-256 metadata has the correct deterministic RFC9562-like v8 UUID relationship; DJI model enum is structurally valid | Byte-for-byte rehash of current KMZ, flight permission, actual deployment or flight |
| Device / mission comparison | Exact DJI aircraft model-key equality produces **candidate-only** combinations | Which of several devices actually used the mission; execution by any specific device |
| Pilot media DB | Workspace-scoped count of ingestion records that passed STS + S3 HEAD at **ingestion time** | Current object integrity without HEAD recheck, XMP/CaptureUUID authenticity, actual photo capture |
| Cross-domain triple | `deviceMission`, `missionMedia`, `deviceMedia` remain **not-established** and `verified=0` | Any assertion of completed flight, proven image/mission linkage, thermal calibration |

An existing DJI `file_group_id`, similar capture time, thermal JPEG suffix or matching aircraft type must not be treated as evidence of a cross-domain relation.

## Required evidence for later P1 binding

1. **Device↔mission:** A replay-protected independent execution observation that includes exact authenticated aircraft identity, workspace, immutable WPML SHA-256/wayline revision and verified event timestamp. A Pilot 2 route being visible in a library is insufficient.
2. **Mission↔media:** An independent origin receipt or authenticated flight/media manifest binding the exact immutable mission revision and the media object/fingerprint, with a HEAD recheck and, when needed, content hash. A filename or proximity in time is insufficient.
3. **Device↔media:** An authenticated DJI origin record binding the media object to a confirmed aircraft identity. User-editable EXIF/XMP serials or Pilot upload callback fields alone are insufficient. For M3M, four-band CaptureUUID validation proves only a grouping candidate; not the originating aircraft, calibration or mission execution.
4. **Cross-validation:** All receipts must be workspace-scoped, bound to immutable content digests, freshness/replay-checked, conflict-rejecting and independently auditable. Only then can a new verifier add a genuine status `verified` for a particular relation. The P0 endpoint intentionally has no such status.

## Safety controls

`hardwareVerified=false`, `flightReady=false`, `deviceCorrelation=not-established`, `modelCompatibility.validatedExecution=false`. Read-only API is not a flight clearance. The model-compatible candidate count is an integer, not an asserted 1:1 mapping.

Run from `backend/`:

```sh
node --test test/cloud-api2-linkage.test.js test/cloud-api2-evidence.test.js test/cloud-api2-keyless.test.js
node --check cloud-api2-linkage.js
node --check ../frontend/public/cloud-api2-linkage.mjs
```

The CI checks use synthetic fixture records only. Hardware acceptance for RC Pro Enterprise + Mavic 3M, RC Plus 2 + Matrice 4T, live media callbacks, Pi-PostgreSQL permissions and actual object HEAD checks must be performed separately before operational use.
