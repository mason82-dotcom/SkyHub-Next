#!/usr/bin/env python3
"""P3.7: offline private M3M TIFF/evidence/XMP review; not science approval."""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import sys

SCHEMA = 'skyhub-m3m-private-field-review-v1'
KINDS = ('sunlightSensor', 'panelImage', 'panelCertificate',
         'bandRegistration', 'independentReference')
FALSE_FLAGS = ('sourceVerified', 'djiHardwareProvenanceVerified',
               'sunlightSensorValuesValidated', 'panelCalibrationVerified',
               'independentGroundTruthVerified', 'radiometricCalibrationVerified',
               'bandCoregistrationVerified', 'reflectanceReady', 'ndviReady',
               'ndreReady', 'scienceReady', 'operationalUseAllowed',
               'prescriptionExportAllowed', 'flightMissionAllowed')


class ReviewError(ValueError):
    """Untrusted private capture or evidence failed the acceptance contract."""


def need(valid, reason):
    if not valid:
        raise ReviewError(reason)


def _load(filename, alias):
    path = Path(__file__).resolve().with_name(filename)
    spec = importlib.util.spec_from_file_location(alias, path)
    need(spec is not None and spec.loader is not None,
         'Local offline reviewer unavailable')
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def _preflight(config):
    return _load('m3m_field_evidence_preflight.py',
                 '_skyhub_p37_preflight').preflight(**config)


def _inspect_xmp(config):
    return _load('m3m_radiometric_xmp_inventory.py',
                 '_skyhub_p37_xmp').inspect(**config)


def _evidence(report):
    need(isinstance(report, dict) and
         report.get('schema') == 'skyhub-m3m-field-evidence-preflight-v1' and
         report.get('classification') ==
         'local-source-and-evidence-presence-not-scientific-validation' and
         type(report.get('originalSpectralTiffCount')) is int and
         report['originalSpectralTiffCount'] == 4 and
         type(report.get('decodedPixelCount')) is int and
         report['decodedPixelCount'] > 0 and
         report.get('allBandImageDimensionsEqual') is True and
         report.get('sameCaptureXmpHint') is True and
         report.get('originalBytesMatchIndependentReceiptPin') is True and
         report.get('evidenceBytesMatchIndependentManifestPin') is True and
         all(report.get(flag) is False for flag in FALSE_FLAGS),
         'P3.6a independent integrity or safety contract failed')
    present, missing = (report.get('evidencePresentButUnvalidated'),
                        report.get('evidenceMissing'))
    need(isinstance(present, list) and isinstance(missing, list) and
         all(type(x) is str for x in present + missing) and
         len(present) == len(set(present)) and
         len(missing) == len(set(missing)) and
         set(present).isdisjoint(missing) and
         set(present + missing) == set(KINDS) and
         type(report.get('evidenceAssetsPresent')) is int and
         report['evidenceAssetsPresent'] == len(present) and
         report.get('allEvidenceTypesSupplied') is (not missing),
         'Inconsistent private evidence category summary')
    return present, missing


