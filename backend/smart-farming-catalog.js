'use strict';
// Opt-in, authenticated, metadata-only catalog. NEVER opens user-controlled paths.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {requireCatalogTransport} = require('./m3m-catalog-transport');

const MANIFEST = 'catalog-manifest.json';
const SCHEMA = 'skyhub-m3m-smart-farming-catalog-manifest-v1';
const CANDIDATE_SCHEMA = 'skyhub-m3m-smart-farming-candidate-v1';
const HEX64 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^m3m-exp-[0-9a-f]{24}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const LAYERS = ['ndvi', 'ndre', 'gndvi', 'osavi'];
const BLOCKED_FLAGS = ['cameraProvenanceVerified', 'radiometricCalibrationVerified',
  'bandCoregistrationVerified', 'reflectanceReady', 'ndviReady', 'ndreReady',
  'operationalUseAllowed', 'prescriptionExportAllowed', 'flightMissionAllowed',
  'geolocationPublished', 'tileUrlsPublished'];
const MAX_CANDIDATES = 100;

class CatalogError extends Error {
  constructor(message) { super(message); this.name = 'CatalogError'; }
}
function must(condition, message) { if (!condition) throw new CatalogError(message); }
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

// Open the *exact* configured file with O_NOFOLLOW. Reject mutation and hard links.
function pinnedRead(filename, maximum, expectedSha) {
  must(HEX64.test(expectedSha), 'Missing independently pinned SHA256');
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(filename, flags);
  try {
    const before = fs.fstatSync(fd);
    must(before.isFile() && before.nlink === 1 && before.size > 0 &&
      before.size <= maximum, 'Invalid bounded file');
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      must(count > 0, 'Unexpected file truncation');
      offset += count;
    }
    const after = fs.fstatSync(fd);
    must(after.dev === before.dev && after.ino === before.ino &&
      after.size === before.size && after.mtimeMs === before.mtimeMs &&
      after.ctimeMs === before.ctimeMs, 'File changed while reading');
    must(sha(bytes) === expectedSha, 'Pinned SHA256 differs');
    const raw = bytes.toString('utf8');
    const parsed = JSON.parse(raw);
    // Operator-owned registry must be compact canonical JSON: reject duplicate
    // keys, ambiguities and hidden fields before interpreting entry paths.
    if (path.basename(filename) === MANIFEST) {
      must(JSON.stringify(parsed) + '\n' === raw, 'Manifest must be canonical JSON');
    }
    return parsed;
  } finally { fs.closeSync(fd); }
}
function normalDirectory(dir) {
  const s = fs.lstatSync(dir);
  must(s.isDirectory() && !s.isSymbolicLink(), 'Expected directory without symlink');
}
function validateOptions({root, manifestSha256}) {
  must(typeof root === 'string' && path.isAbsolute(root), 'Absolute catalog root required');
  must(typeof manifestSha256 === 'string' && HEX64.test(manifestSha256),
    'Independent SHA256 of registry manifest is required');
  return {root: path.resolve(root), manifestSha256};
}
function readRegistry(options) {
  const {root, manifestSha256} = validateOptions(options);
  normalDirectory(root);
  const manifest = pinnedRead(path.join(root, MANIFEST), 65536, manifestSha256);
  must(manifest && typeof manifest === 'object' && !Array.isArray(manifest) &&
    manifest.schema === SCHEMA && Array.isArray(manifest.entries) &&
    manifest.entries.length <= MAX_CANDIDATES &&
    Object.keys(manifest).length === 2, 'Invalid catalog manifest schema');
  const ids = new Set(), slugs = new Set();
  for (const entry of manifest.entries) {
    must(entry && typeof entry === 'object' && !Array.isArray(entry) &&
      Object.keys(entry).length === 3 &&
      IDENTIFIER.test(entry.candidateId) && SLUG.test(entry.slot) &&
      HEX64.test(entry.candidateSha256), 'Invalid manifest entry');
    must(!ids.has(entry.candidateId) && !slugs.has(entry.slot), 'Repeated manifest item');
    ids.add(entry.candidateId);
    slugs.add(entry.slot);
  }
  return {root, entries: manifest.entries};
}
function readCandidate(registry, entry) {
  const dir = path.join(registry.root, 'entries');
  const slot = path.join(dir, entry.slot);
  normalDirectory(dir);
  normalDirectory(slot);
  const candidate = pinnedRead(path.join(slot, 'candidate.json'), 131072, entry.candidateSha256);
  must(candidate && typeof candidate === 'object' && !Array.isArray(candidate) &&
    candidate.schema === CANDIDATE_SCHEMA &&
    candidate.candidateId === entry.candidateId &&
    candidate.state === 'experimental_candidate' &&
    candidate.classification === 'locally-verified-integrity-not-radiometric-validity' &&
    candidate.indexCount === 4 &&
    Array.isArray(candidate.indexLayers) && candidate.indexLayers.length === 4 &&
    candidate.integrity && typeof candidate.integrity === 'object' &&
    HEX64.test(candidate.integrity.receiptSha256) &&
    candidate.integrity.rasterQaPassedAtRegistration === true &&
    candidate.integrity.sealedArtifactsMatched === 11, 'Invalid candidate schema');
  for (const flag of BLOCKED_FLAGS) must(candidate[flag] === false, 'Unsafe candidate readiness');
  const recomputedId = 'm3m-exp-' + sha(Buffer.from(candidate.integrity.receiptSha256, 'hex')).slice(0, 24);
  must(candidate.candidateId === recomputedId, 'Candidate ID must bind to sealed receipt');
  const indices = candidate.indexLayers.map((layer, i) => {
    must(layer && typeof layer === 'object' && layer.index === LAYERS[i] &&
      layer.title === LAYERS[i].toUpperCase() && layer.unit === 'dimensionless' &&
      layer.mapTilesAvailable === false && Number.isSafeInteger(layer.validPixels) &&
      layer.validPixels > 0 &&
      Number.isFinite(layer.mean) && Number.isFinite(layer.min) &&
      Number.isFinite(layer.max) && layer.min >= -2 && layer.max <= 2 &&
      layer.min - 1e-6 <= layer.mean && layer.mean <= layer.max + 1e-6,
      'Invalid index summary');
    // Never forward unexpected source properties (paths, URLs, geolocation etc).
    return {index: layer.index, title: layer.title, validPixels: layer.validPixels,
      mean: layer.mean, min: layer.min, max: layer.max,
      experimental: true, mapTilesAvailable: false};
  });
  return {candidateId: candidate.candidateId, state: 'experimental_candidate',
    indices, readOnly: true, experimental: true, mapTilesAvailable: false,
    recordSha256VerifiedAtRead: true, rasterQaRecheckedAtRead: false,
    radiometricCalibrationVerified: false, operationalUseAllowed: false,
    prescriptionExportAllowed: false, flightMissionAllowed: false};
}
function listCandidates(options) {
  const registry = readRegistry(options);
  // Fail closed for the entire catalog, rather than return a partial misleading list.
  return registry.entries.map(entry => readCandidate(registry, entry))
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId));
}
function createSmartFarmingCatalogRouter({express, auth, root, manifestSha256}) {
  must(express && typeof express.Router === 'function', 'Express is required');
  must(typeof auth === 'function', 'An explicit authentication middleware is mandatory');
  const options = validateOptions({root, manifestSha256});
  const router = express.Router();
  router.use(auth);
  router.use(requireCatalogTransport);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  router.get('/', (_req, res) => {
    try {
      const candidates = listCandidates(options);
      res.json({schema: 'skyhub-m3m-smart-farming-catalog-api-v1', readOnly: true,
        experimental: true, count: candidates.length, candidates});
    } catch (_) { res.status(503).json({error: 'Smart Farming catalog unavailable', readOnly: true}); }
  });
  router.get('/:candidateId', (req, res) => {
    if (!IDENTIFIER.test(req.params.candidateId || '')) return res.sendStatus(404);
    try {
      const candidates = listCandidates(options);
      const candidate = candidates.find(x => x.candidateId === req.params.candidateId);
      if (!candidate) return res.sendStatus(404);
      return res.json(candidate);
    } catch (_) { return res.status(503).json({error: 'Smart Farming catalog unavailable', readOnly: true}); }
  });
  return router;
}
module.exports = {CatalogError, readRegistry, listCandidates, createSmartFarmingCatalogRouter};
