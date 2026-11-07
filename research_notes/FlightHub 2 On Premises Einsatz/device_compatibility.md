# DJI FlightHub 2 On-Premises: device compatibility (as of 2026-10-24)

Scope: which aircraft, RCs, docks and payloads FlightHub 2 On-Premises (FH2 OP) supports, focused on two setups:
(1) RC Pro Enterprise + Mavic 3 Multispectral (M3M); (2) RC Plus 2 Enterprise + Matrice 4T (M4T).
Research date: 2026-10-24. Latest FH2 OP release: V2.0.1 (2026-10-21). No GitHub sources were used.

## Official compatibility list; is the M3M supported?

### Takeaway
No. The M3M is **explicitly excluded** from FlightHub 2. DJI's FlightHub 2 support FAQ lists "Mavic 3 Enterprise series (excluding DJI Mavic 3 Multispectral)". DJI's own M3M support page answers "Not currently" to FH2 access. The FH2 OP release notes from V1.0 (2024-09) to V2.0.1 (2026-10) never mention the M3M, so nothing has been added. **Setup 1 (RC Pro Enterprise + M3M) is not supported in FH2 On-Premises.** The RC Pro Enterprise itself does appear in the OP firmware tables, but in its role as the Mavic 3E/3T controller.

### Cited Findings
- DJI FlightHub 2 support page FAQ, "Which devices does DJI FlightHub 2 support?" (German locale, undated). Docks: "DJI Dock 3, DJI Dock 2 und DJI Dock." Aircraft: "DJI Matrice 400, DJI Matrice 350 RTK, die DJI Matrice 30-Serie, die DJI Matrice 4-Serie, die DJI Matrice 4D-Serie, die DJI Mavic 3 Enterprise-Serie (ausgenommen DJI Mavic 3 Multispectral), usw." Payloads: "die Zenmuse H30-Serie, die Zenmuse H20-Serie, Zenmuse S1 und Zenmuse V1." No RCs are listed. The list ends with "usw." (etc.), so it is not exhaustive. The page also says FH2 is offered both as a cloud service and as "DJI FlightHub 2 On-Premises", but it gives no separate OP device list. — [DJI Support: FlightHub 2](https://www.dji.com/support/product/flighthub-2)
- DJI Mavic 3M support page FAQ: "Does DJI Mavic 3M support access to DJI Flighthub 2?" Answer: "Not currently." (undated) — [DJI Support: Mavic 3M](https://www.dji.com/support/product/mavic-3-m)
- Secondary source: Heliguy says "No, DJI Mavic 3 Multispectral does not currently support DJI FlightHub 2." (undated) — [Heliguy KB](https://www.heliguy.com/blogs/knowledge-base/does-dji-mavic-3-multispectral-support-access-to-dji-flighthub-2/)
- Secondary source: Heliguy's FH2 On-Premises article (updated 30 Jan 2026) lists OP supported hardware as follows. Drones: "DJI M350/M300 RTK; DJI Mavic 3 Enterprise Series (but not Mavic 3 Multispectral); DJI Matrice 4 Enterprise; DJI M30 Series." Docks: "DJI Dock 3 (including Matrice 4 Series); DJI Dock 2 (including Matrice 3D Series); DJI Dock (Matrice 30 Series Dock Version)." Payloads: "H30 and H30T; H20, H20T, and H20N." Accessories: "D-RTK 3 Relay Station; DJI AS1 Speaker and AL1 Spotlight." It also says "FlightHub 2 On-premises upgrades and manages the firmware through offline upgrade packages." — [Heliguy: FH2 On-premises](https://www.heliguy.com/blogs/posts/dji-flighthub-2-on-premises-enhanced-drone-data-security/)
- Devices that the FH2 OP release notes add over time (official, fh.dji.com OP release notes page):
  - V1.1 (2025-02-27): M300/M350 RTK camera view and payload livestream; Mavic 3 Enterprise gimbal camera live flight controls; "Matrice 4 Enterprise Aircraft: Supports live flight controls of the aircraft and gimbal camera" plus AI recognition; Dock 3 features; D-RTK 3 Relay, AS1, AL1; Zenmuse H30/H30T/H20/H20T/H20N.
  - V1.2 (2025-06-10): "live flight controls of Matrice 4D series aircraft when connected via remote controller".
  - V1.3 (2025-10-14): "Supports the Mavic 3T Advanced enterprise aircraft, its gimbal camera, and connected PSDK accessories"; Manifold 3.
  - V1.4 (2025-12-23): M400 + Zenmuse L3 route planning.
  - V1.6 (2026-06-16): O4 Ground Station.
  - V2.0 (2026-10-14): "DJI FlightHub 2 now supports DJI Dock 4" ("DJI Dock 4 currently supports HTTPS only").
  - The M3M is not mentioned in any version, and no device removals are noted.

  — [FH2 On-Premises release notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- FH2 cloud (public) release notes: no mention of the Mavic 3 Multispectral. Mavic 3E/3T were added 2022-09-27, and "remotely controlling the Mavic 3 enterprise series gimbals" was added 2024-07-18. The latest public versions are 2026-10-22, 2026-10-14 and 2026-09-23. — [FH2 Public release notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-public.html)

### Inferences
- Cloud vs. On-Premises: DJI publishes no separate OP device list. The OP release notes track the cloud feature set (V1.4 was described as aligning with the public version; secondary source, see the search summary below). Both share the same M3M exclusion, so the M3M is not supported in either edition.
- "Mavic 3 Enterprise series" in FH2 terms therefore means M3E, M3T and (since OP V1.3) the Mavic 3T Advanced, but not the M3M. That holds even though DJI markets the M3M under the Mavic 3 Enterprise umbrella and it uses the same RC Pro Enterprise.
- Because the RC Pro Enterprise is listed in the OP firmware tables, the controller can connect to FH2 OP when paired with an M3E/M3T. The blocking element is the M3M aircraft.

### Gaps
- None of DJI's support pages carry a date. I could not confirm the date the "excluding Mavic 3 Multispectral" wording was last reviewed, although nothing from 2025-2026 contradicts it.
- I found no official DJI statement on *why* the M3M is excluded, or whether a partial mode exists (for example, telemetry only). No source describes partial M3M support.
- The extracted text of the FH2 AIO user manual (German, "V1.1 (On-Premises Version V1.7)") contains no device compatibility list.

## Matrice 4 series (M4T/M4E) in On-Premises; minimum firmware / Pilot 2

### Takeaway
**Setup 2 (RC Plus 2 + M4T) is supported.** "Matrice 4 Enterprise" (M4E/M4T) has been in the OP release notes since V1.1 (2025-02-27), with live flight control of the aircraft and gimbal and AI recognition, and 500MP panoramas from V1.5 (2026-04-29). The only published OP firmware table is in V1.1. Its minimums: Matrice 4 Series aircraft 12.00.01.07, DJI RC Plus 2 01.61.03.03, and DJI Pilot 2 listed as "99.0.0.1". That last value looks like a placeholder; treat it with caution. Releases after V1.2 publish no firmware tables.

### Cited Findings
- OP V1.1 (2025-02-27) firmware table. Matrice 350 RTK 10.01.08.05; Matrice 300 RTK 60.01.08.06; Matrice 30/30T 10.01.05.04; DJI RC Plus 05.02.13.02; **Mavic 3 Enterprise Series 10.01.05.03; DJI RC Pro Enterprise Version 02.01.05.10; Matrice 4 Series 12.00.01.07; DJI RC Plus 2 01.61.03.03**; Dock 3 99.99.92.50; Dock 2 10.01.32.05; Dock 10.01.02.05; DJI Pilot 2 "99.0.0.1". — [FH2 OP release notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- OP V1.0 (2024-09-24) firmware table: Matrice 3D/3TD 10.01.1607; DJI RC Pro Enterprise Version 02.01.0507; Dock 2 10.01.1607; M30/30T 10.01.0014; RC Plus 05.02.1106; Dock 10.01.0205; DJI Pilot 2 10.1.0.30. Matrice 4 is not listed yet. This table is older than 2025, so treat it as possibly outdated. — [FH2 OP release notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- OP V1.2 (2025-06-10): the firmware list was moved to an external PDF. I did not retrieve that PDF. — [FH2 OP release notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- OP V1.5 (2026-04-29): "DJI Dock 3 and Matrice 4 Enterprise now support 500MP high-definition panoramas" (search summary: 3x zoom for sphere panoramas); speaker and spotlight alert actions. — [FH2 OP release notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- FH2 cloud: "DJI FlightHub 2 now supports DJI Matrice 4 enterprise series" (2025-01-08). "Gimbal tilt angle of Matrice 4T when performing waypoint routes is now extended to 70 degrees" (2025-04-15). — [FH2 Public release notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-public.html)
- Matrice 4 Series firmware release notes, per a search-result summary (the PDF was not opened directly). On 2025-10-14, aircraft firmware v14.03.00.12 added remote control of speaker and spotlight through Live Flight Controls in FlightHub 2. On 2025-12-24, v16.01.00.06 added multilingual speaker text-to-speech. — [DJI Matrice 4 Series Release Notes PDF (2025-12-24)](https://dl.djicdn.com/downloads/DJI_Matrice_4_Series/20251224/DJI_Matrice_4_Series_Release_Notes_EN.pdf)
- Secondary source: Heliguy lists "DJI Matrice 4 Enterprise" and "DJI Dock 3 (including Matrice 4 Series)" as OP-supported (updated 2026-01-30). — [Heliguy](https://www.heliguy.com/blogs/posts/dji-flighthub-2-on-premises-enhanced-drone-data-security/)

### Inferences
- The V1.1 minimums are the earliest tested baseline. In practice, the firmware to use is whatever the current OP version ships as offline upgrade packages. For OP V2.0.x, use current M4T and RC Plus 2 firmware (at least the Oct/Dec 2025 builds if speaker/spotlight control matters).
- "Matrice 4 Series" in the firmware table covers M4E and M4T. The 2025-04-15 cloud note names the M4T explicitly.

### Gaps
- There is no published OP firmware/Pilot 2 compatibility table for V1.3 to V2.0.1. The V1.2 external firmware PDF was not retrieved.
- The DJI Pilot 2 "99.0.0.1" entry is unexplained. It could be a placeholder, or the Pilot 2 build that ships with the RC firmware.

## Feature-level support per device

### Takeaway
DJI documents features incrementally in release notes, not as a per-device feature matrix. For **M4T + RC Plus 2**, the following is documented in OP: device management/binding, live flight controls of the aircraft and gimbal (V1.1), AI recognition (V1.1), waypoint routes (M4T gimbal tilt up to 70 degrees, from the cloud notes), 500MP panoramas (V1.5), and speaker/spotlight control via Live Flight Controls (M4 firmware Oct 2025). Live telemetry/map, livestream, media upload and HMS are generic FH2 features for all supported aircraft. I found no device-specific exclusions for the M4T. For the **M3M**, no features are available because it is not supported. Multispectral outputs are processed in DJI Terra/SmartFarm, not FH2.

### Cited Findings
- OP V1.1: Matrice 4 Enterprise "Supports live flight controls of the aircraft and gimbal camera", plus AI recognition. Mavic 3 Enterprise gets gimbal camera live flight controls. M300/M350 get camera view and payload livestream. — [FH2 OP release notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- OP V1.4: "Added support to select 3× or 7× zoom lens for flight route planning in patrol route." — [FH2 OP release notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- OP V2.0 limitations: "Copilot features are not yet supported"; "Stream input from DJI consumer drones and handheld devices is not yet supported"; "remote maintenance, login screen customization, and alert rule modification are temporarily unavailable." — [FH2 OP release notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- OP V1.5: "files deleted from the media file library, model library, and design files will be permanently deleted" (media library in OP). — [FH2 OP release notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- The FH2 AIO manual (V1.1 for OP V1.7) lists livestream ports: RTMP 1935/30831/30832 and WebRTC 8000/8001/8002, switchable WebRTC/RTMP. It also lists Terra connection ports 30826/30827 and an elevation data service on 30829. — [FH2 AIO User Manual (DE) PDF](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/DJI%20FlightHub%202%20AIO_Benutzerhandbuch_de.pdf)
- The M3M FAQ refers only to "DJI Terra or DJI SmartFarm Platform" for mapping position compensation. — [DJI Support: Mavic 3M](https://www.dji.com/support/product/mavic-3-m)

### Inferences
- The AIO manual's Terra ports suggest that mapping/reconstruction in OP is done by connecting DJI Terra. That is separate from whether the aircraft is supported.

### Gaps
- I found no official per-device matrix (telemetry / video / waylines / media / HMS / cockpit) for OP. HMS support for the M4T in OP is not explicitly stated in the notes I read.

## How a controller connects to an On-Premises server

### Takeaway
In DJI Pilot 2, open Cloud Services and choose the FlightHub 2 option. The AIO manual's aircraft step literally says "FlightHub 2 Cloud Platform", and its dock step says "FlightHub 2 On-Premises Version". The RC must be on the same network as the server. Dock binding requires the access address `${SERVICE_DOMAIN}:${BACKEND_TCP_PORT}`, organization ID, binding code and dock name. HTTPS is optional: a self-signed certificate is the default (DJI says it is for testing only), or you can upload a custom CA-signed .crt/.key. Dock 4 requires HTTPS.

### Cited Findings
- AIO manual, "Fluggerät an Organisation binden" (bind aircraft to organization). The RC must be on the same network as the AIO. In Pilot 2, tap the settings icon at top left and log in to the DJI account. Tap Cloud-Dienste (cloud services) and select "FlightHub 2 Cloud Platform", then choose the organization and project. Tap Gerätebindung (device binding) to bind the aircraft; the admin then sees it under Geräteverwaltung (device management). — [FH2 AIO User Manual (DE), V1.1 / OP V1.7](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/DJI%20FlightHub%202%20AIO_Benutzerhandbuch_de.pdf)
- AIO manual, dock cloud configuration. Connect the RC to the dock via USB-A to USB-C, then in Pilot 2 open the dock's cloud service settings and "wählen Sie FlightHub 2 On-Premises Version aus" (select FlightHub 2 On-Premises Version). Enter the Zugriffsadresse (access address) `${SERVICE_DOMAIN}:${BACKEND_TCP_PORT}`, the Organisations-ID (organization ID), the Gerätebindungscode (device binding code) and the Dock-Name (dock name). — [same PDF](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/DJI%20FlightHub%202%20AIO_Benutzerhandbuch_de.pdf)
- OP V1.0: dock binding via Pilot 2 with "FlightHub 2 On-Premises Version" selectable. — [FH2 OP release notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- AIO manual, HTTPS: an HTTPS-Status toggle. Certificate options are "Selbstsigniertes Zertifikat (Standard, geringere Sicherheit)" (self-signed, default, lower security) or "Benutzerdefiniertes Zertifikat (erfordert das Hochladen von .crt- und .key-Dateien)" (custom, requires uploading .crt and .key files). Custom certificates should come from a trusted CA, and "Selbstsignierte Zertifikate dienen nur zu Testzwecken; Produktionsumgebungen erfordern konforme Zertifikate" (self-signed certificates are for testing only; production environments require compliant certificates). The web UI is at `http://${SERVICE_DOMAIN}:${FRONTEND_TCP_PORT}`. — [same PDF](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/DJI%20FlightHub%202%20AIO_Benutzerhandbuch_de.pdf)
- OP V1.5 adds "one-click HTTPS certificate retrieval". OP V2.0 says "DJI Dock 4 currently supports HTTPS only". OP V1.4 explains that when the dock, aircraft and FlightHub are on different subnets, you set `MULTIPLE_IP_ENABLE` to True in ENV. — [FH2 OP release notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- OP V1.7: incremental upgrades only between adjacent versions ("1.6.n > 1.7.n"). The AIO manual says V1.5.x cannot be upgraded directly to V1.7.0, and V1.4 (2025.12.23) or older needs a compatibility upgrade path. — [FH2 OP release notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html); [AIO manual](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/DJI%20FlightHub%202%20AIO_Benutzerhandbuch_de.pdf)

### Inferences
- The aircraft step's "FlightHub 2 Cloud Platform" label in the German AIO manual may be a translation or menu-text inconsistency. The dock step and the V1.0 notes use "FlightHub 2 On-Premises Version". Verify the actual Pilot 2 menu on the RC.
- Inconsistency: the download page dates the AIO manual 2026-04-30, but the manual is titled for OP V1.7, which was released 2026-08-06. The manual may have been updated in place.

### Gaps
- I found no official statement on whether Pilot 2 on the RC accepts a self-signed certificate for the aircraft (non-dock) login, or whether HTTP is allowed for RC connections.

## Differences between On-Premises versions (2025-2026)

### Takeaway
OP versions (dates from the official OP release notes):

| Version | Date |
|---|---|
| V1.0 | 2024-09-24 |
| V1.1 | 2025-02-27 |
| V1.2 | 2025-06-10 |
| V1.3 | 2025-10-14 |
| V1.4 | 2025-12-23 |
| V1.5 | 2026-04-29 |
| V1.6 | 2026-06-16 |
| V1.7 | 2026-08-06 |
| V1.7.1 | 2026-08-17 |
| V2.0 | 2026-10-14 |
| V2.0.1 | 2026-10-21 |

The notes only add devices; no removals are recorded. The M3M never appears.

### Cited Findings
- The version dates and device additions are as listed in section 1. — [FH2 OP release notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- V2.0 also adds: FH2, 4G and Terra licenses must sit on the same license node; O4 Ground Station in Gateway Mode no longer counts toward licensed devices. V2.0.1: the Plugin Framework is in beta in China only. — [FH2 OP release notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- Secondary source: DroneDJ (2026-09-09) reports that the OP update focuses on livestream scaling, simpler deployment/upgrades and expanded APIs. — [DroneDJ](https://dronedj.com/2026/09/09/dji-flighthub-2-on-premises-update/) (not fetched; from search summary only)

### Inferences
- Nothing in 2025-2026 changes the status of either user setup. M4T support has been stable since V1.1, and M3M support has never existed.

### Gaps
- The full V2.0 feature list beyond the items above was not fully reviewed.

## Official alternatives for unsupported devices (M3M)

### Takeaway
DJI Pilot 2 has a built-in "third-party cloud" / DJI Cloud API (MQTT) option. Heliguy (secondary) states that the M3M supports Cloud API. DJI's own Cloud API product-support table (v1.14.0, 2025-04-15, per search summary) names "DJI Mavic 3 Enterprise Series" but not the M3M by name. This should be verified on the device. Mapping/multispectral processing is officially done via DJI Terra / DJI SmartFarm.

### Cited Findings
- Heliguy: "DJI Mavic 3 Multispectral supports Cloud API and MSDK". It says the drone can connect directly to a third-party cloud platform via Pilot 2's built-in MQTT-based DJI Cloud API, sending aircraft info, live video and photos. (Copyright 2025, undated.) — [Heliguy KB](https://heliguy.com/blogs/knowledge-base/does-dji-mavic-3-multispectral-support-cloud-api-and-msdk/)
- DJI Cloud API "Product Supported" page, per search summary because the page is JS-rendered and could not be read. "DJI Pilot 2 access to cloud server: Matrice 4E, Matrice 4T, Matrice 350 RTK, Matrice 300 RTK, Matrice 30 Series, DJI Mavic 3 Enterprise Series" (Cloud API 1.14.0, 2025-04-15). The M3M is not named; MSDK lists "DJI Mavic 3M". — [DJI Cloud API Product Supported](https://developer.dji.com/doc/cloud-api-tutorial/en/overview/product-support.html)

### Inferences
- For setup 1, the realistic path is the Pilot 2 third-party cloud (Cloud API) into the user's own server, not FH2 OP. Whether the M3M works there must be confirmed in a live test.

### Gaps
- Official DJI confirmation of M3M Cloud API support was not found. The Cloud API page content could not be fetched directly.
