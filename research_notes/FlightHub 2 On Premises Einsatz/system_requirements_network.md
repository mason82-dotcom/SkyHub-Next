# DJI FlightHub 2 On-Premises: system requirements, installation and network/port architecture (as of 2026-10-24)

Source basis and versions. Two primary DJI documents were read in full or section by section:
- **(A) Online deployment manual, current version.** The header says "Applicable Version: FlightHub 2 On-Premises v2.0" and "Update Date: 2026-10-21". [DJI Developer – Deployment Manual cover](https://developer.dji.com/doc/priv-deployment-document/en/cover.html)
- **(B) PDF "FlightHub 2 On-Premises Version Deployment Manual v1.6"** (102 pages, on DJI's CDN; the URL path says v1.5 but the cover page says v1.6). It covers V1.5 to V1.7, and its text was extracted locally. [DJI CDN PDF](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **Release notes:** V2.0 came out 2026-10-14 and V2.0.1 on 2026-10-21. V1.7 was 2026-08-06, V1.6 2026-06-16, V1.5 2026-04-29, V1.4 2025-12-23 and V1.0 2024-09-24. [FH2 On-Premises Release Notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- **Note:** V2.0 changed the architecture (cluster/K3s). Where (A) and (B) differ, (A) is current. (B) describes the V1.x line and is now partly out of date. Anything from before 2025, such as the V1.0 release notes, is marked as possibly outdated.

## 1. Officially required server hardware (CPU architecture, cores, RAM, storage, GPU, number of servers)

### Takeaway
DJI officially supports only x86_64 (Intel/AMD) servers. There is no ARM64 support. For V2.0 the recommendation per node is 16 cores, 64 GB RAM and a 1 TB SSD data disk, for about 20 docks. V1.x recommended 8 cores, 32 GB RAM and 1 TB SSD. Model reconstruction (Terra) needs a separate NVIDIA GPU server. A single node is enough; 3 or more nodes give HA.

### Cited Findings
- **V2.0 architecture:** "Standard x86 servers" only. 16 CPU cores and 64 GB RAM are recommended ("Adjust based on the actual application workload"). The data disk should be 1,000 GB and "must use an SSD". For about 50 docks on one node, DJI recommends 32 cores and 128 GB RAM. The baseline supports about 20 docks online at the same time. — [DJI Server Configuration Requirements (v2.0)](https://developer.dji.com/doc/priv-deployment-document/en/quick-start/before-deployment/server-environment-preparation/server-configuration.html)
- **Cluster page:** only the "All-x86 Cluster" configuration is described. All FlightHub 2 and Terra services run on x86 nodes, and only x86_64 (Intel/AMD) is listed. — [About the DJI FlightHub 2 Cluster](https://developer.dji.com/doc/priv-deployment-document/en/cluster-overview.html)
- **V1.6 (older):** 8 CPU cores, 32 GB memory and a 1000 GB data disk. "SSDs are required." This setup was stress-tested for about 20 docks; for about 50 docks the manual recommends 16 cores and 64 GB. The deployment checklist says "minimum requirements: 8C, 32G, 1T". — [Deployment Manual v1.6 PDF, sections 4.2.1.1 and 6](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **amd64-only binaries (V1.6):** the license fingerprint tool ships only `codemeter-lite_8.10.6221.500_amd64.deb`, `codemeter-lite-dev_..._amd64.deb` and `libusb-1.0-0_2-1.0.24-3_amd64.deb`. The 4G service is uninstalled with `./dji-cellular-enterprise-linux-amd64 uninstall`. — [Deployment Manual v1.6 PDF, sections 4.2.3 and FAQ 9](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **Terra model reconstruction server (V1.6):** must be "a dedicated GPU server, preferably separate from the server where the FlightHub 2 On-Premises is deployed". It needs 8 cores, 32 GB RAM or more, and 200 GB free disk (SSD recommended). The GPU should be an NVIDIA card with compute capability 6.1 or higher and at least 4 GB VRAM, with CUDA 10 or newer. OS is Ubuntu Server 22.04 LTS, with Docker 24.0.7 and Compose 2.21.0. — [Deployment Manual v1.6 PDF, section 5.10](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **Optional multimodal large model (AI):** needs an NVIDIA GPU, with at least 80 GB VRAM recommended. It also needs 200 GB of disk (the model alone is about 60 GB), plus Docker 20.10+, Compose 2.0+ and nvidia-container-toolkit. — [Deployment Manual v1.6 PDF, section 5.12](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **Number of servers (V2.0):** you can start with one node and add more later. Three or more nodes give HA, load balancing and disaster recovery. A multi-node cluster needs your own L4 load balancer with a VIP that forwards to port 30888 on each node. All nodes must be in the same server room; cross-region deployment is not supported. — [Cluster Overview](https://developer.dji.com/doc/priv-deployment-document/en/cluster-overview.html); [Release Notes V2.0](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- **V1.x:** "Only single-node deployment is supported. For multi-node deployment, run this tool separately in the corresponding environments." — [Deployment Manual v1.6 PDF, section 4.3.4](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **Network bandwidth:** each dock needs about 5 Mbps for two simultaneous livestreams. LAN deployments need at least 100 Mbps per dock to the router. Public-network deployments need a static IP with at least 100 Mbps symmetric bandwidth. — [Server Configuration v2.0](https://developer.dji.com/doc/priv-deployment-document/en/quick-start/before-deployment/server-environment-preparation/server-configuration.html)
- **Bandwidth per DJI FAQ:** at least 50 Mbit/s, for both cloud and On-Premises. — [DJI FlightHub 2 FAQ](https://enterprise.dji.com/flighthub-2/faq)
- **V2.0 installation package size:** "under 50 GB". — [Release Notes V2.0](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- **DJI AIO appliance (hardware alternative):** a "high-performance GPU", RAID 1, a license dongle, 1.8 kg in the office version, and can run air-gapped. DJI publishes no CPU, RAM or storage figures for it. The article is dated 2025-10-14. — [DJI Insights: FlightHub 2 On-Premises & AIO](https://enterprise-insights.dji.com/blog/dji-flighthub-2-on-premises-aio-enhanced-data-security-for-drone-operations?hsLang=en)
- **Browser client:** Google Chrome 120 or later only. — [Deployment Manual v1.6 PDF, section 4.2.1.5](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)

### Inferences
- **No ARM path at all.** The licensing stack (WIBU CodeMeter) is shipped as amd64 .deb packages and the server fingerprint is tied to hardware. Even if the containers could somehow be emulated, licensing on ARM would very likely fail.
- **The RAM gap on a Pi 5 is large.** 8 GB is a quarter of the old V1.x minimum (32 GB) and an eighth of the V2.0 recommendation (64 GB).

### Gaps
- **Hard minimum vs. recommendation:** DJI gives no binding "hard minimum" for V2.0, only recommendations. The V1.x checklist calls 8C/32G/1T a "minimum".
- **Multi-node sizing:** no sizing guidance for multi-node clusters is published.
- **AIO hardware:** detailed specs are not public.

## 2. Supported operating systems and runtime (distribution, Docker/Kubernetes, installer, online/offline, dependencies)

### Takeaway
V2.0 supports only Ubuntu Server 22.04 LTS or 24.04 LTS on x86. It runs on a built-in K3s cluster and needs no pre-installed container components. V1.x ran only on Ubuntu Server 22.04 LTS, with Docker 24.0.7 or newer and Compose 2.21.0 or newer. The installer is a license-bound package downloaded from the DJI Developer portal; it is then installed through a web wizard or `setuptools` and can run offline/air-gapped. The stack brings its own EMQX, MinIO, RabbitMQ, MySQL, Prometheus/Grafana, Loki/VictoriaLogs, SRS/WebRTC and K3s.

### Cited Findings
- **Supported OS (V2.0):** "Ubuntu Server 22.04 LTS or 24.04 LTS", under the heading "Standard x86 Systems". — [System Requirements v2.0](https://developer.dji.com/doc/priv-deployment-document/en/quick-start/before-deployment/server-environment-preparation/system-requirements.html)
- **Container runtime (V2.0):** "No third-party container components need to be preinstalled". There is a built-in NTP service. The time difference between the browser device and the server must not exceed 30 seconds. — [Core Component Requirements v2.0](https://developer.dji.com/doc/priv-deployment-document/en/quick-start/before-deployment/server-environment-preparation/core-component-requirements.html)
- **K3s in V2.0:** the port list names the K3s API server on 30826 ("used instead of 6443"), embedded etcd on 2379/2380, Kubelet on 10250 and Flannel VXLAN on UDP 8472. — [Network Requirements v2.0](https://developer.dji.com/doc/priv-deployment-document/en/quick-start/before-deployment/server-environment-preparation/network-requirements.html)
- **V1.x runtime:** Ubuntu Server 22.04 LTS, Docker 24.0.7 or newer ("Versions compatible with API v1.43"), Docker Compose 2.21.0 or newer. A Docker install tool is included under `tool/docker`. Upgrades integrate K3s by default, and `./setuptools upgrade --skip_serverless=true` skips it on weaker servers. — [Deployment Manual v1.6 PDF, sections 4.2.1.2–4.2.1.3 and 5.19](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **V1.x components:** the port table lists EMQX (MQTT), agent-emqx, MinIO (console, service, static), RabbitMQ, Grafana, Loki, node-exporter, RTMP/WebRTC livestream (SRS, see `MULTI_SRS_ENABLE`), map server, elevation service, ts-gateway/ts-admin, bridge-api, tas-api, drtc-manager, live-stream-hub and K3s. — [Deployment Manual v1.6 PDF, section 4.2.1.4](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **Further V2.0 components:** Admin Console MySQL (30882), Prometheus (30090), EMQX/RabbitMQ consoles (30807/30809), VictoriaLogs (30823), a built-in mail server (30820–30822), the CodeMeter license service (22350) and P2P image distribution (5001). — [Network Requirements v2.0](https://developer.dji.com/doc/priv-deployment-document/en/quick-start/before-deployment/server-environment-preparation/network-requirements.html)
- **V1.x networks:** The older manual names internal Docker networks `SUB_NET_DB`, `SUB_NET_GATEWAY` and `SUB_NET_SELF_SERVICE` in the `10.0.x.x` space. The originally transcribed `/4` masks for two networks overlap and must be checked against the source PDF before any deployment planning; this note does not provide usable CIDR values. — [Deployment Manual v1.6 PDF, section 4.2.1.4](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **Subnet conflict check:** since V1.6 the deployment tool detects subnet conflicts. — [Release Notes V1.6/V1.7](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- **Installation flow (V1.6):**
  1. Obtain an activation code (trial or purchase).
  2. Generate a server fingerprint (`GenerateLicenseRequestFile.sh`).
  3. Create the license on the DJI Developer portal and download the license and package.
  4. Extract the package and run `bash run_installer.sh` as root; the wizard runs on port 40000.
  5. The wizard runs its own environment check of OS, hardware and Docker version. "If any abnormal item is detected, you cannot proceed to the next step."

  — [Deployment Manual v1.6 PDF, sections 3, 4.2.3–4.3.5](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **Activation after install:** activation uses a QR code and a mobile browser with a DJI Developer username. The dynamic code is valid for 1 minute, and server and phone times must match. — [Deployment Manual v1.6 PDF, section 4.4.3](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **Offline/air-gapped operation:** offline maps and offline firmware upgrades have been supported since V1.0 (2024, possibly outdated). — [Release Notes V1.0](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- **Air-gapped (DJI marketing):** DJI says the product can run fully air-gapped. — [DJI Insights AIO article](https://enterprise-insights.dji.com/blog/dji-flighthub-2-on-premises-aio-enhanced-data-security-for-drone-operations?hsLang=en)
- **Outbound connections in V2.0 (optional, depending on configuration):** DNS (53), 443 to the image registry/object storage/UOM ("remote ID reporting"), SMTP (25/465/587), external storage over iSCSI/NFS/SMB (3260/2049/445), and CodeMeter network licensing (22350). — [Network Requirements v2.0](https://developer.dji.com/doc/priv-deployment-document/en/quick-start/before-deployment/server-environment-preparation/network-requirements.html)

### Inferences
- **Raspberry Pi OS / Debian is not supported.** The installer's environment check (OS and hardware) would very likely abort on Raspberry Pi OS, on aarch64, or with 8 GB RAM.
- **V2.0 takes over the host.** Because of K3s, Flannel, etcd and many NodePorts, it is not designed to share a host with an existing Docker/Caddy/Mosquitto stack. The documentation implicitly assumes a dedicated server.

### Gaps
- **Exact middleware versions** for V2.0 (EMQX, MinIO, MySQL) are not published.
- **Install duration for V2.0:** not published. For V1.7, DroneDJ reports about 20 minutes on average for incremental upgrades ([DroneDJ, 2026-09-09](https://dronedj.com/2026/09/09/dji-flighthub-2-on-premises-update)).

## 3. Network architecture: ports, protocols, domain/TLS, how Pilot 2 and docks connect

### Takeaway
FlightHub On-Premises opens dozens of ports. The central ones are:
- 80/443 for the web UI
- 1883/8883 for MQTT/MQTTS (EMQX), used by devices
- 30812 for the backend API (marked legacy in V2.0)
- 30802/30804 for MinIO/S3 media
- 8443 and 60002–60006 for DRTC device media
- RTMP 1935 (V1.x) or 31200–31299 (V2.0)
- WebRTC 8000–8002 (V1.x) or 31000–31199 (V2.0)
- UDP 10000–10100 for RTP
- 30888 for the admin console
- 30808 for the control WebSocket

Devices (via Pilot 2 / dock) are configured with `${SERVICE_DOMAIN}:${BACKEND_TCP_PORT}`. HTTP and HTTPS are both possible: either a self-signed root CA (which must be trusted) or your own certificate. Dock 4 requires HTTPS for livestreaming.

### Cited Findings
- **Full V2.0 port list.** "Open only the ports that match your deployment scenario and enabled features." — [Network Requirements v2.0](https://developer.dji.com/doc/priv-deployment-document/en/quick-start/before-deployment/server-environment-preparation/network-requirements.html)

  **Web and admin**

  | Port | Protocol | Purpose |
  |---|---|---|
  | 80, 443 | TCP | FlightHub 2 frontend/HTTPS (browsers and devices) |
  | 30888 | TCP | Admin console / installation wizard |
  | 30800 | TCP | O&M frontend |
  | 30811 | TCP | Grafana |
  | 30807 / 30809 | TCP | EMQX / RabbitMQ consoles |
  | 30823 | TCP | VictoriaLogs |

  **Devices**

  | Port | Protocol | Purpose |
  |---|---|---|
  | 1883 / 8883 | TCP | EMQX MQTT / MQTT-TLS |
  | 30812 | TCP | Backend API for docks/devices (legacy) |
  | 8443 | TCP | DRTC device entry point, HTTPS/mTLS |
  | 60002–60004, 60084 | TCP+UDP / UDP | DRTC media |
  | 60006 | TCP | DRTC media |
  | 38081 | TCP | TAS API |
  | 8090–8094, 8096, 8099 | TCP | 4G relay; aircraft connect via public IP |

  **Storage and maps**

  | Port | Protocol | Purpose |
  |---|---|---|
  | 30801 / 30802 / 30804 | TCP | MinIO console / object API / static |
  | 30813 / 30814 | TCP | Maps / map tiles |
  | 30829 | TCP | Elevation data |

  **Live video**

  | Port | Protocol | Purpose |
  |---|---|---|
  | 31000–31099 | TCP | WebRTC WHIP/WHEP signaling |
  | 31100–31199 | TCP+UDP | WebRTC media |
  | 31200–31299 | TCP | RTMP |
  | 31300–31399 | TCP+UDP | GB28181 SIP |
  | 31400–32499 | UDP | GB28181 media |
  | 30854 | TCP | live-stream-hub RTSP |
  | 10000–10100 | UDP | RTP |
  | 19090 | TCP | Livestream monitoring |

  **Browser control**

  | Port | Protocol | Purpose |
  |---|---|---|
  | 30808 | TCP | Aircraft-control WebSocket |

  **Cluster and internal**

  | Port | Protocol | Purpose |
  |---|---|---|
  | 22 | TCP | SSH |
  | 2379/2380 | TCP | etcd |
  | 10250 | TCP | Kubelet |
  | 8472 | UDP | Flannel |
  | 30826/30827 | TCP | K3s |
  | 5001 | TCP | P2P images |
  | 9100 / 30815 | TCP | Node exporter |
  | 22350 | TCP | CodeMeter |
  | 30882 | TCP | MySQL |
  | 30090 | TCP | Prometheus |
  | 30816 | TCP | RabbitMQ |
  | 30824/30825 | TCP | Task scheduling |
  | 123 | UDP | NTP |

  **Terra/GPU**

  | Port | Protocol | Purpose |
  |---|---|---|
  | 2378 | TCP | GPU Docker |
  | 30805 | TCP | Terra Rescon |
  | 30817–30819 | TCP | GPU metrics |

- **V1.6 port list (older, for comparison):**
  - Web and admin: 4000 (deployment tool), 80/443 (UI), 8080 (gateway dashboard), 30800 (O&M), 30801 (MinIO console), 30811 (Grafana), 30828 (Loki), 30816 (RabbitMQ), 30888 (AIO backend, default FH_SYSTEM_PORT).
  - Devices: 123 (NTP), 1883/8883 (EMQX), 20000/20001 (agent-emqx and its encrypted variant), 30802/30804 (MinIO), 30806 (livestream), 30808 (agent-emqx WS), 30812 (backend), 30813/30814 (maps), 38081 (tas-api).
  - Live video: 1935 (RTMP, "modification not recommended"), 8000 (WebRTC, "modification not recommended"), and in multi-core mode additionally 8001/8002, 30831/30832, 30823 and 30833. UDP 10000–10100 (livestream).
  - Terra: 30826/30827 for Terra/K3s.

  — [Deployment Manual v1.6 PDF, section 4.2.1.4 and 5.20](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **Device binding:** connect the RC to the dock by USB, then in DJI Pilot 2 go to Cloud Service Configuration and choose "FlightHub 2 On-Premises". The access address is `${SERVICE_DOMAIN}:${BACKEND_TCP_PORT}` ("domain name or IP and backend port", with no http/https prefix), plus Organization ID, Device Binding Code and Dock Name. — [Binding Dock to Organization v2.0](https://developer.dji.com/doc/priv-deployment-document/en/quick-start/business-initialization/binding-dock-to-organization.html)
- **Web UI address:** `http://${SERVICE_DOMAIN}:${FRONTEND_TCP_PORT}`. The admin console is at `{IP}:30888` (default FH_SYSTEM_PORT; default INTERNAL_IP is 192.168.1.101). — [Deployment Manual v1.6 PDF, sections 4.4.2, 4.4.4](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf); [Release Notes V1.4](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- **TLS options:** HTTPS is switched in the admin console under "Security Configuration". You can use a system self-signed certificate (download the root CA and trust it on each client) or a custom certificate (paste CRT and KEY). With a custom certificate, trust for the livestream certificate must be configured separately. Changing protocol or certificate briefly interrupts access. Audio recording (speaker function) does not work over HTTP. — [Switching Between HTTP and HTTPS v2.0](https://developer.dji.com/doc/priv-deployment-document/en/capability-expansion/switching-http-and-https.html)
- **Dock 4 needs HTTPS.** "HTTPS must be enabled for DJI Dock 4 livestreaming." — [Switching HTTP/HTTPS v2.0](https://developer.dji.com/doc/priv-deployment-document/en/capability-expansion/switching-http-and-https.html)
- **Release notes on Dock 4:** "DJI Dock 4 supports only HTTPS", so the HTTPS option must be enabled. — [Release Notes V2.0](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- **CLI certificate import (V1.6):** `./setuptools https certificate install --cert … --key …`. A CER-to-PEM conversion is documented. In V1.5 the admin console added "one-click HTTPS certificate retrieval". — [Deployment Manual v1.6 PDF, section 7 and FAQ 5](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf); [Release Notes V1.5](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- **Login button missing:** if the web login button is missing, the self-signed certificate is not trusted. — [Deployment Manual v1.6 PDF, FAQ 4.2](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **Domain vs. IP:** V1.0 is accessed by IP only, "no DNS required", with DNS optional later. — [Release Notes V1.0 (2024, possibly outdated)](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- **External address in V2.0:** the external IP is "the unified Cluster endpoint for web, API, and device access". On a single node it is the LAN IP. Multi-node uses a VIP. Behind NAT or in a cloud you use the public IP and must "ensure that the required ports are reachable". After a change, "devices must reconnect to the cloud". — [Changing the Domain Name / IP Address v2.0](https://developer.dji.com/doc/priv-deployment-document/en/capability-expansion/switching-domain-and-ip.html)
- **Adaptive network (since V1.4):** when docks, aircraft and server sit on different subnets or NICs, the service layer forwards traffic (`MULTIPLE_IP_ENABLE`). Natively this supports only Dock 3 and manually flown aircraft; other models are added through an SN:IP list. — [Deployment Manual v1.6 PDF, section 5.6](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf); [Release Notes V1.4](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)

### Inferences
- **Direct conflicts with the existing Pi stack** (in addition to K3s/Flannel and the 10.0.x.x Docker subnets in V1.x):
  - 80/443 clash with Caddy.
  - 1883/8883 clash with Mosquitto.
  - 8080/8000 may clash with other services.
- **The proxy limit is fundamental.** Devices talk to the server over MQTT/TLS, mTLS on 8443, RTMP, WebRTC/UDP and RTP. These are not HTTP and cannot simply be routed through Caddy. At most an L4/TCP+UDP passthrough would be possible.

### Gaps
- **Certificate trust on RC/dock:** DJI does not document how DJI Pilot 2 or docks trust a self-signed root CA. It is open whether a publicly trusted certificate on a domain is effectively required for Dock 4. The pages read here do not cover this.
- **Whether Pilot 2 uses HTTP or HTTPS** for the access address is not stated.
- **Agora:** no mention found; the On-Premises stack uses its own WebRTC/RTMP/DRTC servers.

## 4. Non-default port / reverse proxy (Caddy/Nginx)?

### Takeaway
Ports can officially be changed in the admin console under "FlightHub Management → Service Configuration → Service Ports". The manual itself warns against changing the streaming ports ("modification not recommended"). A reverse proxy in front of FlightHub is **not documented anywhere**. The only external front end DJI describes is an L4 load balancer to port 30888 for multi-node clusters.

### Cited Findings
- **Changing ports:** "Go to the AIO Management Backend. Path: 「FlightHub Management」→「Service Configuration」→「Service Ports」." Which ports can be changed is shown only in a screenshot. — [Changing Default Ports v2.0](https://developer.dji.com/doc/priv-deployment-document/en/capability-expansion/changing-default-ports-for-Flighthub-2-on-premises.html)
- **Ports not to change:** RTMP 1935/30831/30832 and WebRTC 8000/8001/8002 are marked "(modification not recommended)". — [Deployment Manual v1.6 PDF, section 4.2.1.4](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **Port change via env (V1.6):** the CLI path to change domain/IP or HTTP/HTTPS is `vi env` followed by `./setuptools update`. The variables include `SERVICE_DOMAIN`, `FRONTEND_TCP_PORT`, `BACKEND_TCP_PORT`, `FH_SYSTEM_PORT`, `MAP_CUSTOM_TCP_PORT` and `MAP_SERVER_TCP_PORT`. — [Deployment Manual v1.6 PDF, sections 4.4, 5.1, 7](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **Load balancer for clusters:** multi-node clusters need your own load balancer, with L4 recommended, a single virtual IP and forwarding to 30888 on each node. — [Cluster Overview v2.0](https://developer.dji.com/doc/priv-deployment-document/en/cluster-overview.html)
- **No reverse-proxy page:** the table of contents of the V2.0 manual has no page on reverse proxies. — [Deployment Manual cover v2.0](https://developer.dji.com/doc/priv-deployment-document/en/cover.html)
- **No third-party reports:** a targeted web search found no reports of FlightHub 2 On-Premises behind Nginx or Caddy. — (search on 2026-10-24, no relevant hits)

### Inferences
- **Only the web UI could be proxied.** In theory, Caddy could forward HTTP/WebSocket traffic (80/443, 30808 WS, perhaps MinIO 30804) to the FlightHub host. The server, however, generates absolute URLs with `SERVICE_DOMAIN:PORT` for media/S3, maps and streams.
- **Devices bypass any proxy.** MQTT, 8443 mTLS, RTMP and WebRTC/UDP would still have to reach the FlightHub host directly (or through L4 forwarding).
- **Result:** a different port is supported; a transparent reverse proxy is unsupported and fragile.

### Gaps
- **Which ports are changeable:** the exact list in the port dialog (screenshot only) is unknown.
- **Path-prefix / proxy hosting:** there is no official statement on running under a path prefix or behind a TLS-terminating proxy.

## 5. Installation and operation procedure (who, how long, upgrades, backup, monitoring, pitfalls)

### Takeaway
The customer or an authorized dealer installs it. Licensing runs through the DJI Developer portal and is tied to the server fingerprint, and server migration needs approval from DJI Support. Upgrades are incremental only between adjacent versions. V1.x cannot be upgraded to V2.0 with the existing tools. Backup is stop, copy `DATA_ROOT_PATH`, restart. Monitoring uses the built-in Prometheus, Grafana, Loki/VictoriaLogs and an O&M platform.

### Cited Findings
- **Licensing:** an activation code (trial or purchased through a dealer) plus a server fingerprint file produces the license on the DJI Developer portal. For a trial license, no fingerprint is needed. — [Deployment Manual v1.6 PDF, sections 3, 4.2.3, 5.14](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **Activation code binding:** "Once the formal activation code is binded, it cannot be refunded." — [DJI Developer License Tool](https://developer.dji.com/resources/private/tool)
- **Server migration:** you file a request with DJI Support, the old license is voided, and you receive a new activation code and a new fingerprint. — [Deployment Manual v1.6 PDF, section 5.18](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **ERROR 233:** this is a fingerprint mismatch after the environment changed. A new license is then needed. — [Deployment Manual v1.6 PDF, FAQ 13](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **Upgrade rules:**
  - V1.7 delivers incremental packages only between adjacent versions; jumping several versions needs a full upgrade.
  - "Earlier versions can't be upgraded to V2.0 with visual tools, legacy command-line tools, or similar methods."
  - V2.0 changes backup, maintenance commands, log export and the port list.
  - Packages for V1.5 and older have been removed.
  - Upgrades require a valid upgrade-service period on the license.

  — [Release Notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html); [Deployment Manual v1.6 PDF, section 5.19](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **Upgrade duration:** about 20 minutes on average for an incremental upgrade (secondary source). — [DroneDJ 2026-09-09](https://dronedj.com/2026/09/09/dji-flighthub-2-on-premises-update)
- **Backup (V1.6):** `./setuptools stop`, back up `${DATA_ROOT_PATH}`, then `./setuptools restart`. Best practice is RAID 0/10 plus rsync to a NAS. — [Deployment Manual v1.6 PDF, sections 5.16, FAQ 10](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **Monitoring:** Prometheus with custom metrics/alerts (section 5.13), Grafana (30811), Loki logs, an O&M platform (30800), container logs via `docker logs es-management`, and SMTP alerts. — [Deployment Manual v1.6 PDF, sections 5.7, 5.13, FAQ 2](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **Known pitfalls (V1.6):**
  - The installer must run as root.
  - Port 40000 must be open for the wizard.
  - A client/server time difference above 15 minutes causes upload errors (30 seconds in V2.0).
  - The QR activation fails if server and phone times differ.
  - Only one organization can be created.
  - The included map covers only Shenzhen; you must import your own maps and DEM data.
  - Error 212400 (FlyTo) is fixed by resetting the API key in the tas-service container.
  - Terra/4G must match the FlightHub version and be installed after FlightHub.

  — [Deployment Manual v1.6 PDF, sections 4.3–4.4, FAQ 8, 14, 15](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **V1.7.1:** the LAN IP restriction on the MQTT Bridge was removed. — [Release Notes V1.7.1](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)

### Inferences
- **Hardware binding makes test runs risky.** A trial on unsupported hardware would at best use up a trial code, and a purchased activation code cannot be refunded once bound.

### Gaps
- **Total installation time** is not documented officially.
- **Installation services:** whether DJI dealers offer mandatory installation services is not uniformly documented.

## 6. Bottom line: Raspberry Pi 5 (ARM64, 8 GB, Raspberry Pi OS)?

### Takeaway
No. FlightHub 2 On-Premises cannot realistically run on a Raspberry Pi 5. The architecture (x86_64 only), OS (Ubuntu Server 22.04/24.04 only), RAM (8 GB against 32–64 GB) and licensing (amd64 CodeMeter, fingerprint binding) all exclude it, and the stack collides with the existing services on many ports. The realistic minimum host is a dedicated x86_64 server running Ubuntu Server 22.04/24.04 LTS:
- **V2.0 recommendation:** 16 cores, 64 GB RAM, 1 TB SSD.
- **Earlier V1.x minimum:** 8 cores, 32 GB RAM, 1 TB SSD (a cloud VM with 8C/32G was permitted for tests).
- **Mapping/Terra:** an additional NVIDIA GPU server.

### Cited Findings
- **Architecture:** x86-only — [Server Configuration v2.0](https://developer.dji.com/doc/priv-deployment-document/en/quick-start/before-deployment/server-environment-preparation/server-configuration.html); [Cluster Overview](https://developer.dji.com/doc/priv-deployment-document/en/cluster-overview.html)
- **OS:** Ubuntu Server 22.04/24.04 only — [System Requirements v2.0](https://developer.dji.com/doc/priv-deployment-document/en/quick-start/before-deployment/server-environment-preparation/system-requirements.html)
- **Test VM:** "Public cloud environments like Hypervisor 8C32G can also be used for deployment and tests." (V1.6) — [Deployment Manual v1.6 PDF, section 4.2.1.1](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)
- **Installer check blocks:** the installer aborts on failed OS, hardware or Docker checks — [Deployment Manual v1.6 PDF, section 4.3.5](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/private-fh2/v1.5/FlightHub%202%20On-Premises%20Version%20Deployment%20Manual.pdf)

### Inferences
- **x86 emulation (qemu-user/box64) on the Pi** is no way out. It would not fix the RAM shortfall and would stall the many livestream and media services. This is unsupported and was not tested.
- **Recommended architecture for the user:**
  - Put FlightHub 2 On-Premises on its own x86 host, or an 8C/32G+ VM on a hypervisor for tests.
  - Ideally give it a dedicated IP so that 80/443/1883/8883 do not collide with Caddy/Mosquitto on the Pi.
  - The Pi stays an independent system (own DJI Cloud API stack / SkyHub) or at most acts as a client or integration via the FlightHub OpenAPI or MQTT Bridge.
- **Smallest supported entry point for one to a few devices:** probably an x86 mini server or workstation with at least 8 cores, 32 GB RAM, 1 TB NVMe SSD and Ubuntu Server 24.04. For V2.0, 16C/64G per DJI. Whether V2.0 still installs on 8C/32G (environment check) is not documented.

### Gaps
- **Whether V2.0's installer enforces hard thresholds** (e.g., refusing to install below 16C/64G) is not published.
- **Pricing and license tiers** were not researched here.