def _xmp_counts(report):
    contract = _load('m3m_radiometric_xmp_inventory.py',
                     '_skyhub_p37_xmp_contract')
    required, optional = contract.REQUIRED, contract.OPTIONAL
    held = ('xmpClaimsAuthentic', 'calibrationVerified',
            'sunlightSensorValuesValidated', 'bandCoregistrationVerified',
            'radiometricCalibrationVerified', 'reflectanceReady',
            'ndviReady', 'ndreReady', 'scienceReady', 'operationalUseAllowed',
            'prescriptionExportAllowed', 'flightMissionAllowed')
    need(isinstance(report, dict) and
         report.get('schema') == 'skyhub-m3m-radiometric-xmp-inventory-v1' and
         report.get('classification') ==
         'documented-xmp-marker-structure-only-not-calibration' and
         type(report.get('spectralOriginalsExamined')) is int and
         report['spectralOriginalsExamined'] == 4 and
         type(report.get('requiredFieldTypes')) is int and
         report['requiredFieldTypes'] == len(required) and
         report.get('sourceAndEvidencePinsReverified') is True and
         report.get('rawRadiometricNumbersReleased') is False and
         report.get('rawXmpOrCoordinatesReleased') is False and
         report.get('documentedUnitOfExposureTime') == 'microsecond' and
         all(report.get(flag) is False for flag in held),
         'P3.6b structural XMP or safety contract failed')
    absent, extras = (report.get('requiredFieldMissingCounts'),
                      report.get('optionalFieldPresentCounts'))
    need(isinstance(absent, dict) and set(absent) == set(required) and
         isinstance(extras, dict) and set(extras) == set(optional) and
         all(type(x) is int and 0 <= x <= 4
             for x in (*absent.values(), *extras.values())) and
         report.get('allRequiredFieldsPresentAndWellFormed') is
         all(x == 0 for x in absent.values()),
         'Contradictory or unbounded XMP field counts')
    return ({key: absent[key] for key in required},
            {key: extras[key] for key in optional})


def review(*, tiffs, source_receipt, source_receipt_sha256,
           evidence_dir, evidence_manifest_sha256):
    cfg = dict(tiffs=tiffs, source_receipt=source_receipt,
               source_receipt_sha256=source_receipt_sha256,
               evidence_dir=evidence_dir,
               evidence_manifest_sha256=evidence_manifest_sha256)
    try:
        original = _preflight(cfg)
        present, missing = _evidence(original)
        absent_xmp, optional_xmp = _xmp_counts(_inspect_xmp(cfg))
        need(_preflight(cfg) == original,
             'Pinned input was changed after the XMP scan')
    except Exception as exc:
        raise ReviewError('Private original or evidence verification refused') from exc
    complete = not missing and all(value == 0 for value in absent_xmp.values())
    # Only an explicit allowlist leaves this module. No private input paths,
    # digest pins, raw XMP or sensor measurements can enter the report.
    return {
        'schema': SCHEMA,
        'classification': 'private-structural-evidence-review-not-radiometric-validation',
        'reviewState': ('STRUCTURAL_FIELDS_PRESENT_UNVALIDATED' if complete
                        else 'INCOMPLETE_EVIDENCE_OR_XMP_UNVALIDATED'),
        'originalSpectralTiffCount': 4,
        'sourceAndEvidencePinsRecheckedAfterXmp': True,
        'evidencePresentButUnvalidated': present,
        'evidenceMissing': missing,
        'requiredXmpFieldMissingCounts': absent_xmp,
        'optionalXmpFieldPresentCounts': optional_xmp,
        'independentScienceAssessmentPerformed': False,
        'captureFirmwareVerified': False,
        'radiometricCalibrationVerified': False,
        'panelCalibrationVerified': False,
        'sunlightSensorValuesValidated': False,
        'bandCoregistrationVerified': False,
        'reflectanceReady': False,
        'vegetationIndexReady': False,
        'operationalUseAllowed': False,
        'prescriptionExportAllowed': False,
        'flightMissionAllowed': False,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tiff', action='append', type=Path, required=True)
    parser.add_argument('--source-receipt', type=Path, required=True)
    parser.add_argument('--source-receipt-sha256', required=True)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    parser.add_argument('--evidence-manifest-sha256', required=True)
    parser.add_argument('--require-complete-structure', action='store_true',
                        help='Exit 3 for missing evidence/XMP markers; not a science readiness flag')
    args = parser.parse_args(argv)
    try:
        result = review(tiffs=args.tiff, source_receipt=args.source_receipt,
                        source_receipt_sha256=args.source_receipt_sha256,
                        evidence_dir=args.evidence_dir,
                        evidence_manifest_sha256=args.evidence_manifest_sha256)
    except Exception:
        print('M3M private field review refused', file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, allow_nan=False))
    if (args.require_complete_structure and
            result['reviewState'] != 'STRUCTURAL_FIELDS_PRESENT_UNVALIDATED'):
        return 3
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
