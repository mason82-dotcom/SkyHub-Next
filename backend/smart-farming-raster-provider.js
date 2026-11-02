'use strict';
// P3 ISOLATED LAB PROVIDER. Not imported by server.js; cannot itself authorize.
// Only use after the router's independently scoped workspace authorization.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFile} = require('node:child_process');
const crypto = require('node:crypto');

const CANDIDATE = /^m3m-exp-[0-9a-f]{24}$/;
const PRINCIPAL = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_STDOUT = 64 * 1024;
const WORKER = path.join(__dirname, 'workers', 'm3m_private_gis_query.py');

class RasterProviderError extends Error {
  constructor(message) { super(message); this.name = 'RasterProviderError'; }
}
function requireThat(condition, reason) {
  if (!condition) throw new RasterProviderError(reason);
}
function privateDirectory(dir, label) {
  requireThat(typeof dir === 'string' && path.isAbsolute(dir),
    label + ' must be an absolute path');
  const info = fs.lstatSync(dir);
  requireThat(info.isDirectory() && !info.isSymbolicLink() &&
    (info.mode & 0o077) === 0, label + ' must be a private ordinary directory');
  return fs.realpathSync(dir);
}
function childOf(root, candidate, wantFile) {
  requireThat(typeof candidate === 'string' && path.isAbsolute(candidate),
    'Private registry path must be absolute');
  const normalized = path.resolve(candidate);
  const relative = path.relative(root, normalized);
  requireThat(relative && relative !== '..' && !relative.startsWith('..' + path.sep) &&
    !path.isAbsolute(relative), 'Asset is outside configured trusted root');
  let current = root;
  const parts = relative.split(path.sep);
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const info = fs.lstatSync(current);
    requireThat(!info.isSymbolicLink(), 'Symlink in trusted asset path');
    if (i === parts.length - 1) {
      requireThat(wantFile ? info.isFile() && info.nlink === 1 : info.isDirectory(),
        'Asset kind invalid');
    } else {
      requireThat(info.isDirectory(), 'Intermediate asset path is not directory');
    }
  }
  requireThat(fs.realpathSync(normalized) === normalized,
    'Trusted asset path is not canonical');
  return normalized;
}
function validateRegistration(entry, principal, candidateId, roots) {
  requireThat(entry && typeof entry === 'object' && !Array.isArray(entry) &&
    Object.keys(entry).length === 5 &&
    entry.workspaceId === principal.workspaceId &&
    entry.candidateId === candidateId &&
    typeof entry.bundleDir === 'string' &&
    typeof entry.sealFile === 'string' &&
    typeof entry.sealSha256 === 'string' &&
    SHA256.test(entry.sealSha256) &&
    candidateId === 'm3m-exp-' + crypto.createHash('sha256')
      .update(Buffer.from(entry.sealSha256, 'hex')).digest('hex').slice(0, 24),
    'Untrusted or unpinned workspace registry entry');
  return {
    bundle: childOf(roots.sourceRoot, entry.bundleDir, false),
    seal: childOf(roots.sealRoot, entry.sealFile, true),
    sealSha256: entry.sealSha256
  };
}
function workerRun(pythonExecutable, args, scratch, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(pythonExecutable, args, {
      cwd: scratch,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: MAX_STDOUT,
      windowsHide: true,
      shell: false,
      env: {
        HOME: scratch,
        TMPDIR: scratch,
        PATH: process.env.PATH || '/usr/bin:/bin',
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONNOUSERSITE: '1',
        GDAL_PAM_ENABLED: 'NO',
        GDAL_DISABLE_READDIR_ON_OPEN: 'YES',
        PROJ_NETWORK: 'OFF'
      }
    }, (error, stdout) => {
      if (error) return reject(new RasterProviderError('Raster worker refused or failed'));
      if (typeof stdout !== 'string' || Buffer.byteLength(stdout, 'utf8') > MAX_STDOUT)
        return reject(new RasterProviderError('Raster worker report exceeded limit'));
      try {
        const parsed = JSON.parse(stdout);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')
          throw new Error('Worker response must be a JSON object');
        resolve(parsed);
      } catch (_) { reject(new RasterProviderError('Raster worker response invalid')); }
    });
  });
}

/**
 * Every call requires:
 * 1. prior HTTP principal + workspace candidate authorization,
 * 2. a trusted registry resolver that returns only server-owned paths and SHA,
 * 3. an independently pinned seal and full pixel/QA verification by the Python CLI.
 *
 * This module does NOT implement a production registry, Workspace RBAC, cgroups
 * or network isolation. It is an integration proof behind the unmounted router.
 */
function createPrivateRasterProvider({pythonExecutable, sourceRoot, sealRoot,
  scratchRoot, resolveRegisteredAsset, timeoutMs = 15000}) {
  requireThat(typeof resolveRegisteredAsset === 'function',
    'Trusted workspace asset resolver required');
  requireThat(typeof pythonExecutable === 'string' &&
    path.isAbsolute(pythonExecutable) && fs.statSync(pythonExecutable).isFile(),
    'Absolute Python executable required');
  requireThat(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 &&
    timeoutMs <= 30000, 'Worker timeout must be bounded');
  // Keep roots stable/canonical at setup; recheck on each use for replacement.
  const roots = {sourceRoot: privateDirectory(sourceRoot, 'Source root'),
    sealRoot: privateDirectory(sealRoot, 'Seal root'),
    scratchRoot: privateDirectory(scratchRoot, 'Scratch root')};
  requireThat(new Set(Object.values(roots)).size === 3,
    'Source, seal and scratch roots must be distinct');
  return async function sampleVerifiedBundle({principal, candidateId, geometry}) {
    requireThat(principal && typeof principal === 'object' &&
      PRINCIPAL.test(principal.actorId || '') &&
      PRINCIPAL.test(principal.workspaceId || '') &&
      CANDIDATE.test(candidateId || ''), 'Scoped principal and candidate required');
    requireThat(geometry && (geometry.type === 'Point' || geometry.type === 'Polygon'),
      'Previously validated geometry required');
    for (const [label, directory] of Object.entries(roots)) {
      requireThat(privateDirectory(directory, label) === directory, 'Private root changed');
    }
    // Trust boundary: injected resolver MUST enforce an authoritative registry
    // scoped by the requested principal/workspace. The browser cannot supply paths.
    const entry = await resolveRegisteredAsset({
      principal: Object.freeze({actorId: principal.actorId,
        workspaceId: principal.workspaceId}), candidateId
    });
    const {bundle, seal, sealSha256} = validateRegistration(entry, principal,
      candidateId, roots);
    const work = fs.mkdtempSync(path.join(roots.scratchRoot, 'm3m-private-query-'));
    try {
      fs.chmodSync(work, 0o700);
      const geometryFile = path.join(work, 'geometry.json');
      fs.writeFileSync(geometryFile, JSON.stringify(geometry) + '\n',
        {flag: 'wx', mode: 0o600});
      const args = [WORKER, '--bundle', bundle, '--seal', seal,
        '--seal-sha256', sealSha256, '--geometry-file', geometryFile];
      return await workerRun(pythonExecutable, args, work, timeoutMs);
    } finally {
      // Delete only the exclusively created directory, never source assets.
      fs.rmSync(work, {recursive: true, force: true});
    }
  };
}
module.exports = {RasterProviderError, createPrivateRasterProvider};
