# DJI FlightHub 2 On-Premises: Frontend Component Integration, Authentication and Security (as of 2026-10-24)

Scope note: Every fact below comes from a page fetched on 2026-10-24. DJI's GitHub demo repository was not accessed, as the assignment required. Claims about its contents and license are therefore unverified. The DJI SDK forum (sdk-forum.dji.net) needs a login, so it could not be read. Lines marked **[ASSESSMENT]** are my security analysis, not DJI documentation.

## 1. How the integration works (paas.js, window.FH2, initConfig, load/destroy, subscribe) and which editions support it

### Takeaway
The browser loads a `paas.js` runtime from the customer's own FH2 On-Premises server and calls `window.FH2.initConfig({serverUrl, wssUrl, hostUrl, prjId, projectToken})` once the window `load` event has fired. It then mounts components with `loadX(domId, props)` / `destroyX()` and listens for events with `subscribe()`. The feature is documented for On-Premises (and AIO) only, not for the public cloud.

### Cited Findings
- **Components.** The manual lists four. Flight Route Creation covers waypoint, area, slope, geometric and Smart 3D Capture routes. Flight Route Editor adds route editing and saving, map annotations, Cesium, and model loading. Virtual Cockpit offers one-click takeoff, livestream, manual flight with WASD keys plus trajectory display, and one-click RTH. Project/Map covers annotations, routes and trajectories, task areas and restricted zones, the device list, dock aircraft and manually flown aircraft. All four support custom themes and styles. Integration works with React, Vue or plain HTML+CSS. — [FH2 Manual: Frontend Component Integration (EN)](https://fh.dji.com/user-manual/en/custom-development/frontend-components/component-introduction.html)
- **Prerequisite.** You must deploy FlightHub 2 On-Premises. Deployment gives you a private IP or domain. — [FH2 Manual EN](https://fh.dji.com/user-manual/en/custom-development/frontend-components/component-introduction.html)
- **projectToken.** It is the organization key shown under My Organization > Organization Settings > FlightHub Sync. The prjId is the last segment of the project URL after `/project/`, and the segment after `/organization/` is the orgId. — [FH2 Manual EN](https://fh.dji.com/user-manual/en/custom-development/frontend-components/component-introduction.html). The Chinese page says the same: "这个组织密钥值就是 projectToken" (this organization key value is the projectToken). — [FH2 Manual CN](https://fh.dji.com/user-manual/cn/custom-development/frontend-components/component-introduction.html)
- **Runtime.** A `<script>` tag in `<head>` loads `paas.js` from the private FH2 IP or domain, with an `fh2` attribute. — [FH2 Manual EN](https://fh.dji.com/user-manual/en/custom-development/frontend-components/component-introduction.html)
- **initConfig.** All parameters are required. — [FH2 Manual EN](https://fh.dji.com/user-manual/en/custom-development/frontend-components/component-introduction.html)
  - `serverUrl`: backend HTTP address (default port **30812**)
  - `wssUrl`: duplex/WebSocket address (default port 30812, path **`/duplex/web`**)
  - `hostUrl`: address of the embedding web page
  - `prjId`
  - `projectToken`: the "OpenAPI authentication token" (organization key)
- **Load timing.** Call `initConfig` only after the window `load` event, otherwise you get "property undefined" errors. — [FH2 Manual EN](https://fh.dji.com/user-manual/en/custom-development/frontend-components/component-introduction.html)
- **DOM contract.** A wrapper `div.fh2-container` must contain these target elements: `wayline-header`, `project-app-container`, `project-middle-container`, `project-right-micro-app`, `map-app-global`, `wayline-app-container`. DJI recommends a container size of 100vw × 100vh. — [FH2 Manual EN](https://fh.dji.com/user-manual/en/custom-development/frontend-components/component-introduction.html)
- **Methods.** — [FH2 Manual EN](https://fh.dji.com/user-manual/en/custom-development/frontend-components/component-introduction.html)
  - `validateToken(token)` returns a boolean.
  - `loadWaylineCreation(domId, {folder_id?})` / `destroyWaylineCreation()`
  - `loadWayline(domId, {wayline_id})` / `destroyWayline(isEffect)`. Passing `isEffect=true` leaves the other components on the page unaffected. The default is false.
  - `loadCockpit(domId, {gatewaySn, droneSn, map?=true})` / `destroyCockpit(isEffect)`
  - `loadProject(domId)` / `destroyProject()`
  - `loadFlightPath(domId, {flight_path_id})` / `destroyFlightPath()`
  - `subscribe(eventName, cb)`
  - `window.FH2.cesiumViewer` exposes the keys `global` and `wayline_editor_support`.
  - `window.Cesium` is exposed globally, so you do not need to import Cesium yourself.
- **Events.** `wayline-save`, `wayline-cancel`, `wayline-back` and `wayline-creation-saved` each pass the route ID. The others are `wayline-creation-cancel`, `cesium-viewer-change` and `flight-path-back`. — [FH2 Manual EN](https://fh.dji.com/user-manual/en/custom-development/frontend-components/component-introduction.html)
- **Theming.** You theme the components through variables in `custom-style.css`. The demo switches themes with a class on `body`. — [FH2 Manual EN](https://fh.dji.com/user-manual/en/custom-development/frontend-components/component-introduction.html)
- **Release history.** On-Premises v1.1 (2025-02-27) introduced "flight route creation components, flight route editor components, virtual cockpit components". The latest On-Premises release is V2.0.1 (2026-10-21), after V2.0 (2026-10-14). — [FH2 On-Premises Release Notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- **DJI's announcement** (2025-06-13): "The Flight Routes Editor, Virtual Cockpit, and Project/Map are three independent frontend components that can be quickly integrated into the existing platform." It also mentions "Seamless account integration via OAuth 2.0". — [DJI Enterprise Insights](https://enterprise-insights.dji.com/blog/dji-flighthub-2-on-premises-officially-released)
- **Edition availability** (secondary source). A reseller comparison table lists frontend components as "No" for the public cloud tiers and "Yes" for On-Premises and AIO. — [Heliguy comparison guide](https://www.heliguy.com/blogs/posts/dji-flighthub-2-comparison-public-cloud-vs-on-prem-vs-aio/) (seen as a search snippet only; the page itself was not fetched)
- **Page date.** The Chinese component page carries the date 2026-10-16, so the documentation is current. — [FH2 Manual CN](https://fh.dji.com/user-manual/cn/custom-development/frontend-components/component-introduction.html)

### Inferences
- The runtime is proprietary and served from the FH2 server itself. Every page that embeds it therefore trusts and executes whatever code that server delivers, and the runtime version always matches the server version.
- The DOM contract uses fixed IDs and classes, and the runtime exposes globals (`window.FH2`, `window.Cesium`). Because the components are not isolated, only one FH2 instance per page is realistic.
- The four components cover the requested scope: project map, wayline creation/editing, flight path (`loadFlightPath`) and virtual cockpit.

### Gaps
- The manual gives no versioned API reference or changelog for `paas.js` methods and events.
- I found no official statement that the public cloud (fh.dji.com) is excluded. The exclusion rests on the On-Premises prerequisite and on the Heliguy table.

## 2. The projectToken / organization key: scope, lifetime, rotation, alternatives, and exposure risk

### Takeaway
The projectToken is the organization-scoped OpenAPI key, a JWT. The same value serves as `X-User-Token` for the full OpenAPI. It can be refreshed at any time, which immediately invalidates the old key. DJI documents no short-lived or browser-scoped token for the components. The only related mechanism is On-Premises "Third-Party OAuth" with temporary access tokens, which is configured at deployment and whose link to the components is undocumented.

### Cited Findings
- **Same credential as the OpenAPI.** OpenAPI authentication sends `X-User-Token` plus `X-Project-Uuid`. "X-User-Token is a JWT token", and for FH2 it "is the organization key for FlightHub Sync" (path: My Organization > Organization Settings > FlightHub Sync > Organization Key). The server checks that the token's user has access to the project. — [FH2 OpenAPI Authentication Tutorial (apifox)](https://fh2-api-en.apifox.cn/doc-6067870.md)
- **On-Premises V2 wording.** The On-Premises V2 auth docs describe the token as "the organization-dimension OpenAPI key (JWT ticket)". They give a *different* console path: "My Organization → Organization Settings → OpenAPI → Copy Key". The payload contains organization, user and expiration time, and expired tokens return HTTP 401. — [FH2 On-Premises OpenAPI V2 docs (apifox)](https://41b04hdzmc.apifox.cn/9022450m0)
- **Rotation.** The key can be refreshed "at any time". After a refresh, "the old key becomes invalid immediately". — [FH2 On-Premises OpenAPI V2 docs (apifox)](https://41b04hdzmc.apifox.cn/9022450m0)
- **Permissions.** If the key's user "has no permission for the target project, the request will be rejected." The key acts with that user's project role. — [FH2 On-Premises OpenAPI V2 docs (apifox)](https://41b04hdzmc.apifox.cn/9022450m0)
- **Token exchange.** The OpenAPI docs describe no token-exchange or user-token endpoint. — [FH2 On-Premises OpenAPI V2 docs (apifox)](https://41b04hdzmc.apifox.cn/9022450m0)
- **API size.** OpenAPI V2.0 On-Premises shipped in v1.6 (2026-06-16) with "over 300 interfaces", up from 67 in V1.0. The API includes real-time control command distribution, control acquisition and release, flight task creation, livestream start and forwarding, adding personnel to projects, and storage upload credentials. — [Release Notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html); [apifox index](https://fh2-api-en.apifox.cn/llms.txt)
- **Third-Party OAuth.** "Third-party OAuth allows users to access FlightHub using temporary authorization tokens (Access Tokens)… improves the security and efficiency of integrating FlightHub into existing business systems." It is "supported only in the FlightHub 2 On-Premises Version". The relevant fields are configured at deployment time, as described in the On-Premises Deployment Manual. — [FH2 Manual: FlightHub Sync Introduction](https://fh.dji.com/user-manual/en/custom-development/flighthub-sync-release/sync-introduction.html)
- **Hardcoded token in examples.** The component page puts a sample token directly in frontend HTML and gives no warning about exposing it. — [FH2 Manual CN](https://fh.dji.com/user-manual/cn/custom-development/frontend-components/component-introduction.html)
- **Undocumented config fields.** The TypeScript `IFH2Config` sample includes `userId`, `orgId` and `token`, which are not in the initConfig table, and it omits `projectToken`. — [FH2 Manual CN](https://fh.dji.com/user-manual/cn/custom-development/frontend-components/component-introduction.html)

### Inferences
- **[ASSESSMENT]** Anyone who can load the dashboard can read the projectToken (DevTools, page source, memory). It is not a narrowly scoped component token. It is the organization OpenAPI key, which:
  - opens the full OpenAPI with the permissions of the user who owns it;
  - covers potentially every project that user can access, not only `prjId`;
  - is a bearer credential, so it works from any client, including curl outside the browser.
- **[ASSESSMENT]** A leaked key could let an attacker:
  - list projects and devices;
  - read flight tasks, trajectories and media;
  - create flight tasks;
  - take or release control and send real-time control commands (drone-safety relevant);
  - start or forward livestreams;
  - add people to projects;
  - obtain storage upload credentials.

  This holds to the extent the owning user's role allows those actions.
- **[ASSESSMENT]** DJI documents an expiry claim in the JWT but not its value. Revocation means refreshing the key, which breaks every integration using it, including FlightHub Sync, OpenAPI backends and component pages.
- **[ASSESSMENT]** The undocumented `userId`/`orgId`/`token` fields hint at a possible session or user-token mode. This is not documented and should not be relied on without confirmation from DJI.

### Gaps
- Default JWT lifetime, maximum lifetime, and whether keys can be scoped per project or per role: not documented.
- Whether more than one key can exist per organization, and which console roles can view or refresh it: not documented.
- Whether Third-Party OAuth access tokens can be passed to `initConfig` instead of the organization key: not documented. The available deployment manual does not establish this mapping.
- Whether the "FlightHub Sync > Organization Key" path and the "OpenAPI > Copy Key" path refer to the same key in V2.0: unclear. The two docs disagree.

## 3. DJI's security guidance (TLS, CORS/CSP, iframe vs. script, CSS/DOM side effects, browser support)

### Takeaway
DJI gives essentially no security guidance for the components. It does not cover TLS, CORS, CSP, iframes or browsers, and its examples use `http://` and `ws://`. The only documented hazards are CSS and DOM side effects. Server-side, On-Premises offers one-click HTTPS certificates since v1.5, and Dock 4 requires HTTPS.

### Cited Findings
- **Not stated on the page.** The component page does not cover browser support, HTTPS/WSS requirements, version requirements, or iframe and CORS considerations. Its examples use `http` and `ws` URLs, and the Chinese example for the parameter named `wssUrl` uses `ws://`. — [FH2 Manual EN](https://fh.dji.com/user-manual/en/custom-development/frontend-components/component-introduction.html); [FH2 Manual CN](https://fh.dji.com/user-manual/cn/custom-development/frontend-components/component-introduction.html)
- **Body background.** The component applies a global `body` background that can turn the page white. DJI suggests overriding it in the host site's CSS, for example with `!important`. — [FH2 Manual EN](https://fh.dji.com/user-manual/en/custom-development/frontend-components/component-introduction.html)
- **Misplaced elements.** Waypoints, annotations and message prompts can be misplaced if the container or any ancestor sets one of these. — [FH2 Manual EN](https://fh.dji.com/user-manual/en/custom-development/frontend-components/component-introduction.html)
  - `transform` or `perspective` other than none
  - `filter` other than none
  - `will-change: transform/perspective`
  - `contain: paint`
- **Server-side TLS.** On-Premises v1.5 (2026-04-29) "Supports one-click HTTPS certificate retrieval". V2.0 (2026-10-14) states "DJI Dock 4 currently supports HTTPS only". V2.0 also made local MQTT configuration changes require `x-user-token`, to "prevent unauthorized users from changing MQTT configurations". v1.6 "Fixes common security issues found in previous versions". — [Release Notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- **OpenAPI security statement.** The On-Premises OpenAPI V2 page (dated 2026-09-20) says only that the headers exist "to ensure the security of OpenAPI and to implement access control". It gives no guidance on HTTPS or on keeping keys on the backend. — [FH2 Manual: On-Premises OpenAPI V2](https://fh.dji.com/user-manual/en/custom-development/open-api/private-cloud-v2.html)

### Inferences
- **[ASSESSMENT]** The dashboard is served over HTTPS behind Caddy, so browsers will block mixed content (`http://`/`ws://` calls to FH2 on :30812). In practice:
  - FH2 must be reachable over `https://` and `wss://`, either through its own certificate or through Caddy reverse-proxying `/duplex/web` with WebSocket upgrade;
  - `serverUrl` and `wssUrl` must use those schemes.
- **[ASSESSMENT]** Script embedding (not iframe) means `paas.js` runs with full access to the host page's origin: DOM, cookies without HttpOnly, localStorage, and other secrets.
  - A CSP must allow `script-src`, `connect-src` (https and wss), `img-src`, `worker-src` and probably `'unsafe-eval'` for the FH2 origin. Cesium bundles often need workers and blob: URLs. Measure the exact needs empirically.
  - CORS on the FH2 backend must allow the `hostUrl` origin.
  - A safer pattern is to host the components on a dedicated sub-origin page, served by Caddy without other secrets, and frame that page from the dashboard. DJI neither documents nor endorses this.
- **[ASSESSMENT]** The CSS rules imply that the host app's layout wrappers must not use transform-based animations or filters around the container.

### Gaps
- Supported browsers, minimum WebGL requirements, and the CORS headers FH2 sends: not documented. Verify on the device.
- Whether `paas.js` supports Subresource Integrity or fixed versioned URLs: not documented.

## 4. Related server-side APIs (FlightHub Sync, OpenAPI), how they authenticate, and whether a backend proxy is supported

### Takeaway
OpenAPI V2 (REST under `/openapi/v2.0/`, port 30812 in the examples) and FlightHub Sync (EventAPI with HMAC-SHA256 signed pushes, MQTT Bridge, file and livestream sync) are DJI's server-to-server integration paths. They authenticate with the same organization key in the headers. DJI does not document a backend-proxy pattern for the frontend components, and it does not forbid one either.

### Cited Findings
- **OpenAPI V2 basics.** The examples use `Host: 127.0.0.1:30812` and paths such as `GET /openapi/v2.0/drc/health`. Headers are `x-user-token`, `X-Project-Uuid`, `X-Language` and `X-Request-Id`, and most interfaces require them. The page is dated 2026-09-20. — [FH2 Manual: On-Premises OpenAPI V2](https://fh.dji.com/user-manual/en/custom-development/open-api/private-cloud-v2.html)
- **FlightHub Sync.** EventAPI is "FlightHub Sync's active notification service for pushing business events to third-party platforms in real time". It can "Validate request sources using HMAC-SHA256 signatures". On-Premises uses the MQTT Bridge in place of telemetry push. — [FH2 Manual: FlightHub Sync Introduction](https://fh.dji.com/user-manual/en/custom-development/flighthub-sync-release/sync-introduction.html)
- **Event API availability.** Event API was added in On-Premises v1.5 (2026-04-29). — [Release Notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)
- **Known doc gap** (community). A DJI developer forum post reported that the English OpenAPI docs do not list a base URL, and described an "invalid token format" error (code 200401). DJI support pointed the user to the organization key page. — search-result summary of [DJI SDK Forum: DJI FlightHub 2 OpenAPI](https://sdk-forum.dji.net/hc/zh-cn/community/posts/45646586535193-DJI-FlightHub-2-OpenAPI) (login-gated; the post could not be read directly)

### Inferences
- **[ASSESSMENT]** A backend proxy (Caddy or Node) that injects `x-user-token` on behalf of the browser would work for plain OpenAPI calls made by the dashboard backend, where it is the recommended pattern. It does not hide the key from `paas.js`, because `initConfig` takes the token client-side and the runtime presumably sends it on its own HTTP and WebSocket calls.
- **[ASSESSMENT]** A proxy that strips and re-injects the header would require reverse-engineering the runtime's requests. That approach is unsupported and fragile across FH2 updates.

### Gaps
- No DJI statement on whether the components can authenticate with anything other than the org key, or whether a token-injecting reverse proxy is supported.

## 5. Licensing of the demos vs. the proprietary runtime, and restrictions on embedding or redistribution

### Takeaway
The manual links a GitHub demo (`dji-sdk/FlightHub-2-Frontend-Standalone-Component`) but states no license. I could not verify the Apache-2.0 claim, because GitHub access was prohibited. `paas.js` is served by the licensed FH2 server, and I found no public redistribution terms for it.

### Cited Findings
- **Demo license.** The manual references the demo at `dji-sdk/FlightHub-2-Frontend-Standalone-Component` without stating a license. — [FH2 Manual EN](https://fh.dji.com/user-manual/en/custom-development/frontend-components/component-introduction.html); [FH2 Manual CN](https://fh.dji.com/user-manual/cn/custom-development/frontend-components/component-introduction.html)
- **Developer portal.** The DJI developer portal for On-Premises shows "Copyright © 2020 DJI All Rights Reserved" and links to Terms of Use, but includes no component-specific license text. — [DJI Developer: On-Premises landing](https://developer.dji.com/resources/private/landing)

### Inferences
- **[ASSESSMENT]** Treat `paas.js` as proprietary. Load it live from the FH2 server; do not vendor or redistribute it. Copying demo HTML/CSS is fine only after you confirm the repository LICENSE through an approved channel.

### Gaps
- The Apache-2.0 license of the demos: unverified here.
- No terms found that specifically govern embedding the components or redistributing the runtime. The On-Premises license agreement is not public.

## 6. Known limitations, documentation inconsistencies, and community-reported issues

### Takeaway
The documentation is current (Oct 2026) but internally inconsistent: parameter names, undocumented methods, two different key paths, and http/ws examples. Community feedback (thin and partly login-gated) describes On-Premises integration as restricted and lagging the cloud.

### Cited Findings
- **Parameter names.** The cockpit table uses `gatewaySn`/`droneSn`, while the TypeScript sample uses `gateway_sn`/`drone_sn`. — [FH2 Manual EN](https://fh.dji.com/user-manual/en/custom-development/frontend-components/component-introduction.html)
- **Undocumented methods.** The TypeScript sample shows `updateWayline` and a `routerName` argument that the method list does not include. The `loadProject` table lists `domId` as type boolean, which is probably a typo. — [FH2 Manual EN](https://fh.dji.com/user-manual/en/custom-development/frontend-components/component-introduction.html); [FH2 Manual CN](https://fh.dji.com/user-manual/cn/custom-development/frontend-components/component-introduction.html)
- **Config interface.** `IFH2Config` has `userId`/`orgId`/`token` and lacks `projectToken`. — [FH2 Manual CN](https://fh.dji.com/user-manual/cn/custom-development/frontend-components/component-introduction.html)
- **Two key paths.** The component manual and the older apifox tutorial say "FlightHub Sync > Organization Key". The On-Premises V2 apifox docs say "Organization Settings → OpenAPI → Copy Key". — [FH2 Manual EN](https://fh.dji.com/user-manual/en/custom-development/frontend-components/component-introduction.html); [apifox V1 tutorial](https://fh2-api-en.apifox.cn/doc-6067870.md); [apifox On-Prem V2](https://41b04hdzmc.apifox.cn/9022450m0)
- **Community feedback** (secondary, search snippet only). A trial user wrote that FH2 On-Premises "is still quite restricted in terms of integration", "a number of versions behind", and that "support is limited". — [DJI SDK Forum: How to Get Started with FlightHub 2 On-Premises Service](https://sdk-forum.dji.net/hc/zh-cn/community/posts/42905517233945-How-to-Get-Started-with-FlightHub-2-On-Premises-Service) (login-gated; the date is unknown and may be older than 2025)
- **New in V2.0.1.** On-Premises V2.0.1 (2026-10-21) adds a beta plugin framework, currently China only. — [Release Notes](https://fh.dji.com/user-manual/en/release-notes/release-notes-private.html)

### Inferences
- **[ASSESSMENT]** Pin integration code to the installed FH2 version, and re-test after every FH2 upgrade, because the runtime ships with the server. Feature-detect methods such as `typeof FH2.loadFlightPath === 'function'` rather than trusting the docs.
- **[ASSESSMENT]** Recommended secure setup for the Pi/Caddy dashboard. This is my own proposal, not DJI guidance.
  1. Create a dedicated FH2 user with the minimum project role, added only to the needed project(s). Use that user's organization key.
  2. Serve the component page only to authenticated dashboard users, for example behind Caddy forward-auth. Fetch the token from the backend at page load instead of baking it into static HTML.
  3. Put FH2 behind TLS (https/wss), set a strict CSP, and use a separate origin or iframe for the component page.
  4. Rotate the key after staff changes or a suspected leak, then update the backend secret.
  5. Prefer server-side OpenAPI and EventAPI with HMAC verification for automation.
  6. Evaluate Third-Party OAuth with DJI support as a possible short-lived alternative.

### Gaps
- No public bug tracker. Forum threads are login-gated, so community issues (for example CORS errors or WebSocket problems behind reverse proxies) could not be gathered.
