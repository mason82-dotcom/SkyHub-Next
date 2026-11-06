# SkyHub-Next: planar-wayline P0–P2 integration

## Provenance
Reference project: https://github.com/Tao-tao520/planar-wayline (MIT, 2026 chengtao), snapshot commit 1599dacaee94390345e8feeff4f21a2042cc643a. The implementation reuses SkyHub's hardened geometry validator, WPML parser, ZIP reader, DEM service and Light UI; no wholesale Vue/Cesium import.

## P0 – Planar coverage planning
The original SkyHub survey preview supplies bounded Polygon/MultiPolygon support, including holes, separated components and up to 2 km extent. The advanced planner tests 15-degree plus source-edge headings and scores each candidate using scan distance, direct gap estimates and a turn heuristic. It builds a limited visibility-graph path candidate for eligible same-component gaps; remaining gaps remain unresolved. Neither candidates nor ranking scores are executable flight plans. Areas with exclusions, obstacles and no-fly zones require independent verification.

## P1 – Five-direction + terrain preview
One nadir pass and four oblique passes use a simplified flat-terrain footprint offset based on explicit AGL height and camera pitch. The UI renders one pass at a time. Results are theory, not camera triggering actions. A dedicated button queries the existing read-only DEM API only for the first scan segment. This API interprets the entered h as height above takeoff, not as true AGL. It assumes the first point as the takeoff reference unless explicitly supplied. One DEM segment cannot verify the whole mission or building/mast clearance.

## P2 – Safe WPML KMZ review
Run the offline-only CLI:
node scripts/audit-planar-wayline-kmz.js path/to/mission.kmz mavic3m

Supported target selectors: mavic3m, matrice4t, mavic3e, mavic3t, matrice4e. The adapter uses existing bounded ZIP and strict namespace parsers. It identifies mapping2d/mapping3d, checks aircraft/payload metadata and blocks 1.0.6 as reference-only, never re-encodes the XML, never outputs route coordinates or mission titles, and never authorizes dispatch. Reference mappings: Mavic 3M 77:2/68; Matrice 4T 99:1/89; the upstream 91:1/81 is Matrice 3TD. XML shape does not prove provenance.

## Verification and restrictions
Synthetic Node tests live in backend/test/planar-wayline-advanced.test.js and backend/test/planar-wayline-compat.test.js. GitHub CI runs node --test backend/test/*.test.js. Manual checks are still needed for keyboard use, mobile 320/390/834/1440 px, actual DEM service availability, and both physical RC/drone pairs. No vehicle or aircraft interaction is performed by this integration. The agent skill is .agents/skills/skyhub-planar-wayline/SKILL.md and follows the existing DESIGN.md and UX-CONTRACT.md.
