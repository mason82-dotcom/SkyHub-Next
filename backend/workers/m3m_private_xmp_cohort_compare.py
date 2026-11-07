#!/usr/bin/env python3
"""P3.8: compare separately SHA-256-pinned M3M XMP *structure reports*, offline.

The input is P3.6c's sanitized JSON, never a private TIFF, XMP payload or
firmware string. Different marker patterns DO NOT establish firmware versions.
No writes, networking, sensors, DJI API or operational readiness.
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

SCHEMA = 'skyhub-m3m-private-xmp-cohort-comparison-v1'
REPORT_SCHEMA = 'skyhub-m3m-private-xmp-structure-cohort-v1'
REPORT_CLASS = 'documented-marker-presence-only-no-firmware-or-radiometry'
MAX_REPORTS = 8
MAX_BYTES = 16384
HEX64 = re.compile(r'[0-9a-f]{64}\Z')
FALSE_FLAGS = (
    'firmwareVersionReadOrReleased', 'firmwareVersionVerified',
    'manufacturerSourceAuthenticityVerified',
    'xmpMetadataClaimsScientificallyValidated',
    'rawNumbersOrMetadataReleased',
    'radiometricCalibrationVerified', 'sunlightSensorValuesValidated',
    'bandCoregistrationVerified', 'reflectanceReady', 'ndviReady',
    'ndreReady', 'scienceReady', 'operationalUseAllowed',
    'prescriptionExportAllowed', 'flightMissionAllowed',
)
REPORT_KEYS = {
    'schema', 'classification', 'originalSpectralTiffCount',
    'canonicalRequiredFieldsCompleteOnAllBands',
    'canonicalRequiredFieldMissingCounts',
    'documentedAdditionalMarkerPresenceCounts',
    'unknownDjiNamespaceMarkerCountsByInputOrder',
    'documentedMarkerCountsByInputOrder',
    'canonicalVignettingAndPolynomialCooccurCount',
    'manualReviewRequiredForCooccurringVignettingMetadata',
    'manualOnlyNoAutomaticAliases',
    'originalAndEvidencePinsRecheckedBeforeAndAfter',
    *FALSE_FLAGS,
}


class ComparisonError(ValueError):
    """The structural cohort report cannot be trusted or safely compared."""


def need(ok, reason):
    if not ok:
        raise ComparisonError(reason)


def _pairs(items):
    result = {}
    for key, value in items:
        need(key not in result, 'Repeated JSON field')
        result[key] = value
    return result


def _nonfinite(_):
    raise ComparisonError('Nonfinite input JSON')


def _cohort_contract():
    path = Path(__file__).resolve().with_name('m3m_private_xmp_cohort.py')
    spec = importlib.util.spec_from_file_location('_skyhub_p38_cohort_contract', path)
    need(spec is not None and spec.loader is not None, 'P3.6c contract unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _private_report(path: Path, pin: str):
    need(isinstance(pin, str) and HEX64.fullmatch(pin) is not None,
         'Previously archived SHA-256 report pin required')
    candidate = Path(path).expanduser().absolute()
    need(candidate.resolve(strict=True) == candidate,
         'Noncanonical or nested symlink report path')
    parent = candidate.parent
    need(parent.is_dir() and (parent.stat().st_mode & 0o077) == 0,
         'Private 0700 report directory required')
    fd = os.open(candidate, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
             (before.st_mode & 0o077) == 0 and
             0 < before.st_size <= MAX_BYTES,
             'Private 0600 ordinary bounded report required')
        chunks = bytearray()
        while len(chunks) < before.st_size:
            data = os.read(fd, min(4096, before.st_size - len(chunks)))
            need(bool(data), 'Report truncated during read')
            chunks.extend(data)
        after = os.fstat(fd)
        need((before.st_dev, before.st_ino, before.st_size,
              before.st_mtime_ns, before.st_ctime_ns) ==
             (after.st_dev, after.st_ino, after.st_size,
              after.st_mtime_ns, after.st_ctime_ns),
             'Report modified during read')
    finally:
        os.close(fd)
    raw = bytes(chunks)
    need(hashlib.sha256(raw).hexdigest() == pin,
         'Private report does not match independent SHA-256 pin')
    try:
        record = json.loads(raw.decode('utf-8'), object_pairs_hook=_pairs,
                            parse_constant=_nonfinite)
        # Exactly what the original P3.6c CLI prints, including trailing LF.
        canonical = (json.dumps(record, sort_keys=True, allow_nan=False) +
                     '\n').encode('utf-8')
    except (UnicodeError, ValueError, TypeError) as exc:
        raise ComparisonError('Malformed structural report') from exc
    need(raw == canonical, 'Noncanonical P3.6c JSON report')
    return record


def _validate(record, source):
    need(isinstance(record, dict) and set(record) == REPORT_KEYS and
         record['schema'] == REPORT_SCHEMA and
         record['classification'] == REPORT_CLASS and
         type(record['originalSpectralTiffCount']) is int and
         record['originalSpectralTiffCount'] == 4 and
         record['manualOnlyNoAutomaticAliases'] is True and
         record['originalAndEvidencePinsRecheckedBeforeAndAfter'] is True and
         all(record[name] is False for name in FALSE_FLAGS),
         'Unrecognized or overclaimed P3.6c report schema')
    missing = record['canonicalRequiredFieldMissingCounts']
    manual = record['documentedAdditionalMarkerPresenceCounts']
    unknowns = record['unknownDjiNamespaceMarkerCountsByInputOrder']
    documented = record['documentedMarkerCountsByInputOrder']
    need(isinstance(missing, dict) and set(missing) == set(source._module().REQUIRED) and
         isinstance(manual, dict) and set(manual) == set(source.MANUAL_FIELDS) and
         isinstance(unknowns, list) and len(unknowns) == 4 and
         isinstance(documented, list) and len(documented) == 4 and
         all(type(n) is int and 0 <= n <= 4
             for n in (*missing.values(), *manual.values())) and
         all(type(n) is int and 0 <= n <= source.MAX_UNKNOWN_KEYS for n in unknowns) and
         all(type(n) is int and 0 <= n <=
             len(source.MANUAL_FIELDS) + len(source._module().FIELDS)
             for n in documented) and
         record['canonicalRequiredFieldsCompleteOnAllBands'] is
         all(n == 0 for n in missing.values()),
         'Impossible or inconsistent marker inventory')
    overlap = record['canonicalVignettingAndPolynomialCooccurCount']
    need(type(overlap) is int and 0 <= overlap <= 4 and
         type(record['manualReviewRequiredForCooccurringVignettingMetadata']) is bool and
         record['manualReviewRequiredForCooccurringVignettingMetadata'] is (overlap > 0) and
         overlap <= manual['VignettingPolynomial'] and
         # VignettingData is a required marker in the base P3.6b inventory.
         overlap <= 4 - missing['VignettingData'],
         'Inconsistent overlapping VignettingData and VignettingPolynomial')
    # The known marker count per TIFF includes required, optional and manual.
    # Optional fields are not individually available in the P3.6c report.
    known_total = 4 * len(missing) - sum(missing.values()) + sum(manual.values())
    need(known_total <= sum(documented) <=
         known_total + 4 * len(source._module().OPTIONAL),
         'Documented marker counts disagree with the base XMP report')
    return missing, manual, unknowns, documented, overlap


def compare(*, reports, report_sha256):
    need(isinstance(reports, (list, tuple)) and
         isinstance(report_sha256, (list, tuple)) and
         2 <= len(reports) <= MAX_REPORTS and
         len(reports) == len(report_sha256),
         'Between two and eight separately pinned reports required')
    paths = [Path(path).expanduser().absolute() for path in reports]
    need(len(set(paths)) == len(paths), 'Repeated private report path')
    source = _cohort_contract()
    rows = []
    for path, pin in zip(paths, report_sha256):
        record = _private_report(path, pin)
        rows.append(_validate(record, source))
    # Re-validate all private records and pins after each individual parse.
    # The response is a strict allowlist and carries no report identity or pin.
    for path, pin, old in zip(paths, report_sha256, rows):
        need(_validate(_private_report(path, pin), source) == old,
             'Private report changed during comparison')

    missing_ranges = {
        name: [min(item[0][name] for item in rows),
               max(item[0][name] for item in rows)]
        for name in source._module().REQUIRED
    }
    marker_ranges = {
        name: [min(item[1][name] for item in rows),
               max(item[1][name] for item in rows)]
        for name in source.MANUAL_FIELDS
    }
    signatures = set()
    for missing, manual, unknowns, documented, overlap in rows:
        # Avoid falsely treating a different --tiff ordering as a new shape:
        # sort the four (unknown-marker-count, documented-count) pairs.
        signatures.add((
            tuple(missing[name] for name in source._module().REQUIRED),
            tuple(manual[name] for name in source.MANUAL_FIELDS),
            tuple(sorted(zip(unknowns, documented))), overlap
        ))
    flattened_unknown = [n for item in rows for n in item[2]]
    different = len(signatures) > 1
    return {
        'schema': SCHEMA,
        'classification': 'pinned-structural-report-comparison-not-firmware-attestation',
        'reportsCompared': len(rows),
        'allReportBytesMatchSuppliedPins': True,
        'pinsIndependentlyArchivedByOperatorVerified': False,
        'underlyingDistinctPhysicalCapturesVerified': False,
        'distinctStructuralPatternsObserved': len(signatures),
        'structuralDifferencesObserved': different,
        'canonicalRequiredMissingRangePerFourBands': missing_ranges,
        'additionalManualMarkerPresenceRangePerFourBands': marker_ranges,
        'unknownMarkerCountRangePerOriginal':
            [min(flattened_unknown), max(flattened_unknown)],
        'reportsContainingUnknownDjiMarkers':
            sum(any(n > 0 for n in item[2]) for item in rows),
        'reportsRequiringVignettingManualReview':
            sum(item[4] > 0 for item in rows),
        'reportsWithCompleteCanonicalRequiredFields':
            sum(all(n == 0 for n in item[0].values()) for item in rows),
        'rawMetadataOrPrivatePinsReleased': False,
        'firmwareVersionsVerified': False,
        'radiometricCalibrationVerified': False,
        'reflectanceReady': False,
        'agronomicUseAllowed': False,
        'prescriptionExportAllowed': False,
        'flightMissionAllowed': False,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', action='append', type=Path, required=True)
    parser.add_argument('--report-sha256', action='append', required=True)
    parser.add_argument('--require-uniform', action='store_true',
                        help='Exit 3 if report structures differ; never grants firmware readiness')
    args = parser.parse_args(argv)
    try:
        result = compare(reports=args.report, report_sha256=args.report_sha256)
    except Exception:
        print('Private M3M structural cohort comparison refused', file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, allow_nan=False))
    return 3 if args.require_uniform and result['structuralDifferencesObserved'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
