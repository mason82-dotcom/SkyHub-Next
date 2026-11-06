---
name: skyhub-planar-wayline
description: Offline DJI planar geometry and safe WPML reference analysis for SkyHub Next.
---
# SkyHub Planar Wayline Agent Skill

Use this repository-local skill for edits to area mapping, five-direction photogrammetry, terrain previews and planar KMZ compatibility.

## Source and owner
- Source reference: Tao-tao520/planar-wayline at commit 1599dacaee94390345e8feeff4f21a2042cc643a; MIT (copyright chengtao 2026).
- Canonical survey validation: frontend/public/wpml-survey-preview-core.js. Preserve polygon holes and separated components.
- Advanced geometric previews: frontend/public/wpml-planar-advanced-core.js.
- Canonical KMZ and WPML parsers: backend/wpml-kmz.js and backend/wpml.js.
- Strict reference-only adapter: backend/planar-wayline-compat.js.
- Canonical DEM endpoint: backend/mission-terrain.js, client frontend/public/wpml-terrain-client.js.
- UI design system: DESIGN.md and UX-CONTRACT.md.

## Mandatory safety boundaries
- No automatic flight-task dispatch, DJI RPC, WPML generation, device connection or terrain-service calls on page load.
- Never mark geometric candidates as safe air routes. Do not infer missing camera parameters or convert between WGS84, EGM96, terrain-relative AGL and start-relative altitude.
- WPML 1.0.6 is explicit reference-only. Do not rewrite it into 1.0.2.
- Upstream default drone 91, subtype 1, payload 81 is Matrice 3TD, never Mavic 3M or Matrice 4T.
- All preview outputs must remain flightReady=false, dispatchAllowed=false, exportableAsWaylines=false.
- A reference audit is neither Pilot 2 acceptance nor physical camera calibration.
- Never put mission coordinates, names or secrets in summary output.

## Tests and review
Use the existing project frontend-design / frontend-design-premium skills for UI changes. Maintain the existing light tokens.
Run:
- node --test backend/test/planar-wayline-advanced.test.js backend/test/planar-wayline-compat.test.js
- node --test backend/test/wpml-survey-preview.test.js backend/test/wpml-namespace-compat.test.js backend/test/wpml-photogrammetry.test.js
- node --check frontend/public/wpml-planar-ui.js
- node --check frontend/public/wpml-planar-advanced-core.js

Require separate real Pilot 2 import acceptance for RC Pro Enterprise with Mavic 3M and RC Plus 2 with Matrice 4T. Synthetic CI never certifies flight.
