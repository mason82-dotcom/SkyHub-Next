#!/usr/bin/env python3
"""P3.6d private, independently pinned Mavic 3M cohort matrix (no firmware proof).

Reads an externally pinned private canonical manifest, replays the full P3.6c
four-TIFF check per capture, and emits aggregate structural marker deltas only.
Operator firmware evidence is byte-pinned but never interpreted or released.
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

SCHEMA = 'skyhub-m3m-private-firmware-cohort-manifest-v1'
REPORT_SCHEMA = 'skyhub-m3m-private-firmware-cohort-comparison-v1'
HEX = re.compile(r'[0-9a-f]{64}\Z')
MAX_MANIFEST = 32768
MAX_FIRMWARE_EVIDENCE = 8 * 1024 * 1024
MAX_CASES = 8
CASE_KEYS = frozenset((
    'cohort', 'tiffs', 'sourceReceipt', 'sourceReceiptSha256',
    'evidenceDir', 'evidenceManifestSha256',
    'firmwareEvidence', 'firmwareEvidenceSha256',
))
MANIFEST_KEYS = frozenset(('schema', 'cases'))
COHORTS = ('A', 'B')
FALSE_FLAGS = (
    'firmwareVersionVerified', 'manufacturerSourceAuthenticityVerified',
    'xmpMetadataClaimsScientificallyValidated',
    'sunlightSensorValuesValidated', 'radiometricCalibrationVerified',
    'bandCoregistrationVerified', 'reflectanceReady', 'ndviReady',
    'ndreReady', 'scienceReady', 'operationalUseAllowed',
    'prescriptionExportAllowed', 'flightMissionAllowed',
)

class MatrixError(ValueError):
    """Untrusted private manifest, source, or firmware-evidence pin."""

def require(ok, reason):
    if not ok:
        raise MatrixError(reason)

def _canonical(obj):
    return (json.dumps(obj, sort_keys=True, separators=(',', ':'),
                       ensure_ascii=True, allow_nan=False) + '\n').encode()

def _pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, 'Duplicate manifest JSON key')
        result[key] = value
    return result

def _no_number(_):
    raise MatrixError('Nonfinite manifest number')

def _read_private(path: Path, maximum: int):
    # Deny symlink components; no follow for the final descriptor.
    require(path.is_absolute(), 'Absolute private path required')
    current = path
    while True:
        require(not current.is_symlink(), 'Symlink path component refused')
        if current == current.parent:
            break
        current = current.parent
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        raise MatrixError('Private pinned file inaccessible') from exc
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
                0 < before.st_size <= maximum and
                (before.st_mode & 0o077) == 0,
                'Private pinned file must be bounded regular 0600')
        chunks = bytearray()
        while len(chunks) < before.st_size:
            part = os.read(fd, min(1024*1024, before.st_size-len(chunks)))
            require(bool(part), 'Pinned file truncated')
            chunks.extend(part)
        after = os.fstat(fd)
        require((before.st_dev, before.st_ino, before.st_size,
                 before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size,
                 after.st_mtime_ns, after.st_ctime_ns),
                'Pinned file changed while reading')
        return bytes(chunks)
    finally:
        os.close(fd)

def _pin(value):
    require(isinstance(value, str) and HEX.fullmatch(value) is not None,
            'Invalid externally pinned SHA256')
    return value

def _path(value, *, directory=False):
    require(isinstance(value, str) and 0 < len(value) <= 1024 and
            '\x00' not in value, 'Invalid private path')
    p = Path(value)
    require(p.is_absolute() and '..' not in p.parts and '.' not in p.parts,
            'Private paths must be absolute and canonical')
    if directory:
        require(p.is_dir(), 'Missing private evidence directory')
    return p

def _load_cohort_worker():
    path = Path(__file__).resolve().with_name('m3m_private_xmp_cohort.py')
    spec = importlib.util.spec_from_file_location('_skyhub_p36d_cohort', path)
    require(spec is not None and spec.loader is not None,
            'P3.6c cohort worker unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def compare(*, manifest: Path, manifest_sha256: str):
    manifest = Path(manifest)
    _pin(manifest_sha256)
    raw = _read_private(manifest, MAX_MANIFEST)
    require(hashlib.sha256(raw).hexdigest() == manifest_sha256,
            'Manifest differs from independently recorded SHA256')
    try:
        data = json.loads(raw.decode('utf-8'), object_pairs_hook=_pairs,
                          parse_constant=_no_number)
    except (ValueError, UnicodeError) as exc:
        raise MatrixError('Invalid private cohort JSON') from exc
    require(isinstance(data, dict) and set(data) == MANIFEST_KEYS and
            data['schema'] == SCHEMA and
            isinstance(data['cases'], list) and
            2 <= len(data['cases']) <= MAX_CASES,
            'Cohort manifest schema/case count refused')
    require(_canonical(data) == raw, 'Manifest must be canonical JSON')
    worker = _load_cohort_worker()
    results = {'A': [], 'B': []}
    seen_receipts = set()
    seen_source_pins = set()
    seen_tiff_paths = set()
    seen_tiff_file_ids = set()
    firmware_pins_by_cohort = {c: set() for c in COHORTS}
    for item in data['cases']:
        require(isinstance(item, dict) and set(item) == CASE_KEYS,
                'Unrecognized or missing case field')
        cohort = item['cohort']
        require(isinstance(cohort, str) and cohort in COHORTS,
                'Only anonymized A/B cohort labels allowed')
        tiffs = item['tiffs']
        require(isinstance(tiffs, list) and len(tiffs) == 4,
                'Exactly four explicit TIFF paths required')
        paths = [_path(v) for v in tiffs]
        require(len(set(paths)) == 4, 'Repeated source TIFF')
        receipt = _path(item['sourceReceipt'])
        evidence_dir = _path(item['evidenceDir'], directory=True)
        firmware = _path(item['firmwareEvidence'])
        source_pin = _pin(item['sourceReceiptSha256'])
        evidence_pin = _pin(item['evidenceManifestSha256'])
        firmware_pin = _pin(item['firmwareEvidenceSha256'])
        # Distinct filenames alone are NOT distinct captures. Refuse reused
        # capture receipt bytes, any original TIFF path, or physical file identity.
        require(str(receipt) not in seen_receipts and
                source_pin not in seen_source_pins,
                'Capture receipt file or digest reused across cases')
        seen_receipts.add(str(receipt))
        seen_source_pins.add(source_pin)
        for tiff in paths:
            require(str(tiff) not in seen_tiff_paths,
                    'Original TIFF path reused across captures')
            seen_tiff_paths.add(str(tiff))
            try:
                info = tiff.lstat()
            except OSError as exc:
                raise MatrixError('Original TIFF inaccessible') from exc
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
                    'Original TIFF must be a single-link regular file')
            file_id = (info.st_dev, info.st_ino)
            require(file_id not in seen_tiff_file_ids,
                    'Original TIFF inode reused across captures')
            seen_tiff_file_ids.add(file_id)
        # Byte-distinct operator evidence across A/B is a necessary condition
        # for distinct claims; it is NOT proof of any firmware version.
        firmware_pins_by_cohort[cohort].add(firmware_pin)
        require(firmware not in paths and firmware != receipt and
                firmware != manifest, 'Firmware evidence aliases input')
        firmware_bytes = _read_private(firmware, MAX_FIRMWARE_EVIDENCE)
        require(hashlib.sha256(firmware_bytes).hexdigest() == firmware_pin,
                'Operator firmware evidence digest mismatch')
        # An independently pinned opaque file is not proof of firmware.
        del firmware_bytes
        try:
            result = worker.census(
                tiffs=paths, source_receipt=receipt,
                source_receipt_sha256=source_pin, evidence_dir=evidence_dir,
                evidence_manifest_sha256=evidence_pin)
        except Exception as exc:
            raise MatrixError('Four-band source or XMP census refused') from exc
        require(result.get('schema') == worker.LAB_SCHEMA and
                result.get('originalAndEvidencePinsRecheckedBeforeAndAfter') is True and
                all(result.get(k) is False for k in FALSE_FLAGS),
                'Unexpected upstream science/readiness contract')
        results[cohort].append(result)
        # Detect mutation of the opaque firmware evidence during image scan.
        require(hashlib.sha256(_read_private(firmware, MAX_FIRMWARE_EVIDENCE)).hexdigest()
                == firmware_pin, 'Firmware evidence changed during census')
    require(all(results[c] for c in COHORTS),
            'Both anonymous cohorts must have independent captures')
    require(firmware_pins_by_cohort['A'].isdisjoint(firmware_pins_by_cohort['B']),
            'Identical operator firmware evidence reused across A and B')
    # Re-read the pinned manifest to catch modification during long scans.
    require(hashlib.sha256(_read_private(manifest, MAX_MANIFEST)).hexdigest()
            == manifest_sha256, 'Cohort manifest changed during census')
    fields = worker.MANUAL_FIELDS
    totals = {
        c: {f: sum(r['documentedAdditionalMarkerPresenceCounts'][f]
                   for r in results[c]) for f in fields}
        for c in COHORTS
    }
    missing = {
        c: {f: sum(r['canonicalRequiredFieldMissingCounts'][f]
                   for r in results[c]) for f in results[c][0]['canonicalRequiredFieldMissingCounts']}
        for c in COHORTS
    }
    # No firmware strings, case IDs, paths, hashes, raw numbers or metadata.
    report = {
        'schema': REPORT_SCHEMA,
        'classification': 'operator-evidence-pinned-structure-comparison-not-firmware-validation',
        'capturesPerAnonymousCohort': {c: len(results[c]) for c in COHORTS},
        'spectralTiffsPerAnonymousCohort': {c: 4*len(results[c]) for c in COHORTS},
        'documentedMarkerPresenceCountsByCohort': totals,
        'canonicalRequiredMissingCountsByCohort': missing,
        'documentedMarkerPresenceDeltaBMinusA': {
            f: totals['B'][f]-totals['A'][f] for f in fields},
        'allCanonicalRequiredFieldsCompleteByCohort': {
            c: all(r['canonicalRequiredFieldsCompleteOnAllBands']
                   for r in results[c]) for c in COHORTS},
        'operatorFirmwareEvidenceBytesIndependentlyPinned': True,
        'originalTiffAndEvidencePinsRecheckedPerCapture': True,
        'manifestSha256RecheckedAfterScan': True,
        'manualInterpretationRequired': True,
        'rawMetadataOrFirmwareVersionsReleased': False,
        **{key: False for key in FALSE_FLAGS},
    }
    return report

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest', type=Path, required=True)
    p.add_argument('--manifest-sha256', required=True)
    args = p.parse_args(argv)
    try:
        print(json.dumps(compare(manifest=args.manifest,
                                 manifest_sha256=args.manifest_sha256),
                         sort_keys=True, allow_nan=False))
        return 0
    except Exception as exc:
        print('Private M3M cohort comparison refused: ' +
              type(exc).__name__, file=sys.stderr)
        return 2

if __name__ == '__main__':
    raise SystemExit(main())
