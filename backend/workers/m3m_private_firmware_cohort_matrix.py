#!/usr/bin/env python3
"""P3.6d: private, bounded multi-capture Mavic 3M field cohort matrix.

Compares structural XMP/evidence differences for independently pinned original
4-band captures, never radiometric values. Operator-supplied firmware labels
and their SHA-pinned opaque evidence are NEVER manufacturer attestation.
No network, public API, databases, original-image writes or flight control.
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

SCHEMA = 'skyhub-m3m-private-field-cohort-manifest-v1'
REPORT_SCHEMA = 'skyhub-m3m-private-field-cohort-matrix-v1'
MAX_MANIFEST = 65536
MAX_FIRMWARE_DOCUMENT = 4 * 1024 * 1024
MAX_CASES = 6
HEX = re.compile(r'[0-9a-f]{64}\Z')
FIRMWARE_LABEL = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,47}\Z')
BANDS = ('G', 'R', 'RE', 'NIR')
KIND_KEYS = ('sunlightSensor', 'panelImage', 'panelCertificate',
             'bandRegistration', 'independentReference')
SAFETY_FLAGS = (
    'firmwareVersionVerified', 'manufacturerSourceAuthenticityVerified',
    'independentScienceAssessmentPerformed', 'radiometricCalibrationVerified',
    'panelCalibrationVerified', 'sunlightSensorValuesValidated',
    'bandCoregistrationVerified', 'reflectanceReady', 'ndviReady', 'ndreReady',
    'scienceReady', 'operationalUseAllowed', 'prescriptionExportAllowed',
    'flightMissionAllowed',
)


class CohortMatrixError(ValueError):
    """Incomplete, changed or overclaimed private M3M cohort."""


def require(ok, message):
    if not ok:
        raise CohortMatrixError(message)


def _sha(blob):
    return hashlib.sha256(blob).hexdigest()


def _pairs(items):
    out = {}
    for key, value in items:
        require(key not in out, 'Duplicate JSON key')
        out[key] = value
    return out


def _nonfinite(_):
    raise CohortMatrixError('Nonfinite JSON numeric value')


def _canonical(obj):
    return (json.dumps(obj, sort_keys=True, separators=(',', ':'),
                       allow_nan=False) + '\n').encode('utf-8')


def _safe_path(raw, *, private_parent=False):
    require(isinstance(raw, (str, Path)) and 0 < len(str(raw)) <= 1024,
            'Invalid private path')
    p = Path(raw).expanduser().absolute()
    require(p.resolve(strict=True) == p and not p.is_symlink(),
            'Noncanonical or symlinked input path')
    if private_parent:
        parent = p.parent
        info = parent.stat()
        require(stat.S_ISDIR(info.st_mode) and
                (info.st_mode & 0o077) == 0 and
                parent.resolve(strict=True) == parent,
                'Private 0700 canonical document directory required')
    return p


def _read_private(raw, maximum):
    p = _safe_path(raw, private_parent=True)
    fd = os.open(p, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        first = os.fstat(fd)
        require(stat.S_ISREG(first.st_mode) and first.st_nlink == 1 and
                0 < first.st_size <= maximum and
                first.st_mode & 0o077 == 0,
                'Ordinary private mode-0600 file with bounded length required')
        buf = bytearray()
        while len(buf) < first.st_size:
            chunk = os.read(fd, min(1024 * 1024, first.st_size - len(buf)))
            require(chunk, 'Truncated input')
            buf.extend(chunk)
        last = os.fstat(fd)
        require((first.st_dev, first.st_ino, first.st_size,
                 first.st_mtime_ns, first.st_ctime_ns) ==
                (last.st_dev, last.st_ino, last.st_size,
                 last.st_mtime_ns, last.st_ctime_ns),
                'Private evidence mutated during read')
        return bytes(buf)
    finally:
        os.close(fd)


def _import(filename, alias):
    path = Path(__file__).resolve().with_name(filename)
    spec = importlib.util.spec_from_file_location(alias, path)
    require(spec is not None and spec.loader is not None,
            'Offline M3M verification dependency unavailable')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _parse_manifest(raw, pin):
    require(type(pin) is str and HEX.fullmatch(pin) is not None,
            'Externally archived canonical manifest SHA256 required')
    content = _read_private(raw, MAX_MANIFEST)
    require(_sha(content) == pin,
            'Private cohort manifest differs from separately held digest')
    try:
        obj = json.loads(content.decode('utf-8'), object_pairs_hook=_pairs,
                         parse_constant=_nonfinite)
    except (ValueError, UnicodeError, TypeError) as exc:
        raise CohortMatrixError('Untrusted cohort manifest JSON') from exc
    require(type(obj) is dict and _canonical(obj) == content and
            set(obj) == {'schema', 'classification', 'cases',
                         'scientificApprovalClaim', 'firmwareAttestedClaim'} and
            obj['schema'] == SCHEMA and
            obj['classification'] ==
            'private-operator-declared-cohorts-not-manufacturer-attested' and
            obj['scientificApprovalClaim'] is False and
            obj['firmwareAttestedClaim'] is False,
            'Cohort JSON schema, flags or canonicalization invalid')
    cases = obj['cases']
    require(type(cases) is list and 2 <= len(cases) <= MAX_CASES,
            'Two to six explicit captures required')
    firmware_labels, firmware_digests, source_digests = [], [], []
    for index, item in enumerate(cases):
        require(type(item) is dict and set(item) ==
                {'slot', 'declaredFirmware', 'firmwareEvidenceFile',
                 'firmwareEvidenceSha256', 'firmwareEvidenceBytes',
                 'tiffs', 'sourceReceipt', 'sourceReceiptSha256',
                 'evidenceDir', 'evidenceManifestSha256'},
                'Unknown or missing cohort case fields')
        require(item['slot'] == chr(ord('A') + index),
                'Cohort slots must be A..F in declaration order')
        firmware = item['declaredFirmware']
        require(type(firmware) is str and
                FIRMWARE_LABEL.fullmatch(firmware) is not None,
                'Invalid private operator firmware label')
        firmware_labels.append(firmware)
        for key in ('firmwareEvidenceSha256', 'sourceReceiptSha256',
                    'evidenceManifestSha256'):
            require(type(item[key]) is str and
                    HEX.fullmatch(item[key]) is not None,
                    'Missing externally archived source/evidence SHA256')
        require(type(item['firmwareEvidenceBytes']) is int and
                1 <= item['firmwareEvidenceBytes'] <= MAX_FIRMWARE_DOCUMENT,
                'Firmware evidence file size outside bound')
        tiffs = item['tiffs']
        require(type(tiffs) is dict and set(tiffs) == set(BANDS) and
                all(type(tiffs[k]) is str and tiffs[k] for k in BANDS),
                'Exactly four explicitly labeled original TIFF paths required')
        firmware_digests.append(item['firmwareEvidenceSha256'])
        source_digests.append(item['sourceReceiptSha256'])
    require(len(set(firmware_labels)) >= 2,
            'At least two distinct operator-declared firmware labels required')
    require(len(set(firmware_digests)) == len(cases) and
            len(set(source_digests)) == len(cases),
            'Different capture cohorts must not reuse source/firmware pins')
    return cases


def _check_firmware_document(item):
    data = _read_private(item['firmwareEvidenceFile'], MAX_FIRMWARE_DOCUMENT)
    require(len(data) == item['firmwareEvidenceBytes'] and
            _sha(data) == item['firmwareEvidenceSha256'],
            'Opaque firmware document differs from pinned cohort manifest')


def _config(item):
    source = item['tiffs']
    ordered = [_safe_path(source[band]) for band in BANDS]
    require(len(set(ordered)) == 4, 'Repeated original TIFF input paths')
    return dict(tiffs=ordered,
                source_receipt=_safe_path(item['sourceReceipt'],
                                          private_parent=True),
                source_receipt_sha256=item['sourceReceiptSha256'],
                evidence_dir=_safe_path(item['evidenceDir']),
                evidence_manifest_sha256=item['evidenceManifestSha256'])


def _case_result(item):
    # Independently pinned document content is not evidence of its authorship.
    _check_firmware_document(item)
    cfg = _config(item)
    field_review = _import('m3m_private_field_review.py', '_skyhub_p36d_field')
    cohort = _import('m3m_private_xmp_cohort.py', '_skyhub_p36d_structure')
    report = field_review.review(**cfg)
    census = cohort.census(**cfg)
    require(report.get('schema') == 'skyhub-m3m-private-field-review-v1' and
            report.get('classification') ==
            'private-structural-evidence-review-not-radiometric-validation' and
            report.get('captureFirmwareVerified') is False and
            report.get('independentScienceAssessmentPerformed') is False and
            report.get('operationalUseAllowed') is False and
            report.get('sourceAndEvidencePinsRecheckedAfterXmp') is True,
            'Unexpected field-review readiness or schema')
    require(census.get('schema') ==
            'skyhub-m3m-private-xmp-structure-cohort-v1' and
            census.get('classification') ==
            'documented-marker-presence-only-no-firmware-or-radiometry' and
            census.get('originalAndEvidencePinsRecheckedBeforeAndAfter') is True and
            census.get('firmwareVersionVerified') is False and
            census.get('radiometricCalibrationVerified') is False and
            census.get('operationalUseAllowed') is False and
            census.get('rawNumbersOrMetadataReleased') is False and
            census.get('canonicalRequiredFieldMissingCounts') ==
            report.get('requiredXmpFieldMissingCounts'),
            'Structural cohort/field review inconsistent')
    known = census.get('documentedAdditionalMarkerPresenceCounts')
    unknown = census.get('unknownDjiNamespaceMarkerCountsByInputOrder')
    require(type(known) is dict and
            set(known) == set(cohort.MANUAL_FIELDS) and
            all(type(v) is int and 0 <= v <= 4 for v in known.values()) and
            type(unknown) is list and len(unknown) == 4 and
            all(type(v) is int and 0 <= v <= cohort.MAX_UNKNOWN_KEYS
                for v in unknown),
            'Unexpected cohort field-counter shapes')
    present = report.get('evidencePresentButUnvalidated')
    missing = report.get('evidenceMissing')
    require(type(present) is list and type(missing) is list and
            set(present + missing) == set(KIND_KEYS) and
            len(set(present + missing)) == len(KIND_KEYS),
            'Invalid evidence-category inventory')
    _check_firmware_document(item)
    return {
        'slot': item['slot'],
        'reviewState': report['reviewState'],
        'documentedExtraFieldCounts': {key: known[key] for key in cohort.MANUAL_FIELDS},
        'requiredFieldMissingCounts': report['requiredXmpFieldMissingCounts'],
        'evidencePresentButUnvalidated': [k for k in KIND_KEYS if k in present],
        'evidenceMissing': [k for k in KIND_KEYS if k in missing],
        'unknownDjiMarkerTotal': sum(unknown),
        'firmwareEvidenceBytesMatchPinnedManifest': True,
        'originalAndFieldEvidenceReverified': True,
    }


def matrix(*, manifest_file, manifest_sha256):
    cases = _parse_manifest(manifest_file, manifest_sha256)
    results = [_case_result(item) for item in cases]
    pairs = []
    for left_i in range(len(results)):
        for right_i in range(left_i + 1, len(results)):
            left, right = results[left_i], results[right_i]
            pairs.append({
                'fromSlot': left['slot'],
                'toSlot': right['slot'],
                'documentedAdditionalMarkerCountDelta': {
                    key: right['documentedExtraFieldCounts'][key] -
                    left['documentedExtraFieldCounts'][key]
                    for key in left['documentedExtraFieldCounts']
                },
                'requiredFieldMissingCountDelta': {
                    key: right['requiredFieldMissingCounts'][key] -
                    left['requiredFieldMissingCounts'][key]
                    for key in left['requiredFieldMissingCounts']
                },
                'unknownDjiMarkerTotalDelta':
                    right['unknownDjiMarkerTotal'] - left['unknownDjiMarkerTotal'],
                'evidenceCategoryCountDelta':
                    len(right['evidencePresentButUnvalidated']) -
                    len(left['evidencePresentButUnvalidated']),
                'numericalRadiometricDeviationComputed': False,
            })
    # A later case must not be able to mutate an earlier capture unnoticed.
    # Re-run ALL independent original/evidence/P1/XMP/firmware gates and compare
    # exact structural summaries before publishing any cross-capture matrix.
    require([_case_result(case) for case in cases] == results,
            'One of the capture/firmware evidence inputs changed during comparison')
    # Recheck the signed-by-none but externally pinned manifest at the end.
    require(_parse_manifest(manifest_file, manifest_sha256) == cases,
            'Cohort manifest was changed during multi-capture comparison')
    return {
        'schema': REPORT_SCHEMA,
        'classification':
            'private-operator-firmware-cohort-structural-deviations-only',
        'captureCount': len(results),
        'distinctOperatorFirmwareLabels': len(
            {case['declaredFirmware'] for case in cases}),
        'separateOriginalCaptureAndFirmwareEvidencePins': True,
        'cohorts': results,
        'pairwiseStructuralDeltas': pairs,
        'cohortManifestRecheckedAfterAllCaptureAudits': True,
        'firmwareLabelsReleased': False,
        'firmwareEvidenceContentsReleased': False,
        'rawXmpOrCoordinatesReleased': False,
        'quantitativeRadiometricDeviationComputed': False,
        **{name: False for name in SAFETY_FLAGS},
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest-file', type=Path, required=True)
    parser.add_argument('--manifest-sha256', required=True)
    a = parser.parse_args(argv)
    try:
        result = matrix(manifest_file=a.manifest_file,
                        manifest_sha256=a.manifest_sha256)
        print(json.dumps(result, sort_keys=True, allow_nan=False))
        return 0
    except Exception as exc:
        print('Private M3M firmware cohort matrix refused: ' +
              type(exc).__name__, file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
