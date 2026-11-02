#!/usr/bin/env python3
"""P3.9: link pinned original M3M A/B captures to operator field-pair plans.

Offline, read-only, no DJI provenance, sensor calibration, firmware attestation
or science approval. Only count-level summaries may cross this boundary.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

SCHEMA = 'skyhub-m3m-private-capture-pair-linkage-v1'
FALSE_FLAGS = (
    'manufacturerFirmwareAttested', 'operatorValuesIndependentlyMeasured',
    'dlsMeasurementsVerified', 'panelMeasurementsVerified',
    'radiometricCalibrationVerified', 'bandCoregistrationVerified',
    'reflectanceReady', 'ndviReady', 'ndreReady', 'scienceReady',
    'operationalUseAllowed', 'prescriptionExportAllowed', 'flightMissionAllowed',
)


class LinkageError(ValueError):
    """The private original capture or pair-plan trust contract was not met."""


def need(value, reason):
    if not value:
        raise LinkageError(reason)


def _module(filename, alias):
    path = Path(__file__).resolve().with_name(filename)
    spec = importlib.util.spec_from_file_location(alias, path)
    need(spec is not None and spec.loader is not None,
         'Required offline module is unavailable')
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def _pinned_json(module, path, expected_hash, *, maximum=None):
    raw = (module._read_private(Path(path), maximum) if maximum is not None
           else module._read_private(Path(path)))
    need(hashlib.sha256(raw).hexdigest() == expected_hash,
         'Independently pinned private plan/manifest mismatch')
    try:
        parsed = json.loads(raw.decode('utf-8'))
    except (ValueError, UnicodeError) as exc:
        raise LinkageError('Previously verified private manifest unreadable') from exc
    need(module._canonical(parsed) == raw,
         'Previously verified private manifest is not canonical')
    return parsed, raw


def _asset_pin(case, kind, evidence_worker):
    path = Path(case['evidenceDir']) / 'field-evidence-manifest.json'
    # The parent P3.6d audit has already fully re-verified this private
    # directory, manifest, every supplied asset and the independent pin.
    # Recheck the entire evidence tree again before trusting the local schema.
    evidence_worker._validate_evidence(
        Path(case['evidenceDir']), case['evidenceManifestSha256'])
    payload = evidence_worker._read_file(
        path, evidence_worker.MAX_MANIFEST, private=True)
    need(hashlib.sha256(payload).hexdigest() ==
         case['evidenceManifestSha256'],
         'Private field evidence manifest changed')
    record = evidence_worker._parse(payload)
    need(evidence_worker._canonical(record) == payload,
         'Private field evidence manifest is noncanonical')
    items = {item['kind']: item for item in record['assets']}
    item = items[kind]
    return item['sha256'] if item['provided'] else None


def inspect(*, cohort_manifest: Path, cohort_manifest_sha256: str,
            pair_plan: Path, pair_plan_sha256: str):
    cohort = _module('m3m_private_firmware_cohort_matrix.py',
                     '_skyhub_p39_cohort')
    pairing = _module('m3m_private_field_pairing_qa.py',
                      '_skyhub_p39_pairing')
    evidence = _module('m3m_field_evidence_preflight.py',
                       '_skyhub_p39_evidence')

    try:
        # Both calls are full read-only verification passes, not merely
        # schema checks: original four-TIFF pixels, P1 source receipts,
        # operator firmware evidence and field evidence in every capture.
        captures_report = cohort.compare(
            manifest=cohort_manifest,
            manifest_sha256=cohort_manifest_sha256)
        pair_report = pairing.inspect(
            plan=pair_plan, plan_sha256=pair_plan_sha256)
        need(captures_report.get('schema') == cohort.REPORT_SCHEMA and
             captures_report.get('originalTiffAndEvidencePinsRecheckedPerCapture') is True and
             captures_report.get('firmwareVersionVerified') is False and
             captures_report.get('operationalUseAllowed') is False and
             pair_report.get('schema') == pairing.RESULT_SCHEMA and
             pair_report.get('operatorMeasurementsAreClaimsOnly') is True and
             pair_report.get('sourceProvenanceVerified') is False and
             pair_report.get('scienceReady') is False and
             pair_report.get('flightMissionAllowed') is False,
             'Upstream structural audit did not preserve science restrictions')
        cases_obj, cases_raw = _pinned_json(
            cohort, cohort_manifest, cohort_manifest_sha256,
            maximum=cohort.MAX_MANIFEST)
        pairs_obj, pairs_raw = _pinned_json(
            pairing, pair_plan, pair_plan_sha256)
        cases = cases_obj['cases']
        pairs = pairs_obj['pairs']
        need(len(cases) == 2 * len(pairs) and 1 <= len(pairs) <= 4,
             'Every A/B capture must participate in exactly one pair')
        matched = {}
        for case in cases:
            key = (case['cohort'], case['sourceReceiptSha256'])
            need(key not in matched, 'Duplicate verified capture')
            matched[key] = case

        used = set()
        for item in pairs:
            for label in ('A', 'B'):
                side = item[label]
                key = (label, side['sourceReceiptSha256'])
                need(key in matched and key not in used,
                     'Operator pairing does not match unique verified capture')
                used.add(key)
                case = matched[key]
                need(side['firmwareEvidenceSha256'] ==
                     case['firmwareEvidenceSha256'],
                     'Operator firmware declaration differs from pinned original cohort')
                need(side['dlsEvidenceSha256'] ==
                     _asset_pin(case, 'sunlightSensor', evidence),
                     'Declared DLS evidence does not match verified field assets')
                need(side['panelEvidenceSha256'] ==
                     _asset_pin(case, 'panelImage', evidence),
                     'Declared panel image does not match verified field assets')
        need(set(matched) == used,
             'Unpaired capture remained in the original TIFF cohort')

        # Rehash both independent, strict private manifests after crossmatching;
        # no promise of race-free filesystem operation without an OS sandbox.
        need(_pinned_json(cohort, cohort_manifest, cohort_manifest_sha256,
                          maximum=cohort.MAX_MANIFEST)[1] == cases_raw and
             _pinned_json(pairing, pair_plan, pair_plan_sha256)[1] == pairs_raw,
             'Private manifest changed during the full offline audit')
        for case in cases:
            evidence._validate_evidence(
                Path(case['evidenceDir']), case['evidenceManifestSha256'])
    except Exception as exc:
        # Do not surface filenames, pins, XMP, sensitive timestamps or values.
        raise LinkageError('Private M3M capture/pair evidence linkage refused') from exc

    total = len(pairs)
    return {
        'schema': SCHEMA,
        'classification': 'pinned-source-declaration-linkage-not-firmware-or-science-attestation',
        'verifiedOriginalCaptureCount': len(cases),
        'operatorDeclaredPairsBoundToOriginals': total,
        'pairsMeetingOperatorTolerances':
            pair_report['pairsMatchingAllOperatorTolerances'],
        'pairsWithAllOperatorValuesDeclared':
            pair_report['pairsWithAllCovariatesDeclared'],
        'pairsWithoutDlsDeclaration':
            pair_report['pairsMissingDlsEvidenceDeclaration'],
        'pairsWithoutPanelImageDeclaration':
            pair_report['pairsMissingPanelEvidenceDeclaration'],
        'allCaptureAndPlanPinsRecheckedAfterLinkage': True,
        'bindingCoverageComplete': True,
        'operatorPlanCompletenessOnly': (
            pair_report['pairsMatchingAllOperatorTolerances'] == total and
            pair_report['pairsWithAllCovariatesDeclared'] == total and
            pair_report['pairsMissingDlsEvidenceDeclaration'] == 0 and
            pair_report['pairsMissingPanelEvidenceDeclaration'] == 0
        ),
        'manualFirmwareAndScienceReviewRequired': True,
        'rawCaptureIdentifiersOrMeasurementsReleased': False,
        **{name: False for name in FALSE_FLAGS},
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cohort-manifest', type=Path, required=True)
    parser.add_argument('--cohort-manifest-sha256', required=True)
    parser.add_argument('--pair-plan', type=Path, required=True)
    parser.add_argument('--pair-plan-sha256', required=True)
    parser.add_argument('--require-complete-operator-plan', action='store_true',
                        help='Exit 3 if declared operator measurements or evidence are incomplete; never a science release')
    args = parser.parse_args(argv)
    try:
        report = inspect(cohort_manifest=args.cohort_manifest,
                         cohort_manifest_sha256=args.cohort_manifest_sha256,
                         pair_plan=args.pair_plan,
                         pair_plan_sha256=args.pair_plan_sha256)
    except Exception:
        print('Private M3M original capture/pair linkage refused', file=sys.stderr)
        return 2
    print(json.dumps(report, sort_keys=True, allow_nan=False))
    if args.require_complete_operator_plan and not report['operatorPlanCompletenessOnly']:
        return 3
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
