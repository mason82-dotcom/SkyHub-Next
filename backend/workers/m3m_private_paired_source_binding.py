#!/usr/bin/env python3
"""P3.6f: privately bind P3.6d original TIFF evidence to P3.6e paired field plan.

Offline-only full replay. SHA-256 proves bytes against externally stored pins,
not DJI provenance, firmware origin, calibration, or measurement independence.
Never output paths, pins, exposure data, firmware text or raw XMP.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

SCHEMA = 'skyhub-m3m-private-paired-original-evidence-binding-v1'
COHORTS = ('A', 'B')
FALSE_FLAGS = (
    'sourceProvenanceVerified', 'firmwareVersionVerified',
    'operatorMeasurementsIndependentlyVerified',
    'operatorTolerancesProspectivelyRegistered',
    'manufacturerSourceAuthenticityVerified',
    'xmpMetadataClaimsScientificallyValidated',
    'sunlightSensorValuesValidated', 'panelCalibrationVerified',
    'radiometricCalibrationVerified', 'bandCoregistrationVerified',
    'reflectanceReady', 'ndviReady', 'ndreReady', 'scienceReady',
    'operationalUseAllowed', 'prescriptionExportAllowed', 'flightMissionAllowed',
)

class BindingError(ValueError):
    """Pinned TIFF and private pair plan do not form the same evidence set."""

def need(ok, why):
    if not ok:
        raise BindingError(why)

def _load(file, alias):
    path = Path(__file__).resolve().with_name(file)
    spec = importlib.util.spec_from_file_location(alias, path)
    need(spec is not None and spec.loader is not None,
         'Required local read-only verification worker unavailable')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

def _pinned_json(module, path, pin, max_bytes):
    module._pin(pin) if hasattr(module, '_pin') else module._sha(pin)
    raw = module._read_private(Path(path), max_bytes) if hasattr(module, '_pin') else module._read_private(Path(path))
    need(hashlib.sha256(raw).hexdigest() == pin,
         'Independently recorded input pin mismatch')
    try:
        out = json.loads(raw.decode('utf-8'),
                         object_pairs_hook=module._pairs if hasattr(module, '_pin')
                         else module._unique_pairs,
                         parse_constant=module._no_number if hasattr(module, '_pin')
                         else module._forbid_nonfinite)
    except (ValueError, UnicodeError, TypeError) as exc:
        raise BindingError('Malformed private manifest') from exc
    need(module._canonical(out) == raw, 'Noncanonical private manifest')
    return out

def _canonical_existing(path):
    path = Path(path)
    need(path.is_absolute() and '..' not in path.parts and '.' not in path.parts,
         'Noncanonical evidence path')
    current = path
    while True:
        need(not current.is_symlink(), 'Evidence path has symlink component')
        if current == current.parent:
            break
        current = current.parent
    need(path.resolve(strict=True) == path, 'Noncanonical evidence path')
    return path

def _actual_evidence(field, root, expected_pin):
    root = _canonical_existing(root)
    need(root.is_dir(), 'Private evidence directory is absent')
    try:
        field._validate_evidence(root, expected_pin)
        contents = field._read_file(root / 'field-evidence-manifest.json',
                                    field.MAX_MANIFEST, private=True)
    except Exception as exc:
        raise BindingError('Pinned DLS/panel asset inventory refused') from exc
    need(hashlib.sha256(contents).hexdigest() == expected_pin,
         'Evidence manifest changed during independent binding')
    data = field._parse(contents)
    need(field._canonical(data) == contents, 'Noncanonical field evidence manifest')
    assets = {a['kind']: a['sha256'] if a['provided'] else None
              for a in data['assets']}
    need(set(assets) == set(kind for kind, _ in field.KINDS),
         'Missing required field evidence category')
    return assets

def bind(*, cohort_manifest, cohort_manifest_sha256,
         pairing_plan, pairing_plan_sha256):
    d = _load('m3m_private_firmware_cohort_matrix.py', '_skyhub_p36f_d')
    e = _load('m3m_private_field_pairing_qa.py', '_skyhub_p36f_e')
    field = _load('m3m_field_evidence_preflight.py', '_skyhub_p36f_field')

    d_input = _pinned_json(d, Path(cohort_manifest), cohort_manifest_sha256,
                           d.MAX_MANIFEST)
    e_input = _pinned_json(e, Path(pairing_plan), pairing_plan_sha256,
                           e.MAX_PLAN_BYTES)
    need(isinstance(d_input, dict) and set(d_input) == d.MANIFEST_KEYS and
         d_input.get('schema') == d.SCHEMA and
         isinstance(d_input.get('cases'), list), 'Unexpected source cohort manifest')
    need(isinstance(e_input, dict) and set(e_input) == e.TOP_KEYS and
         e_input.get('schema') == e.SCHEMA and
         isinstance(e_input.get('pairs'), list), 'Unexpected field pairing manifest')

    n = len(e_input['pairs'])
    need(1 <= n <= 4 and len(d_input['cases']) == 2*n,
         'Every paired trial needs exactly two distinct original captures')

    indexed = {}
    for item in d_input['cases']:
        need(isinstance(item, dict) and set(item) == d.CASE_KEYS and
             item['cohort'] in COHORTS,
             'Unexpected private capture schema')
        src = item['sourceReceiptSha256']
        need(isinstance(src, str) and src not in indexed,
             'Duplicate capture pin in TIFF cohort manifest')
        indexed[src] = item

    used = set()
    dls_pairs_present = 0
    panel_pairs_present = 0
    for trial in e_input['pairs']:
        need(isinstance(trial, dict) and set(trial) == e.PAIR_KEYS,
             'Unexpected paired trial')
        seen_dls = True
        seen_panel = True
        for cohort in COHORTS:
            declared = trial[cohort]
            need(isinstance(declared, dict) and set(declared) == e.SIDE_KEYS,
                 'Unexpected private observation fields')
            source_pin = declared['sourceReceiptSha256']
            need(source_pin in indexed and source_pin not in used,
                 'Unbound or duplicate source capture')
            used.add(source_pin)
            item = indexed[source_pin]
            need(item['cohort'] == cohort and
                 item['firmwareEvidenceSha256'] == declared['firmwareEvidenceSha256'],
                 'Source assigned to wrong cohort or wrong pinned firmware file')
            verified = _actual_evidence(field, item['evidenceDir'],
                                        item['evidenceManifestSha256'])
            # P3.6e's DLS/panel declarations must refer to the actual opaque
            # files in P3.6a's byte-reverified manifest, or both be absent.
            need(declared['dlsEvidenceSha256'] == verified['sunlightSensor'] and
                 declared['panelEvidenceSha256'] == verified['panelImage'],
                 'Field plan DLS/panel claims conflict with pinned actual assets')
            seen_dls &= verified['sunlightSensor'] is not None
            seen_panel &= verified['panelImage'] is not None
        dls_pairs_present += int(seen_dls)
        panel_pairs_present += int(seen_panel)
    need(len(used) == len(indexed), 'Extra unpaired original capture')

    # Full replay of both upstream audits; no success from hash matching alone.
    try:
        actual_d = d.compare(manifest=Path(cohort_manifest),
                             manifest_sha256=cohort_manifest_sha256)
        actual_e = e.inspect(plan=Path(pairing_plan),
                             plan_sha256=pairing_plan_sha256)
    except Exception as exc:
        raise BindingError('Independent original or field-plan validation refused') from exc
    need(actual_d.get('schema') == d.REPORT_SCHEMA and
         actual_d.get('originalTiffAndEvidencePinsRecheckedPerCapture') is True and
         actual_e.get('schema') == e.RESULT_SCHEMA and
         actual_e.get('privatePlanIntegrityRecheckedAfterScreening') is True,
         'Unexpected independent upstream acceptance contract')
    need(all(actual_d.get(k) is False for k in d.FALSE_FLAGS) and
         all(actual_e.get(k) is False for k in e.FALSE_FLAGS),
         'Upstream report promotes unverified scientific state')
    need(actual_d['capturesPerAnonymousCohort'] == {'A': n, 'B': n} and
         actual_e['pairedCaptureCount'] == n and
         actual_e['pairsMissingDlsEvidenceDeclaration'] == n-dls_pairs_present and
         actual_e['pairsMissingPanelEvidenceDeclaration'] == n-panel_pairs_present,
         'Independent pair count or evidence completeness differs')

    # Final pinned-byte read after the long TIFF/XMP/raster scans.
    need(hashlib.sha256(d._read_private(Path(cohort_manifest), d.MAX_MANIFEST)).hexdigest()
         == cohort_manifest_sha256 and
         hashlib.sha256(e._read_private(Path(pairing_plan))).hexdigest()
         == pairing_plan_sha256,
         'Private source/field manifest changed during full replay')

    return {
        'schema': SCHEMA,
        'classification': 'source-and-field-claims-reconciled-not-science-or-firmware-proof',
        'matchedAnonymizedPairedCaptures': n,
        'originalTiffsReplayed': 8*n,
        'pairsWithPinnedSunlightSensorFileOnBothSides': dls_pairs_present,
        'pairsWithPinnedPanelImageFileOnBothSides': panel_pairs_present,
        'pairsMatchingAllOperatorTolerances':
            actual_e['pairsMatchingAllOperatorTolerances'],
        'operatorDeclaredCovariateCounts':
            actual_e['operatorCovariateComparisonCounts'],
        'sourceReceiptAndFirmwareEvidenceHashesCrossMatched': True,
        'dlsAndPanelEvidenceHashesMatchedRealPrivateFiles': True,
        'fullP36dAndP36eReplaysSucceeded': True,
        'noAutomaticScienceApproval': True,
        'rawMetadataFirmwareNumbersOrHashesReleased': False,
        **{k: False for k in FALSE_FLAGS},
    }

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--cohort-manifest', type=Path, required=True)
    p.add_argument('--cohort-manifest-sha256', required=True)
    p.add_argument('--pairing-plan', type=Path, required=True)
    p.add_argument('--pairing-plan-sha256', required=True)
    a = p.parse_args(argv)
    try:
        result = bind(
            cohort_manifest=a.cohort_manifest,
            cohort_manifest_sha256=a.cohort_manifest_sha256,
            pairing_plan=a.pairing_plan,
            pairing_plan_sha256=a.pairing_plan_sha256)
        print(json.dumps(result, sort_keys=True, allow_nan=False))
        return 0
    except Exception as exc:
        print('Private M3M paired-source evidence binding refused: ' +
              type(exc).__name__, file=sys.stderr)
        return 2

if __name__ == '__main__':
    raise SystemExit(main())
