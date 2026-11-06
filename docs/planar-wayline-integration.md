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

## P3 – Strict DEM provenance and bounded segment sampling (2026-11-06)

**Corrected risk:** The earlier DEM button sampled only the first strip, assuming its first point as takeoff. Elevations then could not be compared meaningfully across disjoint strips; null AGL extrema could be coerced to zero.

**New workflow:** After P0/P1, enter a hypothetical height above the real takeoff point and independently measured WGS84 takeoff latitude/longitude. The P3 button requests at most eight independent scan strips **sequentially**, one explicit read-only request each, using that same takeoff coordinate. Disconnected scan strips and holes are never joined into a fictional transit route. No network requests occur automatically.

**Validity gate:** Requires finite numeric AGL extrema, complete count, zero missing heights, numeric ground/flight/AGL/distance profiles, internally consistent height references and profile extrema. Missing and inconsistent samples are unknown, not 0. The aggregate reports sampled, failed and unrequested strips, always keeping flightReady=false, terrainVerified=false and exportableAsWaylines=false.

**UI lifecycle:** Polygon edits, dragging vertices, completing GeoJSON import or changing camera/scan parameters clears the advanced preview and cancels a pending DEM request. Changing only DEM takeoff settings cancels the request but preserves scan geometry. Optional amber dashed transition candidates remain non-flyable geometry and are visually distinct from blue scan segments and red unresolved gaps.

**Limitations:** At most the first eight segments are sampled. A result where every requested strip was sampled is still not obstacle, geofence, camera or Pilot 2 acceptance. Hypothetical height above takeoff is not measured DJI MSL. DEMs may miss poles, trees, overhead cables and buildings. If the terrain service is public, route/start coordinates are sent to that configured service; use self-hosted terrain data for private missions.

**Checks:** Run the planar advanced/compat tests, the original mission-terrain tests, and WPML namespace/browser CI before release. Physical controller/aircraft Pilot 2 verification is still separate.
