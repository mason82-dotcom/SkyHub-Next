# HiveMind reference lab for SkyHub Next (opt-in)

**Reference:** [cdmiltd/hivemind-simulator](https://github.com/cdmiltd/hivemind-simulator)
v1.4.10, pinned to commit `be269a3458ff6b2602d9a4dae14df278946cf7c1`
(2026-09-17). The upstream software is licensed under **AGPL-3.0**.
Its full source and license stay in the independently checked-out `.upstream/`;
this repository contains only original orchestration and guard scripts.
Do not import upstream Java classes or redistribute a modified binary without
reviewing the AGPL obligations. The shipped upstream JAR dependency is DJI Cloud API
SDK **1.16.1.3**, not evidence of SkyHub's target Cloud API **1.18** compatibility.

## Scope and known limitation

The overlay runs the upstream DJI Dock/Pilot simulator beside a fresh,
**disposable, private copy** of the SkyHub Next backend, PostGIS and Redis, all
in the Compose project `skyhub-hivemind-lab`, using a disposable Mosquitto broker.
SkyHub's real Pi EMQX (host 1884), Mosquitto (host 1883), legacy backend (4000),
and SkyHub Next staging backend (4001) are **not touched**. No broker port is
published to the host. Lab SkyHub HTTP is bound at **127.0.0.1:14001** and
the simulator console at **127.0.0.1:19090**. The Docker network is a dedicated, project-namespaced bridge, not shared with production stacks. The broker has no host port. Unlike a Docker `internal: true` network, the bridge supports these host-loopback HTTP bindings but does **not** prohibit outbound connections; never supply production credentials or endpoints.
The lab has its own isolated database, device IDs and volumes.

Start with the simulator's **Pilot-to-Cloud mode** (RC Plus / RC Plus 2 / RC Pro).
It publishes `update_topo` and, once online, RC/aircraft OSD. SkyHub continues
to consume MQTT topology/telemetry **read-only**. The optional `dock-rpc`
profile provides a **separate synthetic MQTT reply service** for Dock onboarding
(`config`, `airport_bind_status`, `airport_organization_get`,
`airport_organization_bind` and `update_topo`). The mock is not part of
the SkyHub backend, cannot authenticate real DJI equipment and is disabled
under the default `up` command.
Pilot mode in the pinned upstream simulator continues if `update_topo` acknowledgement
times out; this is not a claim of real hardware pairing or DJI approval.
Even a successful lab test does not validate actual RC Plus 2 / M4T / M3M hardware.

## Usage (developer machine or deliberately isolated Pi lab)

**Never invoke the upstream `docker-compose.yml` on the Pi.**
It contains fixed credentials, a hardcoded external network and colliding ports.
This integration deliberately does **not** reuse it.

Requires Git, Docker with Compose v2, network access to GitHub/Maven, and adequate
disk space/RAM. A local JDK is not necessary; Maven 3.9/Java 21 runs in a build
container. All commands are explicit; checking out this branch changes no service.

```bash
cd ~/Projekte/SkyHub-Next  # or a fresh checkout of mason82-dotcom/SkyHub
bash simulators/hivemind/lab.sh init-env   # once; local 0600 secrets; never commit
bash simulators/hivemind/lab.sh prepare    # fetch pinned upstream, build jar
bash simulators/hivemind/lab.sh config     # Compose validation only
bash simulators/hivemind/lab.sh up         # STARTS a separate lab stack
bash simulators/hivemind/lab.sh ps
bash simulators/hivemind/lab.sh smoke       # Pilot REST→MQTT→SkyHub E2E
bash simulators/hivemind/lab.sh dock-up     # explicit Dock RPC mock profile
bash simulators/hivemind/lab.sh dock-smoke  # full Dock registration + OSD
```

The automated `smoke` command uses only the two loopback APIs and the private
`lab.env` view token; it refuses to connect if the SkyHub backend is not the
expected read-only, non-recording test instance. It connects the simulator in
**Pilot / RC Plus 2** mode to the private broker, brings synthetic devices
online, changes simulated battery state, and checks that SkyHub's observed OSD,
accepted OSD and valid telemetry counters all increase and that matching
synthetic controller/aircraft records appear. It finally requests simulated
device shutdown. No DJI serial numbers, coordinates, passwords or tokens are
printed. **Run `smoke` only when the test simulator is offline**; if it is
already online the check fails rather than disrupting an existing session.
For Dock testing, the opt-in mock only responds to the four ordered methods
and the exact disposable organization `skyhub-lab-org` with binding code
`skyhub-lab-code`; wrong or out-of-order requests receive **no reply**.
The simulator `dock-smoke` uses the regular `/api/online` method without
`skip_register`, waits for successful registration and verifies fresh
topology and OSD reception in SkyHub before calling `/api/offline`.
The Dock E2E acceptance additionally triggers a synthetic `WIND_HIGH` HMS
event (expected code `0x160900BF`), verifies SkyHub's normalized alert
snapshot, and runs the separate one-shot `mission-probe.js` inside the
`dock-mock` container. That probe uses the simulator-generated Dock3 SN
(no SN override, which would desynchronize upstream MQTT subscriptions),
publishes ONLY `flighttask_prepare`, `flighttask_undo`,
`flighttask_execute`, `flighttask_stop`, `flighttask_pause`, and
`flighttask_recovery` on the lab broker, correlates
`services_reply` to the exact `tid`/`bid`, and verifies
`flighttask_progress` in both MQTT and SkyHub `/api/events`. It never
publishes to the Pi broker or creates a real DJI flight.
The `mission-probe.js` is an inert file until `dock-smoke` explicitly
executes it. Its generated Dock3 SN is checked against the known synthetic
model format, and no host port is exposed for MQTT.

Run the Pilot smoke first; it is intentionally unaffected by this new
Dock-only profile. For clean sequential tests, keep the lab simulator offline
before each smoke command.

The result is a software-level regression check, not a hardware acceptance
test. The simulator may wait approximately 10 seconds for a missing
`status_reply`; the Pilot-mode timeout is intentional in this phase.

Open the simulator at `http://127.0.0.1:19090` and SkyHub at
`http://127.0.0.1:14001`. Choose **Pilot** mode, use test-only device identities,
and point the simulator at MQTT host `hivemind-broker`, port `1884`, with blank
username/password. The simulator GUI can persist connection fields in the lab's
config volume; **check them before clicking Register/Online**. There is no need
for a DJI License or real DJI equipment in the MQTT Pilot-mode test. Never
configure the real Pi broker, DJI credentials or external storage credentials
in this lab.

Check SkyHub's `/api/health` on port 14001 for broker connection, subscription
and *separate* OSD counters, then open the authenticated dashboard using the
generated lab view token (read it privately from `lab.env`). Expected:
a synthetic RC topology plus OSD after bringing the simulated Pilot online.
Test missing/invalid OSD separately; `mqtt: true` does not prove telemetry was
received. The Dock-only acceptance additionally validates **synthetic** ground
`flighttask_undo` with a canceled progress event, refusal of an in-flight
`flighttask_stop` with result `326109`, and media metadata callbacks.
Neither a real flight nor a real S3/MinIO upload is authorized.

```bash
bash simulators/hivemind/lab.sh logs
bash simulators/hivemind/lab.sh down  # only lab; keeps its data volumes
```

For a quick **offline-only** verification of the orchestration and smoke-test
contract, run `python3 -m unittest discover -s tests -p 'test_hivemind*.py'`.
The regular SkyHub CI executes these offline tests without starting the simulator.
The separate `.github/workflows/hivemind-lab-e2e.yml` job builds the pinned
AGPL simulator and runs the Pilot **and Dock** synthetic MQTT acceptance tests on a
GitHub-hosted runner. This heavyweight workflow does not execute on the Pi.

To clean the lab data, examine project-specific volumes manually first.
**Never run `docker compose down -v` or prune volumes blindly.**
To use the lab on a remote Pi, keep ports loopback-only and use SSH port
forwarding rather than LAN/Tailscale publication. The integration makes no
changes to the existing EMQX ACL, Caddy, legacy Docker Compose or Pi `.env`.

## Verification / acceptance matrix

| Capability | Expected lab outcome | Caveat |
|---|---|---|
| Reproducible simulator source | Exact pinned upstream Git SHA | Build may fail if Maven dependencies are unavailable |
| Isolation | Lab project/network/volumes; no host MQTT port | Verify Compose output before running |
| Pilot topology | SkyHub sees `sys/product/+/status` | No physical onboarding verification |
| OSD/State | `lab.sh smoke` checks new OSD and normalized telemetry | Synthetic only; no genuine DJI 1.18 confirmation |
| Dock registration | `dock-rpc` opt-in mock: four sequential requests + topology reply | Synthetic success only; SkyHub production RPCs still unimplemented |
| Synthetic Wayline + HMS | `dock-smoke` verifies prepare, ground undo, canceled, execute, rejected in-flight stop, pause/recovery and HMS | No production command API or real flight |
| Media metadata and acknowledgements | `dock-smoke` verifies denied `storage_config_get`, priority event, 2 `file_upload_callback`, matching `events_reply`, `uploaded: false` | No STS, actual object storage, uploaded image bytes or Media API |
| Real media transfers / DRC / streams | Not covered | Requires separate integration and device safety tests |
| DJI Cloud API 1.18 / aircraft coverage | **Not proven** | Upstream bundles SDK 1.16.1.3; hardware tests remain necessary |

## Metadata-only media acceptance

The upstream `MediaSampleInitializer` populates **any non-empty configured
`media-dir`** with example photos and videos during startup. For this
test `SIMULATOR_MEDIA_MEDIADIR` is explicitly the empty string (also not
set by the container image), so the simulator uses its native synthetic
filename fallback and cannot read test-media files. The opt-in MQTT mock
answers `storage_config_get` with `result: 1` and no credentials, bucket,
endpoint or access key. It acknowledges only one priority event and two
predefined `file_upload_callback` metadata messages for the fixed test
flight, with matching `tid`/`bid`. The one-shot observer verifies
`events_reply` and `uploaded: false`, and SkyHub receives the callback.
No actual image upload, storage authorization or media analysis occurs.

SkyHub Next now parses these received MQTT events through a strictly
allowlisted, read-only adapter. The `/api/events` response and dashboard's
**Geräteereignisse** panel can show:
- `missionReport.reportedStatus`, `progressPercent`, `currentStep` and the
  optional numeric `breakReason` for a validated `flighttask_progress`;
- `mediaReport.kind` (`upload_priority_report` or
  `file_metadata_report`) with `storageVerification: "not_checked"`.

These are **device-reported protocol events**, not evidence of a real flight,
completed media persistence, verified S3 object, or available multispectral
pixels. Filenames, `object_key`, STS, flight IDs, position metadata and other
raw nested media payloads are not forwarded to the UI. No permanent media
inventory, raster pipeline, or binary-download endpoint is implemented here.

Verified by [CI runtime acceptance #39914157508](https://github.com/mason82-dotcom/SkyHub/actions/runs/39914157508), including Pilot, Dock, HMS, mission negative tests, and the metadata-only media handshake. A successful software test is not a hardware certification.
Do not configure a real `media-dir` or real STS credentials in this lab.

## Security and licensing

The simulator Web API and its MQTT monitor are development tools, not hardened
public services. Host HTTP ports are loopback-only; the Mosquitto broker permits
anonymous clients **only on the dedicated lab bridge** and has
no host port. This separate bridge is **not** an egress firewall. Never attach the lab to the live Pi broker or share its MQTT
network with production. For reproducibility, review upstream changes and
the supplied binary SDK before advancing the pinned revision.

**AGPLv3:** Keep the original copyright notices and access to the upstream
corresponding source. Modifying and network-serving the simulator can impose
additional source-sharing obligations. Separation is an architectural measure,
not an automatic legal exemption. The lab is explicitly offline from real
DJI devices. Use the official DJI documentation and genuine hardware to
qualify any flight-safety-sensitive feature.
