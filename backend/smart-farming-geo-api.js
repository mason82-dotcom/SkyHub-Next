'use strict';
// ISOLATED LAB ROUTER ONLY. Deliberately NOT imported/mounted by server.js.
// A view token is not sufficient to identify a field/workspace principal.
const ID = /^m3m-exp-[0-9a-f]{24}$/;
const IDENT = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const LAYERS = Object.freeze(['red', 'green', 'red_edge', 'nir', 'ndvi', 'ndre', 'gndvi', 'osavi']);
const BAND = new Set(LAYERS.slice(0, 4));
const MAX_BODY_BYTES = 16 * 1024;
const MAX_PIXELS = 250000;

class GeoApiError extends Error {
  constructor(message) { super(message); this.name = 'GeoApiError'; }
}
function demand(value, message) { if (!value) throw new GeoApiError(message); }
function ownKeys(item, keys) {
  return item && typeof item === 'object' && !Array.isArray(item) &&
    Object.keys(item).length === keys.length && keys.every(k => Object.hasOwn(item, k));
}
function coordinate(input) {
  demand(Array.isArray(input) && input.length === 2 &&
    input.every(Number.isFinite), 'Invalid lon/lat coordinate');
  const [lon, lat] = input;
  demand(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90, 'WGS84 bound exceeded');
  return [lon, lat];
}
function validatedGeometry(value) {
  demand(ownKeys(value, ['type', 'coordinates']), 'Only bare geometry objects supported');
  if (value.type === 'Point') return {type: 'Point', coordinates: coordinate(value.coordinates)};
  demand(value.type === 'Polygon' && Array.isArray(value.coordinates) &&
    value.coordinates.length === 1 && Array.isArray(value.coordinates[0]),
    'Only one Polygon exterior ring supported');
  const ring = value.coordinates[0];
  demand(ring.length >= 4 && ring.length <= 256, 'Bounded polygon vertices required');
  const points = ring.map(coordinate);
  demand(points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1],
    'Polygon ring must be closed');
  for (let i = 1; i < points.length; i++) {
    demand(points[i][0] !== points[i-1][0] || points[i][1] !== points[i-1][1],
      'Collapsed polygon edge');
  }
  const lons = points.map(p => p[0]), lats = points.map(p => p[1]);
  demand(Math.max(...lons) - Math.min(...lons) <= .25 &&
    Math.max(...lats) - Math.min(...lats) <= .25, 'Polygon too large');
  // This first-pass validation cannot prove planar geometric validity.
  // The Python GIS provider MUST independently reject self intersections,
  // antimeridian ambiguities, huge projected windows and polygons without pixels.
  return {type: 'Polygon', coordinates: [points]};
}
function validateRequest(body, length) {
  demand(Number.isSafeInteger(length) && length >= 0 && length <= MAX_BODY_BYTES,
    'Request too large');
  demand(ownKeys(body, ['schema', 'geometry']) &&
    body.schema === 'skyhub-m3m-geospatial-request-v1', 'Unsupported request schema');
  return validatedGeometry(body.geometry);
}
function validatePrincipal(value) {
  demand(ownKeys(value, ['actorId', 'workspaceId']) &&
    typeof value.actorId === 'string' && IDENT.test(value.actorId) &&
    typeof value.workspaceId === 'string' && IDENT.test(value.workspaceId),
    'Explicit scoped principal required');
  return Object.freeze({actorId: value.actorId, workspaceId: value.workspaceId});
}
function validStats(value, bound, pixels) {
  demand(value && typeof value === 'object' && !Array.isArray(value) &&
    Number.isSafeInteger(value.validPixels) && value.validPixels >= 0 &&
    value.validPixels <= pixels && Number.isSafeInteger(value.maskedOrNoDataPixels) &&
    value.maskedOrNoDataPixels === pixels - value.validPixels,
    'Invalid numerical sample counts');
  const fields = ['mean', 'min', 'max', 'median', 'p10', 'p90', 'stddev'];
  const result = {validPixels: value.validPixels, maskedOrNoDataPixels: value.maskedOrNoDataPixels};
  for (const field of fields) {
    const n = value[field];
    demand(value.validPixels ? typeof n === 'number' && Number.isFinite(n) : n === null,
      'Invalid sample statistics');
    if (value.validPixels && field !== 'stddev') {
      demand(n >= bound[0] && n <= bound[1], 'Sample out of expected range');
    }
    if (field === 'stddev' && value.validPixels) demand(n >= 0 && n <= bound[1] - bound[0],
      'Invalid standard deviation');
    result[field] = n;
  }
  if (value.validPixels) {
    demand(result.min <= result.p10 && result.p10 <= result.median &&
      result.median <= result.p90 && result.p90 <= result.max &&
      result.min <= result.mean + 1e-7 && result.mean <= result.max + 1e-7,
    'Inconsistent numerical sample statistics');
  }
  return result;
}
function sanitizeReport(report, geometryType) {
  demand(report && typeof report === 'object' && !Array.isArray(report) &&
    report.schema === 'skyhub-m3m-private-geospatial-query-v1' &&
    report.geometryType === geometryType && report.inputCrs === 'WGS84' &&
    Number.isSafeInteger(report.queryPixels) &&
    report.queryPixels > 0 && report.queryPixels <= MAX_PIXELS &&
    report.fullBundleIntegrityRecheckedAfterRead === true &&
    report.numericalValuesNotFromPng === true &&
    report.coordinatesPublished === false && report.rasterTilesPublished === false &&
    report.radiometricCalibrationVerified === false &&
    report.bandCoregistrationVerified === false &&
    report.reflectanceReady === false && report.ndviReady === false &&
    report.ndreReady === false && report.operationalUseAllowed === false &&
    report.prescriptionExportAllowed === false && report.flightMissionAllowed === false,
    'Unsafe or unverified GIS response');
  const statistics = report.statistics;
  demand(statistics && typeof statistics === 'object' && !Array.isArray(statistics) &&
    Object.keys(statistics).length === LAYERS.length &&
    LAYERS.every(k => Object.hasOwn(statistics, k)), 'Incomplete GIS raster statistics');
  const selected = {};
  for (const layer of LAYERS) {
    selected[layer] = validStats(statistics[layer],
      BAND.has(layer) ? [0, 1] : [-2, 2], report.queryPixels);
  }
  // Whitelist only: never forward input paths, geometry, CRS, file hashes or URLs.
  return Object.freeze({
    schema: 'skyhub-m3m-geo-sample-http-v1',
    classification: 'experimental-numeric-values-not-scientifically-calibrated',
    readOnly: true, operationalUseAllowed: false,
    prescriptionExportAllowed: false, flightMissionAllowed: false,
    geometryType: geometryType, queryPixels: report.queryPixels, statistics: selected,
    fullBundleIntegrityRecheckedAfterRead: true, radiometricCalibrationVerified: false,
    reflectanceReady: false
  });
}
function createSmartFarmingGeoRouter({express, authenticate, scopedPrincipal,
  authorizeWorkspaceCandidate, sampleVerifiedBundle, maxConcurrent = 2}) {
  demand(express && typeof express.Router === 'function', 'Explicit Express required');
  for (const [name, fn] of Object.entries({authenticate, scopedPrincipal,
    authorizeWorkspaceCandidate, sampleVerifiedBundle})) {
    demand(typeof fn === 'function', name + ' must be injected explicitly');
  }
  demand(Number.isSafeInteger(maxConcurrent) && maxConcurrent >= 1 &&
    maxConcurrent <= 8, 'Bounded concurrent GIS requests required');
  const router = express.Router();
  let inFlight = 0;
  router.use(authenticate);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  router.post('/:candidateId/sample', async (req, res) => {
    if (!ID.test(req.params.candidateId || '')) return res.sendStatus(404);
    if (!req.is('application/json')) return res.sendStatus(415);
    let geometry, principal;
    // Parse/identity errors are distinguishable from worker failures, with no
    // leak of geometry, source path or principal in any response.
    const declaredLength = Number(req.get('content-length'));
    if (req.get('content-length') &&
        (!Number.isSafeInteger(declaredLength) || declaredLength > MAX_BODY_BYTES))
      return res.sendStatus(413);
    try {
      const size = Buffer.byteLength(JSON.stringify(req.body ?? null), 'utf8');
      if (size > MAX_BODY_BYTES) return res.sendStatus(413);
      geometry = validateRequest(req.body, size);
    } catch (_) { return res.sendStatus(400); }
    try { principal = validatePrincipal(scopedPrincipal(req)); }
    catch (_) { return res.sendStatus(403); }
    try {
      // Never query or resolve candidate assets before independent authorization.
      const permitted = await authorizeWorkspaceCandidate({principal,
        candidateId: req.params.candidateId});
      if (permitted !== true) return res.sendStatus(404);
    } catch (_) { return res.status(503).json({error: 'Authorization unavailable'}); }
    if (inFlight >= maxConcurrent) return res.status(429).json({error: 'Busy'});
    inFlight++;
    try {
      const raw = await sampleVerifiedBundle({principal, candidateId: req.params.candidateId,
        geometry});
      return res.json(sanitizeReport(raw, geometry.type));
    } catch (_) {
      // Never leak files, coordinates, hashes, source error messages or principal IDs.
      return res.status(503).json({error: 'Private GIS analysis unavailable'});
    } finally { inFlight--; }
  });
  return router;
}
module.exports = {GeoApiError, validatedGeometry, validateRequest, validatePrincipal,
  sanitizeReport, createSmartFarmingGeoRouter};
