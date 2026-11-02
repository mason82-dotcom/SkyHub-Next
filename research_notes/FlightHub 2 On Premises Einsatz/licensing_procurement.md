# DJI FlightHub 2 On-Premises: Product, Procurement, Licensing and Deployment Model (as of Oct 2026)

Source legend: [OFFICIAL] = DJI-owned domain (enterprise.dji.com, enterprise-insights.dji.com, developer.dji.com, store.dji.com); [DEALER] = authorized dealer/retailer marketing; [PRESS] = third-party industry coverage (secondary). Research date 2026-10-24. Note: the DJI developer forum thread and the fh.dji.com release-notes/deployment-manual pages could not be read (login wall / not reached), so the server sizing and activation mechanics below are incomplete.

## 1. What FlightHub 2 On-Premises is, and the current version line

### Takeaway
FlightHub 2 On-Premises is the self-hosted edition of DJI's cloud fleet-management platform FlightHub 2. It shipped in June 2025 and offers "nearly all" cloud features and a near-identical UI. DJI sells it in two forms: software-only (your own server or cloud) and the FlightHub 2 AIO hardware appliance, which comes with the software pre-installed. "Private deployment" is effectively the same product: the term is used for the China-market/developer-portal flavour. V1.7 was announced on 18 Aug 2026; the later V2.0.1 release of 21 Oct 2026 is covered in the accompanying system requirements and overview notes.

