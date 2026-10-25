# SkyHub Next · Light UI (2026-10-24)

Branch: `feature/webui-light-redesign-20261024`

## Scope
The live read-only Operations dashboard, the separate TAK / CoT tab, Smart Farming's experimental index catalog, WPML waypoint editor, WPML route library, 2D Survey, and the compact DJI Pilot 2 pairing page share `frontend/public/skyhub-light.css`. The legacy SkyHub stack is intentionally untouched.

## Foundations
- Light-only, accessible UI: canvas `#f3f6fb`, surfaces `#ffffff`, text `#1b2b42`, blue action `#2458d3`, teal/success, amber warnings, red incidents.
- Semantic CSS design tokens with aliases for the legacy static pages; old embedded CSS remains for layout compatibility, while the shared stylesheet (loaded after each page's embedded styles) controls the visual skin.
- Consistent cross-module navigation on standalone operator pages. DJI Pilot 2 pairing remains compact and does **not** receive extra navigation.
- Breakpoints at 1320/900/660px. At <=660px, all five operator navigation links wrap into visible rows instead of hiding the active link in a horizontally scrolled strip; Chromium verifies their actual bounding rectangles. Focus-visible outlines, minimum 42px input/button height (44px menu links on smaller displays), reduced motion, map-first operations layout and card-based status.
- No new external dependencies, runtime state, browser storage, API actions or flight controls. Existing read-only, experimental, and safety warnings are preserved.

## Validation
```bash
node scripts/check-dashboard-inline.js
npm --prefix backend test
node --test backend/test/webui-light-theme.test.js
# Requires isolated Playwright/Leaflet/Socket.IO dependencies as configured in:
# .github/workflows/tak-ui-browser.yml
```
The Chromium TAK acceptance now **serves the actual skyhub-light.css**, asserts successful stylesheet loading, computed light canvas and white device cards, and checks mobile/desktop viewport overflow. WPML Chromium offline smoke and M3M isolated acceptance remain independent workflows. All GitHub runs must pass on the **final merged branch head**, not merely on an earlier commit.
Verify manually on 390px, 768px and desktop widths, both tabs, disconnected and connected telemetry states, map controls and all individual editor pages. Review in DJI Pilot 2 webview before promotion to production.

## Rollout and compatibility
This is a separate presentation-only branch; merge only after functional and hardware-independent UI review. The old inline per-page CSS can be retired in a later controlled refactor after checking all dynamically rendered HTML. The HTML pages continue to load locally served assets through the existing Express static serving path; no new build step is needed.

## Keyboard accessibility gate

All six static pages expose a first-tab, visually-on-focus `Zum Inhalt springen` link to the unique `<main id="skyhubMain" tabindex="-1">` landmark. The control is hidden above the viewport until focused; the shared CSS reveals it without JavaScript. Offline Chromium acceptance checks actual keyboard Tab → Enter, visibility and main focus on Operations, WPML, Route Library, Survey, Smart Farming and Pilot 2. The skip target contains no credentials and does not trigger DJI calls.

## System accessibility modes

The shared CSS now honors `forced-colors: active` through system palette tokens and a high-contrast outline for the current module/workspace selection. `prefers-reduced-motion: reduce` disables CSS animations and transitions. The DJI Pilot 2 brand accent no longer relies on a legacy inline color override. Browser tests emulate both OS modes in the synthetic loopback environment, then restore the normal light view; real Pilot 2 hardware remains a separate acceptance gate.

## Interaction-aware native form validation

Constraint-validated inputs and selects use `:user-invalid` for a distinct bordered error state **only after interaction**, not on initial page load. Fields marked by application code with `aria-invalid="true"` use the same visual treatment. A real offline Chromium WPML test checks that an invalid takeoff-height value receives the danger border and inset marker, and that a corrected value clears the invalid state. Field color is not a substitute for the existing textual review messages or WPML safety restrictions.

## Mobile route library quick navigation

The exceptionally long local route library now provides a four-target sticky, keyboard-operable in-page navigation: Bibliothek, Wegpunkte, Aktionen and Export. At 430px and below the controls switch to a **two-column, two-row layout** with 12px labels and 44px minimum target height rather than four cramped columns. All are native hash anchors to unique `tabindex="-1"` targets. The target scroll margin increases to 130px on small screens so the sticky header does not obscure the focused section. It does not persist data, change route inputs, contact SkyHub endpoints, or initiate DJI actions. Chromium verifies hash changes and DOM focus for a route-editing session, including 320px.

The skip-to-content link is additionally clipped while unfocused, retaining its position in keyboard tab order. This avoids visual overlay artifacts in synthetic full-page mobile screenshots while preserving its visible focus state.

## Cross-module navigation acceptance

The isolated WPML Chromium test follows actual operator navigation clicks between WPML Editor, Route Library, Survey and Smart Farming, returning to the editor. It repeats the journey at 320px and 390px screen widths, verifies the newly loaded shared CSS, a unique `aria-current="page"` link, the main landmark, no horizontal overflow, and no unexpected non-GET or external requests. The fifth navigation link to Operations remains statically verified across all pages; this loopback-only smoke does not attempt production dashboard authentication. The test deliberately contains no real credentials, real DJI connection, or route telemetry.

## Dashboard ↔ Smart Farming browser navigation

The TAK/Operations synthetic browser workflow additionally follows actual operator links in both directions between the Operations dashboard and Smart Farming, at 320px and 390px widths. It checks the unique selected `aria-current` state after each full document navigation, common light palette, main landmark and overflow. The test does not authenticate to any real service and the simulator refuses to accept non-GET HTTP writes. Together with the WPML Chromium journey, all five operator sections now have exercised navigation links.

## Operations mobile shortcut

At 320–900px, Operations now exposes a `Direkt zum Gerätestatus ↓` touch/keyboard link between tabs and the large read-only map. It targets the uniquely labelled and programmatically focusable `#fleetPanel` complementary landmark, preserving device state and avoiding any network activity. Desktop widths do not display it. The isolated Chromium browser checks 320px, 390px and 834px visibility, minimum 44px height, actual hash/focus/scroll, and continued device presence; the 1440px screenshot confirms it is hidden.

## Unobstructed mobile map interactions

At widths up to 660px, WPML Editor and Survey map instruction cards move from absolute overlays into a normal-flow, full-width safety notice **below** the interactive Leaflet map. The map remains at least 300px high and retains its zoom controls, while the complete no-flight-clearance wording stays readable. Desktop/tablet overlays are unchanged. Real Chromium now checks computed positioning, notice visibility, map height, zoom placement and absence of horizontal overflow for editor 390px and Survey 390/320px; no DJI commands are involved.
