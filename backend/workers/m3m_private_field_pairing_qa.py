#!/usr/bin/env python3
"""P3.6e: private, pinned field-pairing confounder screening; NOT scientific QA.

Only compares operator-entered metadata against operator-entered tolerances.
Neither values, input pins, firmware labels, timestamps nor paths are published.
Actual DJI firmware versions or field measurements are NOT authenticated.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

SCHEMA = 'skyhub-m3m-private-field-pairing-plan-v1'
RESULT_SCHEMA = 'skyhub-m3m-private-field-pairing-preflight-v1'
MAX_PLAN_BYTES = 32768
MAX_PAIRS = 8
HEX = re.compile(r'[0-9a-f]{64}\Z')
PAIR_FIELDS = ('exposureUs', 'sensorGainMilli', 'irradianceMilli',
               'flightHeightCm', 'captureTimeSeconds')
PCT_FIELDS = PAIR_FIELDS[:-1]
TOP_KEYS = frozenset(('schema', 'tolerances', 'pairs'))
PAIR_KEYS = frozenset(('A', 'B'))
SIDE_KEYS = frozenset(('sourceReceiptSha256', 'firmwareEvidenceSha256',
                       'dlsEvidenceSha256', 'panelEvidenceSha256',
                       *PAIR_FIELDS))
TOLERANCE_KEYS = frozenset((f + 'PctMax' for f in PCT_FIELDS)) | {
    'captureTimeSecondsMax'
}
VALUE_MAX = {
    'exposureUs': 100000000, 'sensorGainMilli': 100000000,
    'irradianceMilli': 1000000000000, 'flightHeightCm': 100000000,
    'captureTimeSeconds': 4102444800,
}
FALSE_FLAGS = (
    'sourceProvenanceVerified', 'firmwareVersionVerified',
    'operatorMeasurementsIndependentlyVerified',
    'operatorTolerancesProspectivelyRegistered',
    'radiometricCalibrationVerified', 'sunlightSensorValuesValidated',
    'panelCalibrationVerified', 'bandCoregistrationVerified',
    'reflectanceReady', 'ndviReady', 'ndreReady', 'scienceReady',
    'operationalUseAllowed', 'prescriptionExportAllowed',
    'flightMissionAllowed',
)

class PairingError(ValueError):
    """Invalid, contradictory or non-private operator field plan."""

def require(condition, reason):
    if not condition:
        raise PairingError(reason)

def _canonical(value):
    return (json.dumps(value, ensure_ascii=True, sort_keys=True,
                       separators=(',', ':'), allow_nan=False) + '\n').encode()

def _unique_pairs(pairs):
    result = {}
    for k, v in pairs:
        require(k not in result, 'Duplicate manifest key')
        result[k] = v
    return result

def _forbid_nonfinite(_):
    raise PairingError('Non-finite manifest value')

def _sha(value, *, optional=False):
    if optional and value is None:
        return None
    require(isinstance(value, str) and HEX.fullmatch(value) is not None,
            'Invalid independently archived SHA256 declaration')
    return value

def _read_private(path):
    require(path.is_absolute(), 'Private plan path must be absolute')
    require('..' not in path.parts and '.' not in path.parts,
            'Private plan path must be canonical')
    part = path
    while True:
        require(not part.is_symlink(), 'Symlinked plan path component')
        if part == part.parent:
            break
        part = part.parent
    require(path.parent.is_dir() and
            (path.parent.stat().st_mode & 0o077) == 0,
            'Private 0700 parent directory required')
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    except OSError as exc:
        raise PairingError('Unreadable private plan') from exc
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
                0 < before.st_size <= MAX_PLAN_BYTES and
                (before.st_mode & 0o077) == 0,
                'Expected bounded private regular 0600 plan')
        content = bytearray()
        while len(content) < before.st_size:
            block = os.read(descriptor, min(16384, before.st_size-len(content)))
            require(bool(block), 'Plan truncated during read')
            content.extend(block)
        after = os.fstat(descriptor)
        require((before.st_dev, before.st_ino, before.st_size,
                 before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size,
                 after.st_mtime_ns, after.st_ctime_ns),
                'Plan changed during read')
        return bytes(content)
    finally:
        os.close(descriptor)

def _read_int(value, *, low, high):
    require(type(value) is int and low <= value <= high,
            'Invalid operator-entered value/tolerance')
    return value

def _compare_numeric(a, b, tolerance, *, percentage):
    if a is None or b is None:
        return None
    if percentage:
        # Integer arithmetic, symmetric percentage of mean, no round-off.
        return 200 * abs(a-b) <= tolerance * (a+b)
    return abs(a-b) <= tolerance

def inspect(*, plan: Path, plan_sha256: str):
    plan = Path(plan)
    _sha(plan_sha256)
    raw = _read_private(plan)
    require(hashlib.sha256(raw).hexdigest() == plan_sha256,
            'Plan differs from externally archived pin')
    try:
        cfg = json.loads(raw.decode('utf-8'), object_pairs_hook=_unique_pairs,
                         parse_constant=_forbid_nonfinite)
    except (UnicodeError, ValueError, TypeError) as exc:
        raise PairingError('Invalid private field plan JSON') from exc
    require(isinstance(cfg, dict) and set(cfg) == TOP_KEYS and
            cfg['schema'] == SCHEMA and
            isinstance(cfg['pairs'], list) and
            1 <= len(cfg['pairs']) <= MAX_PAIRS,
            'Invalid field plan schema or pair count')
    require(_canonical(cfg) == raw, 'Plan must be canonical JSON')
    tol = cfg['tolerances']
    require(isinstance(tol, dict) and set(tol) == TOLERANCE_KEYS,
            'Unexpected or missing operator tolerances')
    for field in PCT_FIELDS:
        _read_int(tol[field+'PctMax'], low=0, high=100)
    _read_int(tol['captureTimeSecondsMax'], low=0, high=3600)
    counts = {k: {'matched': 0, 'mismatched': 0, 'unmeasured': 0}
              for k in PAIR_FIELDS}
    seen_sources = set()
    firmware = {'A': set(), 'B': set()}
    pairs_with_all_measured = 0
    pairs_matching_all_tolerances = 0
    pairs_missing_panel = 0
    pairs_missing_dls = 0
    for pair in cfg['pairs']:
        require(isinstance(pair, dict) and set(pair) == PAIR_KEYS,
                'Each paired trial requires A and B')
        observations = {}
        for cohort in ('A', 'B'):
            side = pair[cohort]
            require(isinstance(side, dict) and set(side) == SIDE_KEYS,
                    'Unexpected or missing operator observation field')
            source_sha = _sha(side['sourceReceiptSha256'])
            fw_sha = _sha(side['firmwareEvidenceSha256'])
            _sha(side['dlsEvidenceSha256'], optional=True)
            _sha(side['panelEvidenceSha256'], optional=True)
            require(source_sha not in seen_sources,
                    'Source receipt reused across paired observations')
            seen_sources.add(source_sha)
            firmware[cohort].add(fw_sha)
            for field in PAIR_FIELDS:
                value = side[field]
                if value is not None:
                    _read_int(value, low=1, high=VALUE_MAX[field])
            observations[cohort] = side
        require(observations['A']['sourceReceiptSha256'] !=
                observations['B']['sourceReceiptSha256'],
                'Same source pinned as both groups')
        pairs_missing_panel += int(any(observations[c]['panelEvidenceSha256']
                                       is None for c in ('A', 'B')))
        pairs_missing_dls += int(any(observations[c]['dlsEvidenceSha256']
                                     is None for c in ('A', 'B')))
        all_measured = True
        all_matched = True
        for field in PAIR_FIELDS:
            a, b = (observations[c][field] for c in ('A', 'B'))
            allowed = (tol[field+'PctMax'] if field in PCT_FIELDS else
                       tol['captureTimeSecondsMax'])
            match = _compare_numeric(a, b, allowed, percentage=field in PCT_FIELDS)
            outcome = 'unmeasured' if match is None else (
                'matched' if match else 'mismatched')
            counts[field][outcome] += 1
            if match is None:
                all_measured = False
            if match is not True:
                all_matched = False
        pairs_with_all_measured += int(all_measured)
        pairs_matching_all_tolerances += int(all_matched)
    # One firmware-document pin per cohort; two different byte pins are a
    # necessary structural condition only, NOT version or origin proof.
    require(len(firmware['A']) == len(firmware['B']) == 1 and
            firmware['A'].isdisjoint(firmware['B']),
            'Unstable or identical operator firmware evidence by cohort')
    require(hashlib.sha256(_read_private(plan)).hexdigest() == plan_sha256,
            'Private plan changed during screening')
    return {
        'schema': RESULT_SCHEMA,
        'classification': 'operator-declared-covariate-screen-not-scientific-validation',
        'pairedCaptureCount': len(cfg['pairs']),
        'operatorCovariateComparisonCounts': counts,
        'pairsWithAllCovariatesDeclared': pairs_with_all_measured,
        'pairsMatchingAllOperatorTolerances': pairs_matching_all_tolerances,
        'pairsMissingPanelEvidenceDeclaration': pairs_missing_panel,
        'pairsMissingDlsEvidenceDeclaration': pairs_missing_dls,
        'strictDistinctSourcePinAndCohortFirmwarePins': True,
        'privatePlanIntegrityRecheckedAfterScreening': True,
        'operatorThresholdsNotScientificallyEndorsed': True,
        'operatorMeasurementsAreClaimsOnly': True,
        'rawCovariatesOrPinsReleased': False,
        **{field: False for field in FALSE_FLAGS},
    }

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--plan-sha256', required=True)
    parser.add_argument('--require-complete-operator-plan', action='store_true',
                        help='Exit 3 for unmatched, unmeasured or missing declared DLS/panel evidence; never a science approval')
    opts = parser.parse_args(argv)
    try:
        report = inspect(plan=opts.plan, plan_sha256=opts.plan_sha256)
        print(json.dumps(report, sort_keys=True, allow_nan=False))
        if (opts.require_complete_operator_plan and (
                report['pairsMatchingAllOperatorTolerances'] !=
                report['pairedCaptureCount'] or
                report['pairsMissingPanelEvidenceDeclaration'] != 0 or
                report['pairsMissingDlsEvidenceDeclaration'] != 0)):
            return 3
        return 0
    except Exception as exc:
        print('Private M3M field-pairing screen refused: ' +
              type(exc).__name__, file=sys.stderr)
        return 2

if __name__ == '__main__':
    raise SystemExit(main())