### Cited Findings
- **Launch (June 2025)**: DJI announced On-Premises as "officially released" in a blog post dated 13 June 2025. It can be deployed in private clouds, third-party clouds or on local servers, and DJI describes it as giving "end-to-end data sovereignty" [OFFICIAL] — [DJI Enterprise Insights, On-Premises Officially Released](https://enterprise-insights.dji.com/blog/dji-flighthub-2-on-premises-officially-released). *(Older than 2025-H2; the baseline facts still hold, but the device lists may be outdated.)*
- **Same features and UI as the cloud**: DJI says it keeps nearly all core cloud features with a nearly identical UI. Under recommended conditions one IT engineer can finish setup in a day. It runs fully offline in closed networks and supports OAuth 2.0 account integration, local 2D real-time mapping and 4G Enhanced Transmission. Updates come less often than for the cloud, and offline maps and weather data "may update later" [OFFICIAL] — [same source](https://enterprise-insights.dji.com/blog/dji-flighthub-2-on-premises-officially-released).
- **Two delivery forms (Oct 2025)**: software-only On-Premises can run on physical servers, a private or hybrid cloud, or a public cloud. The **FlightHub 2 AIO** is a hardware appliance with On-Premises and both optional modules pre-installed: Localized Cloud Modeling (DJI Terra engine, GPU) and Localized 4G Enhanced Transmission (private APN). It weighs 1.8 kg and has RAID 1 and one-click recovery. It is licensed via a **pluggable licence dongle**. Both forms support air-gapped operation [OFFICIAL] — [DJI Enterprise Insights, On-Premises & AIO, 14 Oct 2025](https://enterprise-insights.dji.com/blog/dji-flighthub-2-on-premises-aio-enhanced-data-security-for-drone-operations).
- The official DJI FAQ (German version) confirms that On-Premises is offered as both a pure software deployment and an AIO. The recommended bandwidth of at least 50 Mbit/s applies to the cloud and On-Premises alike [OFFICIAL] — [DJI FlightHub 2 FAQ](https://enterprise.dji.com/flighthub-2/faq).
- **V1.7 (announced 18 Aug 2026)** [OFFICIAL] — [DJI Enterprise Insights, V1.7](https://enterprise-insights.dji.com/blog/dji-flighthub-2-on-premises-v1-7-update-august-2026):
  - Multi-core livestream service, with up to 3x concurrent streams "given sufficient CPU resources".
  - Fixes for stream, relay, black-screen and latency problems.
  - Incremental upgrades work only between adjacent versions (1.6.n to 1.7.n). Upgrades across several versions need a full upgrade.
  - Network-segment conflict detection at install time, a faster admin backend and an improved visual upgrade tool.
  - Standardised version display (e.g. "V1.7.0").
  - OpenAPI grows from **67 endpoints (V1.0) to 300+**, with separate public-cloud and on-prem API docs.
  - Stated focus areas include "domestic compliance".
- DroneDJ adds the following about V1.7 [PRESS] — [DroneDJ, 9 Sep 2026](https://dronedj.com/2026/09/09/dji-flighthub-2-on-premises-update):
  - Incremental upgrades take about 20 minutes on average.
  - Deployment docs are now searchable online with PDF export.
  - **Installation packages for V1.5 and older were removed**; they are available only via DJI support or authorized partners.
  - O4 Ground Station support (relay range extension, ONVIF / GB/T 28181 camera feeds, RID/ADS-B traffic display).
- **Cloud-only features** (not in On-Premises, per DroneDJ): live weather, SMS notifications, DJI Care Enterprise integration and some AI cloud services [PRESS] — [DroneDJ](https://dronedj.com/2026/09/09/dji-flighthub-2-on-premises-update). DJI's own V1.7 post refers to a "current capability boundary" only in an image, not in text [OFFICIAL] — [DJI V1.7](https://enterprise-insights.dji.com/blog/dji-flighthub-2-on-premises-v1-7-update-august-2026).
- **Target users** named by DroneDJ: government, public safety, utilities, transport authorities and energy companies [PRESS] — [DroneDJ](https://dronedj.com/2026/09/09/dji-flighthub-2-on-premises-update).

### Inferences
- Version history runs V1.0 (Jun 2025) through V1.7 (Aug 2026), roughly one minor release every two months. Because only adjacent incremental upgrades are possible and old packages are being withdrawn, a self-hoster who skips releases faces full reinstalls. They also depend on DJI or a partner for older packages.
- "Domestic compliance" as a focus area and GB/T 28181 support suggest that China is the product's primary market.

### Gaps
- The full V1.0–V1.6 release notes on fh.dji.com / developer.dji.com were not read, so per-version change lists before V1.7 are missing.
- The official "capability boundary" table (cloud vs on-prem) is published only as an image and was not obtained.

## 2. Procurement: dealers, trial, self-service download, who installs

### Takeaway
The official purchase path is an **authorized DJI Enterprise dealer**, or a contact form to DJI Enterprise. DJI does not sell it as a self-service web-store item. There is an **official free trial**, applied for through DJI's developer portal or a form, and reviewed by DJI within 3 business days. Installation packages and licences are handled through a "License Tool" on developer.dji.com. In the software-only model the **customer installs it**: DJI says one IT engineer can do it in a day. Dealers offer deployment help as a service.

### Cited Findings
- DJI says to buy On-Premises through a DJI Enterprise Authorized Dealer (it links to a dealer finder) [OFFICIAL] — [DJI On-Premises release post](https://enterprise-insights.dji.com/blog/dji-flighthub-2-on-premises-officially-released). The V1.7 post says to contact "an authorized DJI Enterprise dealer or DJI Enterprise directly" [OFFICIAL] — [DJI V1.7](https://enterprise-insights.dji.com/blog/dji-flighthub-2-on-premises-v1-7-update-august-2026).
- The official product page enterprise.dji.com/fh2-on-premises has a contact form for "Kostenlos testen" (free trial) of On-Premises or AIO, or for purchase info. The form asks for continent and country. No plans, prices or eligibility rules are listed [OFFICIAL] — [DJI On-Premises product page](https://enterprise.dji.com/fh2-on-premises).
- **Trial application on the developer portal** ("FlightHub 2 On-Premises Service") [OFFICIAL] — [developer.dji.com Trial Application](https://developer.dji.com/resources/private/free):
  - Form fields: Company Profile, Solution Overview, Region (Chinese Mainland / Non-Chinese Mainland).
  - Picking "Others" disables use within Chinese Mainland.
  - DJI reviews the application within 3 business days and replies by email.
  - DJI advises running the full deployment in the real environment with the trial code before buying.
- The developer portal **License Tool** offers three actions: "create a license", "upgrade a license" and "download the installation package". It also links a Deployment Manual, Operation Documentation, Release Notes, Custom Development (OpenAPI) and Firmware Update [OFFICIAL] — [developer.dji.com License Tool](https://developer.dji.com/resources/private/tool).
- The Oct 2025 DJI blog mentions "different plans" and a free trial applied for at enterprise.dji.com/fh2-on-premises [OFFICIAL] — [DJI On-Premises & AIO](https://enterprise-insights.dji.com/blog/dji-flighthub-2-on-premises-aio-enhanced-data-security-for-drone-operations).
- The cloud version can be trialled instantly by signing up. On-Premises needs local installation [OFFICIAL] — [DJI release post](https://enterprise-insights.dji.com/blog/dji-flighthub-2-on-premises-officially-released).
- **Dealer role (UK, heliguy)** [DEALER] — [heliguy setup guide](https://www.heliguy.com/blogs/knowledge-base/how-to-get-set-up-dji-flighthub-2-on-prem-with-heliguy/):
  - Seven steps: consultation, server choice (customer's own server or heliguy's server), purchase and activation, account setup with the activation key, implementation and pre-production testing, live operations, ongoing support.
  - The activation key arrives by email within 48 h of purchase.
  - heliguy advertises "certified DJI FlightHub 2 On-premises engineers" [DEALER] — [heliguy product page](https://www.heliguy.com/products/dji-flighthub-2-on-premises/).
- **Dealer role (Benelux, Drone Parts Center)**: DPC's technical team supports deployment, and DPC recommends a network assessment before ordering [DEALER] — [Drone Parts Center](https://drone-parts-center.com/en/product/dji-flighthub-2-on-premises-basic-1-device/).
- **Unverified secondary claim**: a search snippet of a DJI SDK-forum thread (an Austrian company asking how to buy) contained a user remark that the trial "works but is a number of versions behind" and support is limited. The thread itself is behind a login and could not be verified — [DJI SDK forum thread (restricted)](https://sdk-forum.dji.net/hc/zh-cn/community/posts/42905517233945-How-to-Get-Started-with-FlightHub-2-On-Premises-Service).
- An older retailer note says private deployment is "currently available for trial/sale only in the Chinese mainland. Stay tuned for overseas availability" [DEALER, likely outdated] — [Advexure](https://advexure.com/collections/all/products/dji-flighthub-2). This contradicts the "Overseas" SKUs EU dealers now list (section 4).

### Inferences
- There is no community or developer edition and no anonymous download. The installer is reached through the License Tool, which presumably needs a DJI developer account plus an approved trial or a purchased code. A home user would therefore need to submit a company profile and solution overview and pass DJI's review.
- DJI's statement that one IT engineer can install it in a day indicates a customer-installable product. Dealers sell integration services but are not required for the install itself.

### Gaps
- Trial duration, device count and feature limits of the trial code: none found.
- Whether a private person or sole trader (no company) can get a trial approved: not stated anywhere.
- Whether a DJI developer account is mandatory for the License Tool: the pages show only Login/Register links, so this could not be confirmed.

## 3. Licensing: types, coverage, renewal, offline activation, prices

### Takeaway
On-Premises uses **per-device licensing**: a Basic Package (1 device plus 1 year of upgrades), Device Expansion Packages (+1 or +5 devices) and Upgrade Validity Extension Packages (+1 year of upgrades per device). Whether the server may keep operating after the included upgrade year ends is not confirmed by the public package description. DJI publishes no prices. EU dealer listings show roughly **€9,800 incl. VAT for the Basic 1-device package**, and **about €3,900 net (about €4,800 gross) per +1 device**. Activation codes are **non-refundable once bound**. The AIO uses a hardware dongle.

### Cited Findings
- **Package structure** [OFFICIAL] — [DJI release post, Jun 2025](https://enterprise-insights.dji.com/blog/dji-flighthub-2-on-premises-officially-released):
  - Basic Package: 1 device, includes 1 year of upgrades.
  - Device Expansion Package: +1 or +5 devices.
  - Upgrade Validity Period Extension Package: +1 year of upgrades for 1 device, bought separately.
- Once the formal activation code is "binded, it cannot be refunded". DJI advises trialling first [OFFICIAL] — [developer.dji.com License Tool](https://developer.dji.com/resources/private/tool); [Trial Application](https://developer.dji.com/resources/private/free).
- The License Tool offers create, upgrade and download-installer functions, which indicates licence files are generated and upgraded through DJI's portal [OFFICIAL] — [developer.dji.com License Tool](https://developer.dji.com/resources/private/tool).
- The AIO uses a pluggable licence dongle [OFFICIAL] — [DJI On-Premises & AIO](https://enterprise-insights.dji.com/blog/dji-flighthub-2-on-premises-aio-enhanced-data-security-for-drone-operations).
- **Indicative prices (dealer, not official):**
  - Drone Parts Center (Benelux): "On-Premises Basic Package (1 Device) Overseas", DJI code CP.RJ.00000212.01, EAN 6937224124844. Listed at **€9,800.33** in one place and **€9,882** in the spec table, both "incl. VAT" (inconsistent on the page). The listing says the basic package includes an "AIO hardware unit", with up to 200 devices total and 20 per AIO unit [DEALER] — [Drone Parts Center](https://drone-parts-center.com/en/product/dji-flighthub-2-on-premises-basic-1-device/). *DJI describes software-only and AIO as separate deployment forms. This dealer listing explicitly claims AIO hardware is included; obtain written confirmation of the exact SKU and contents before purchase.*
  - Megadron (Poland): "On-Premises Device Expansion Package", DJI code CP.RJ.00000213.01, EAN 6937224124837. **€3,888.15 net / €4,782.40 gross**, shown as sold out / "goods on request". A search snippet earlier showed €4,837.20 gross, so the price fluctuates [DEALER] — [Megadron 1-device expansion](https://megadron.pl/en/products/dji-flighthub-2-on-premises-device-expansion-package-electronic-code-32337.html).
  - Megadron, 5-device expansion: **€14,897.40 gross** (search-snippet figure, page not opened) [DEALER] — [Megadron 5-device expansion](https://megadron.pl/en/products/dji-flighthub-2-on-premises-5-device-expansion-package-electronic-code-32340.html).
  - heliguy (UK): "Price on Request". Pricing depends on licence tier, features, deployment model and the number of users/devices [DEALER] — [heliguy](https://www.heliguy.com/products/dji-flighthub-2-on-premises/).
- **Cloud comparison (official DJI Store, Austria)** [OFFICIAL] — [DJI Store AT](https://store.dji.com/at/product/dji-flighthub-2-enterprise-version-3-years-1-device):
  - FlightHub 2 Enterprise cloud, 3 years, 1 device: **€9,884**.
  - Activation code by email; refundable only if not activated within 30 days.
  - Once activated it is non-refundable and non-transferable to another organization.
- **Optional paid modules**: Localized Cloud Modeling, sold separately, needs an NVIDIA GPU with compute capability ≥ 6.1 [DEALER] — [heliguy](https://www.heliguy.com/products/dji-flighthub-2-on-premises/). The 4G Enhanced Transmission module is described by DJI [OFFICIAL] — [DJI On-Premises & AIO](https://enterprise-insights.dji.com/blog/dji-flighthub-2-on-premises-aio-enhanced-data-security-for-drone-operations).

### Inferences
- The package name refers to upgrade validity, but the public sources do not establish continued server operation or update entitlements after that year. Confirm both in the contract.
- Indicative dealer listing for one device: about €9,800 gross. The listing does not reliably establish whether this price includes hardware or is software-only. Each extra device is listed separately at about €3,900 net. A direct cost comparison with the cloud licence requires a written quote and matching scope.
- Air-gapped operation is officially supported. The License Tool flow (generate licence, then download) suggests offline licence-file activation, but this is unconfirmed.

### Gaps
- No official DJI price list. No official statement on perpetual vs term use after the upgrade window ends.
- Exact offline/air-gapped activation procedure and contract terms require confirmation; the accompanying system requirements note reviews an older deployment manual but does not establish the current licence terms.
- Price of the Upgrade Validity Extension Package: none found.
- Whether a "device" means aircraft, dock or remote controller in licence counting: not stated.

## 4. Customer-side requirements and regional availability (Germany/EU)

### Takeaway
Officially DJI requires a **company profile and solution description** for the trial, and you buy through an authorized dealer. There is no published minimum order beyond the Basic Package. "Overseas" SKUs are sold by EU dealers (Benelux, Poland), so the EU is served in practice. No German dealer page with an On-Premises offer was found. **Important for this user: Mavic 3 Multispectral (3M) is explicitly excluded** from FlightHub 2 device support in DJI's cloud store listings and in a dealer's On-Premises listing.

### Cited Findings
- Trial form requires Company Profile, Solution Overview and Region [OFFICIAL] — [developer.dji.com](https://developer.dji.com/resources/private/free). The official product contact form asks for continent and country/region [OFFICIAL] — [enterprise.dji.com/fh2-on-premises](https://enterprise.dji.com/fh2-on-premises).
- The region choice is binding: "Others" (Non-Chinese Mainland) disables use within Chinese Mainland [OFFICIAL] — [developer.dji.com](https://developer.dji.com/resources/private/free).
- EU availability: DPC (Benelux, "authorized DJI Enterprise dealer") lists the "Overseas" Basic Package as in stock, explicitly for markets including Europe [DEALER] — [Drone Parts Center](https://drone-parts-center.com/en/product/dji-flighthub-2-on-premises-basic-1-device/). Megadron (PL) lists expansion packs [DEALER] — [Megadron](https://megadron.pl/en/products/dji-flighthub-2-on-premises-device-expansion-package-electronic-code-32337.html).
- German coverage: drohnen.de (likely July 2026) compares Cloud vs On-Premises vs AIO. It names no German dealer, licence or price. On-Premises needs your own IT infrastructure [PRESS] — [drohnen.de](https://www.drohnen.de/86964/dji-flighthub-2-video-cloud-on-premises-oder-aio/).
- **Supported devices**:
  - Launch list (Jun 2025): Docks 1/2/3; Mavic 3 Enterprise, M30, M300/M350 RTK, Matrice 4; H30, H20, H20N, S1/V1 [OFFICIAL] — [DJI release post](https://enterprise-insights.dji.com/blog/dji-flighthub-2-on-premises-officially-released).
  - DPC On-Prem listing: "Mavic 3 Enterprise series, excluding the Mavic 3 Multispectral" [DEALER] — [Drone Parts Center](https://drone-parts-center.com/en/product/dji-flighthub-2-on-premises-basic-1-device/).
  - DJI Store cloud listings carry the same exclusion: "Mavic 3 Enterprise Series (excluding DJI Mavic 3 Multispectral)" [OFFICIAL] — [DJI Store AT](https://store.dji.com/at/product/dji-flighthub-2-enterprise-version-3-years-1-device).
- DJI's minimum client PC for the web UI: i5 8th gen, 8 GB RAM, discrete GPU, 1920×1080. Recommended: i5 12th gen, RTX 3060, ≥ 16 GB. Chrome ≥ 92. Bandwidth ≥ 50 Mbps. These figures come via a search summary of DJI FAQ/support pages, so verify them [OFFICIAL, via search summary] — [DJI FAQ](https://enterprise.dji.com/flighthub-2/faq).
- Third-party login requires an OAuth 2 identity provider [DEALER] — [heliguy](https://www.heliguy.com/products/dji-flighthub-2-on-premises/).

### Inferences
- A German home or small operator could probably buy through a Benelux or Polish dealer, or ask a German DJI Enterprise partner. Getting a trial approved likely needs a business identity.
- With a Mavic 3M + RC Pro Enterprise as the only hardware, FlightHub 2 (cloud or On-Prem) would not officially support the aircraft. That makes the licence spend pointless for this setup unless DJI adds 3M support. Check the current On-Prem release notes before any purchase.

### Gaps
- Official server hardware requirements (CPU/RAM/disk/OS/containers) for software-only On-Prem: not found in readable sources (Deployment Manual not read).
- No German authorized dealer page explicitly offering On-Premises was found.
- No statement on export or regulatory limits (e.g. EU/German procurement restrictions on DJI) specific to On-Prem.

## 5. Proprietary vs open source; customization, reverse proxy, integrations

### Takeaway
The server is closed, proprietary DJI software, distributed as licence-gated installation packages. No source code for the server is published. DJI officially supports integration rather than modification: an OpenAPI with 300+ endpoints, an MQTT Bridge, embeddable front-end components, OAuth 2.0 SSO and FlightHub Sync. No DJI statement about reverse proxies was found.

### Cited Findings
- **Secondary development options**: independent front-end components (Flight Routes Editor, Virtual Cockpit, Project/Map), OpenAPI for direct API integration, and an MQTT Bridge for messaging and forwarding [OFFICIAL] — [DJI release post](https://enterprise-insights.dji.com/blog/dji-flighthub-2-on-premises-officially-released).
- OpenAPI went from 67 endpoints to 300+ in V1.7, with on-prem API docs separate from cloud [OFFICIAL] — [DJI V1.7](https://enterprise-insights.dji.com/blog/dji-flighthub-2-on-premises-v1-7-update-august-2026).
- DroneDJ lists "deeper customization, custom integrations, MQTT Bridge, offline maps, broader API access" as On-Prem advantages [PRESS] — [DroneDJ](https://dronedj.com/2026/09/09/dji-flighthub-2-on-premises-update).
- Distribution is licence-gated: the installer is downloaded via the License Tool, and legacy packages are available only from DJI support or partners [OFFICIAL] — [developer.dji.com](https://developer.dji.com/resources/private/tool); [PRESS] — [DroneDJ](https://dronedj.com/2026/09/09/dji-flighthub-2-on-premises-update).
- The cloud edition is ISO 27001 certified by BSI. On-Prem data is fully customer-controlled [OFFICIAL] — [DJI release post](https://enterprise-insights.dji.com/blog/dji-flighthub-2-on-premises-officially-released).
- DJI also offers separate developer products, Cloud API and "Cloud API 2", on the same portal [OFFICIAL] — [developer.dji.com](https://developer.dji.com/resources/private/tool).

### Inferences
- The only open-source-adjacent part of DJI's ecosystem is the DJI Cloud API demo/SDK line. It is a separate product for building your own dock/RC cloud and is not part of FlightHub 2 On-Prem. This could not be verified here because GitHub access was out of scope.
- Putting FlightHub 2 On-Prem behind a reverse proxy (TLS termination, custom domain) is probably technically possible, since it is a web app plus MQTT. It is not officially documented in the sources read, and DJI support for such setups is unknown.

### Gaps
- No EULA or licence terms text was found, so restrictions on modification, reverse engineering and redistribution are unknown.
- No DJI documentation on reverse proxies, custom TLS certificates or port and protocol layouts was read (likely in the Deployment Manual).
