#!/usr/bin/env python3
"""P3.5b sealed, version-bound result receipt for private P3.5a reference QA.

Create or independently replay a comparison report. No DJI provenance or
calibration attestation, signature, GIS publication, network, drone control,
or production API. SHA256 only proves integrity against an externally
retained digest, never authorship.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys

SCHEMA = 'skyhub-m3m-private-reference-result-receipt-v1'
SUMMARY = 'skyhub-m3m-private-reference-result-receipt-summary-v1'
MAX_RECEIPT = 32768
HEX = re.compile(r'[0-9a-f]{64}\Z')
CODE_FILES = (
    'm3m_private_reference_receipt.py',
    'm3m_private_reference_agreement.py',
    'm3m_raster_bundle_seal.py',
    'm3m_raster_bundle_verify.py',
)
FALSE_FLAGS = (
    'sourceProvenanceVerified',
    'referenceProvenanceIndependentlyVerified',
    'radiometricCalibrationVerified',
    'bandCoregistrationVerified',
    'reflectanceReady',
    'ndviReady',
    'ndreReady',
    'operationalUseAllowed',
    'prescriptionExportAllowed',
    'flightMissionAllowed',
)


class ReceiptError(ValueError):
    """Untrusted, unverifiable or drifting private result receipt."""


def require(valid, reason):
    if not valid:
        raise ReceiptError(reason)


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'),
                       allow_nan=False) + '\n').encode('utf-8')


def sha(payload):
    return hashlib.sha256(payload).hexdigest()


def valid_hash(value):
    return isinstance(value, str) and HEX.fullmatch(value) is not None


def _pairs(items):
    output = {}
    for key, value in items:
        require(key not in output, 'Duplicate JSON field')
        output[key] = value
    return output


def _nonfinite(_):
    raise ReceiptError('Nonfinite JSON value')


def _read_private(path, max_bytes):
    require(not path.is_symlink(), 'Symlinked receipt or code rejected')
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        start = os.fstat(fd)
        require(stat.S_ISREG(start.st_mode) and start.st_nlink == 1 and
                0 < start.st_size <= max_bytes, 'Artifact size or type refused')
        data = bytearray()
        while len(data) < start.st_size:
            chunk = os.read(fd, min(1024 * 1024, start.st_size - len(data)))
            require(chunk, 'Input truncated during verification')
            data.extend(chunk)
        end = os.fstat(fd)
        require((start.st_dev, start.st_ino, start.st_size, start.st_mtime_ns,
                 start.st_ctime_ns) ==
                (end.st_dev, end.st_ino, end.st_size, end.st_mtime_ns,
                 end.st_ctime_ns), 'File changed during verification')
        return bytes(data), start
    finally:
        os.close(fd)


def _version_contract():
    """Bind all local QA implementations plus raster runtime versions."""
    try:
        import numpy
        import rasterio
    except ImportError as exc:
        raise ReceiptError('Reference comparison libraries unavailable') from exc

    codes = {}
    for filename in CODE_FILES:
        path = Path(__file__).resolve().with_name(filename)
        code, _ = _read_private(path, 256 * 1024)
        codes[filename] = sha(code)
    return {
        'pythonMajorMinor': f'{sys.version_info.major}.{sys.version_info.minor}',
        'numpyVersion': numpy.__version__,
        'rasterioVersion': rasterio.__version__,
        'gdalVersion': rasterio.__gdal_version__,
        'workerSha256': codes,
    }


def _audit_worker():
    path = Path(__file__).resolve().with_name('m3m_private_reference_agreement.py')
    spec = importlib.util.spec_from_file_location('_skyhub_private_reference_receipt_audit', path)
    require(spec is not None and spec.loader is not None, 'Reference audit unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _recompute(bundle, seal_file, source_pin, reference_root, reference_pin):
    result = _audit_worker().audit(
        bundle=Path(bundle), seal=Path(seal_file),
        seal_sha256=source_pin, reference_dir=Path(reference_root),
        reference_manifest_sha256=reference_pin)
    require(result.get('schema') == 'skyhub-m3m-private-reference-agreement-v1' and
            result.get('classification') ==
            'experimental-quantitative-reference-agreement-not-calibration',
            'Unexpected source reference QA schema')
    require(all(result.get(flag) is False for flag in FALSE_FLAGS),
            'Unverified calibration or readiness must not be promoted')
    require(result.get('sourceIntegrityRecheckedBeforeAndAfter') is True and
            result.get('referenceIntegrityRecheckedBeforeAndAfter') is True,
            'Source or reference was not rechecked')
    require(result.get('pixelCount', 0) > 0 and
            set(result.get('bands', {})) == {'red', 'green', 'red_edge', 'nir'},
            'Incomplete quantitative comparison')
    canonical(result)
    return result


def _receipt_record(result, source_pin, reference_pin, version):
    return {
        'schema': SCHEMA,
        'classification': 'sha256-pinned-offline-replay-not-scientific-attestation',
        'sourceBundleSealSha256': source_pin,
        'referenceManifestSha256': reference_pin,
        'referenceAgreement': result,
        'implementation': version,
        'independentOperatorPinRequired': True,
        'cryptographicallySigned': False,
        'sourceProvenanceVerified': False,
        'referenceProvenanceIndependentlyVerified': False,
        'radiometricCalibrationVerified': False,
        'bandCoregistrationVerified': False,
        'reflectanceReady': False,
        'ndviReady': False,
        'ndreReady': False,
        'operationalUseAllowed': False,
        'prescriptionExportAllowed': False,
        'flightMissionAllowed': False,
    }


def _validate_record(record):
    expected = {
        'schema', 'classification', 'sourceBundleSealSha256',
        'referenceManifestSha256', 'referenceAgreement',
        'implementation', 'independentOperatorPinRequired',
        'cryptographicallySigned', *FALSE_FLAGS,
    }
    require(isinstance(record, dict) and set(record) == expected and
            record['schema'] == SCHEMA and
            record['classification'] ==
            'sha256-pinned-offline-replay-not-scientific-attestation' and
            record['independentOperatorPinRequired'] is True and
            record['cryptographicallySigned'] is False,
            'Incorrect result receipt schema')
    require(valid_hash(record['sourceBundleSealSha256']) and
            valid_hash(record['referenceManifestSha256']),
            'Invalid source or reference pin')
    require(all(record[flag] is False for flag in FALSE_FLAGS),
            'Unverified readiness in receipt')
    require(isinstance(record['implementation'], dict) and
            record['implementation'] == _version_contract(),
            'Runtime or source-code version no longer matches result receipt')


def _destination_ok(output: Path, bundle, reference_root):
    require(not os.path.lexists(output), 'Result receipt already exists')
    parent = output.parent
    require(parent.is_dir() and not parent.is_symlink() and
            parent.lstat().st_mode & 0o077 == 0,
            'Receipt requires independent 0700 private output parent')
    for root in (Path(bundle).expanduser().absolute(),
                 Path(reference_root).expanduser().absolute()):
        require(output != root and root not in output.parents and
                output != root.parent,
                'Result receipt must not be created inside either raster source')


def _summary(record, digest, replay):
    return {
        'schema': SUMMARY,
        'receiptSha256': digest,
        'comparedBandCount': 4,
        'allBandsWithinExploratoryLimits': record['referenceAgreement'][
            'allBandsWithinExploratoryLimits'],
        'freshIndependentReplayMatched': replay,
        'cryptographicallySigned': False,
        'radiometricCalibrationVerified': False,
        'operationalUseAllowed': False,
        'prescriptionExportAllowed': False,
        'flightMissionAllowed': False,
    }


def create(*, bundle, seal, seal_sha256, reference_dir,
           reference_manifest_sha256, output_file, private_output_ok=False):
    require(private_output_ok is True, 'Explicit private receipt opt-in required')
    require(valid_hash(seal_sha256) and valid_hash(reference_manifest_sha256),
            'Two independently pinned SHA256 digests required')
    target = Path(output_file).expanduser().absolute()
    _destination_ok(target, bundle, reference_dir)
    version = _version_contract()
    result = _recompute(bundle, seal, seal_sha256, reference_dir,
                        reference_manifest_sha256)
    # A change in code or runtime during the run must invalidate the receipt.
    require(_version_contract() == version, 'QA implementation changed during run')
    record = _receipt_record(result, seal_sha256, reference_manifest_sha256, version)
    _validate_record(record)
    payload = canonical(record)
    require(len(payload) <= MAX_RECEIPT, 'Receipt payload too large')
    # Last write: O_EXCL never overwrites. Failures must leave no partial receipt.
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                 getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        dirfd = os.open(target.parent, os.O_RDONLY |
                        getattr(os, 'O_DIRECTORY', 0))
        try:
            os.fsync(dirfd)
        finally:
            os.close(dirfd)
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    return _summary(record, sha(payload), False)


def verify(*, bundle, seal, seal_sha256, reference_dir,
           reference_manifest_sha256, receipt_file, receipt_sha256):
    require(all(valid_hash(v) for v in (
        seal_sha256, reference_manifest_sha256, receipt_sha256)),
        'Three independent hashes required for replay')
    path = Path(receipt_file).expanduser().absolute()
    content, info = _read_private(path, MAX_RECEIPT)
    require(info.st_mode & 0o077 == 0, 'Private receipt must be mode 0600')
    require(sha(content) == receipt_sha256,
            'Receipt not identical to independently retained digest')
    try:
        parsed = json.loads(content.decode('utf-8'), object_pairs_hook=_pairs,
                            parse_constant=_nonfinite)
    except (UnicodeError, ValueError, TypeError) as exc:
        raise ReceiptError('Malformed private receipt') from exc
    require(canonical(parsed) == content, 'Receipt is not canonical JSON')
    _validate_record(parsed)
    require(parsed['sourceBundleSealSha256'] == seal_sha256 and
            parsed['referenceManifestSha256'] == reference_manifest_sha256,
            'Input pins differ from recorded source versions')
    # Re-evaluate complete sealed 11-artifact source math, 4 reference hashes,
    # real raster numerical metrics, and compare every result field.
    reproduced = _recompute(bundle, seal, seal_sha256, reference_dir,
                            reference_manifest_sha256)
    require(canonical(reproduced) == canonical(parsed['referenceAgreement']),
            'Quantitative reference report did not reproduce exactly')
    # Catch receipt mutation during the expensive verification.
    require(_read_private(path, MAX_RECEIPT)[0] == content,
            'Receipt changed during replay')
    require(_version_contract() == parsed['implementation'],
            'Implementation changed during replay')
    return _summary(parsed, receipt_sha256, True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    for name in ('create', 'verify'):
        cmd = sub.add_parser(name)
        cmd.add_argument('--bundle', type=Path, required=True)
        cmd.add_argument('--seal', type=Path, required=True)
        cmd.add_argument('--seal-sha256', required=True)
        cmd.add_argument('--reference-dir', type=Path, required=True)
        cmd.add_argument('--reference-manifest-sha256', required=True)
        if name == 'create':
            cmd.add_argument('--output-file', type=Path, required=True)
            cmd.add_argument('--private-output-ok', action='store_true')
        else:
            cmd.add_argument('--receipt-file', type=Path, required=True)
            cmd.add_argument('--receipt-sha256', required=True)
    arg = parser.parse_args(argv)
    common = dict(bundle=arg.bundle, seal=arg.seal, seal_sha256=arg.seal_sha256,
                  reference_dir=arg.reference_dir,
                  reference_manifest_sha256=arg.reference_manifest_sha256)
    try:
        result = (create(**common, output_file=arg.output_file,
                         private_output_ok=arg.private_output_ok)
                  if arg.action == 'create' else
                  verify(**common, receipt_file=arg.receipt_file,
                         receipt_sha256=arg.receipt_sha256))
    except Exception as exc:
        # Never leak path, private GeoTIFF metadata, GPS, input SHA or UUID.
        print('Private M3M reference receipt refused: ' +
              type(exc).__name__, file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, allow_nan=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
