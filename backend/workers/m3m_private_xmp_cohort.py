#!/usr/bin/env python3
"""P3.6c private Mavic 3M XMP *structure* cohort probe, never firmware attestation.

Reuses P3.6b's complete original-TIFF/P1/evidence pin verification twice.
Counts only allowlisted manufacturer-manual field PRESENCE (never values),
known overlap and unknown DJI namespace marker counts. Neither profiles nor
presence counts prove a firmware version, camera origin, or calibration.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import sys

DJI_NS = 'http://www.dji.com/drone-dji/1.0/'
BASE_FIELDS = ('BandName', 'ImageSource', 'CaptureUUID', 'CaptureUuid')
# Names present in DJI Mavic 3M User Manual v1.8 (2024) metadata table.
# NOT aliases; neither units nor applicability of these values are inferred.
MANUAL_FIELDS = (
    'BlackCurrent',
    'CentralWavelength',
    'IrradianceExposureTime',
    'IrradianceGain',
    'PrincipalPoint',
    'RawData',
    'SunSensor',
    'SunSensorExposureTime',
    'SunSensorYaw',
    'SunSensorPitch',
    'SunSensorRoll',
    'VignettingCenter',
    'VignettingPolynomial',
    'WavelengthFWHM',
)
BANDS = ('G', 'R', 'RE', 'NIR')
MAX_XMP = 32768
MAX_NODES = 256
MAX_ATTRIBUTES = 40
MAX_UNKNOWN_KEYS = 64
LAB_SCHEMA = 'skyhub-m3m-private-xmp-structure-cohort-v1'
LAB_CLASSIFICATION = 'documented-marker-presence-only-no-firmware-or-radiometry'

class CohortError(ValueError):
    """Untrusted source, ambiguous marker, or invalid bounded XMP."""

def require(ok, message):
    if not ok:
        raise CohortError(message)

def _module():
    path = Path(__file__).resolve().with_name('m3m_radiometric_xmp_inventory.py')
    spec = importlib.util.spec_from_file_location('_skyhub_p36c_radiometric_inventory', path)
    require(spec is not None and spec.loader is not None,
            'Private radiometric preflight unavailable')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def _probe_tiff(path: Path, known_fields):
    """Only key presence, never any XMP value; bounded TIFF tag 700 only."""
    try:
        import tifffile
        from defusedxml import ElementTree
        require(path.resolve(strict=True) == path.absolute() and
                not path.is_symlink(), 'Noncanonical or symlinked TIFF refused')
        with tifffile.TiffFile(path) as tiff:
            require(bool(tiff.pages), 'Missing first image directory')
            tag = tiff.pages[0].tags.get(700)
            if tag is None:
                return set(), 0
            require(0 < tag.count <= MAX_XMP, 'XMP tag outside fixed bound')
            payload = tag.value
            require(isinstance(payload, bytes) and 0 < len(payload) <= MAX_XMP,
                    'XMP data not bounded bytes')
        root = ElementTree.fromstring(payload.rstrip(b'\x00'))
        seen = set()
        unknown = set()
        nodes = 0
        for node in root.iter():
            nodes += 1
            require(nodes <= MAX_NODES and len(node.attrib) <= MAX_ATTRIBUTES,
                    'Excessive XMP nodes or attributes')
            tags = [node.tag, *node.attrib.keys()]
            for tagname in tags:
                if not isinstance(tagname, str) or not tagname.startswith('{' + DJI_NS + '}'):
                    continue
                name = tagname[len(DJI_NS)+2:]
                if name in known_fields:
                    require(name not in seen, 'Repeated documented XMP field')
                    seen.add(name)
                elif name not in BASE_FIELDS:
                    unknown.add(name)
                    require(len(unknown) <= MAX_UNKNOWN_KEYS,
                            'Excessive unknown DJI XMP markers')
        return seen, len(unknown)
    except CohortError:
        raise
    except Exception as exc:
        # No private XML, filenames, paths, camera IDs, UUIDs in output/errors.
        raise CohortError('Unusable bounded private TIFF/XMP probe') from exc

def census(*, tiffs, source_receipt, source_receipt_sha256,
           evidence_dir, evidence_manifest_sha256):
    require(isinstance(tiffs, (list, tuple)) and len(tiffs) == 4,
            'Four explicit original TIFFs required')
    base = _module()
    cfg = dict(tiffs=tiffs, source_receipt=source_receipt,
               source_receipt_sha256=source_receipt_sha256,
               evidence_dir=evidence_dir,
               evidence_manifest_sha256=evidence_manifest_sha256)
    try:
        first = base.inspect(**cfg)
    except Exception as exc:
        raise CohortError('Original pinned capture/XMP validation refused') from exc
    require(first.get('schema') == 'skyhub-m3m-radiometric-xmp-inventory-v1' and
            first.get('sourceAndEvidencePinsReverified') is True and
            first.get('radiometricCalibrationVerified') is False and
            first.get('operationalUseAllowed') is False,
            'Unexpected upstream XMP security contract')
    known = frozenset(MANUAL_FIELDS) | base.FIELDS
    occurrences = {field: 0 for field in MANUAL_FIELDS}
    unknown_by_input = []
    overlaps = 0
    documented_count_by_input = []
    for path in tiffs:
        keys, count = _probe_tiff(Path(path).expanduser().absolute(), known)
        unknown_by_input.append(count)
        for field in MANUAL_FIELDS:
            occurrences[field] += int(field in keys)
        overlaps += int('VignettingData' in keys and 'VignettingPolynomial' in keys)
        documented_count_by_input.append(len(keys))
    require(len(unknown_by_input) == 4 and
            all(0 <= x <= len(known) for x in documented_count_by_input),
            'Missing or excessive bounded XMP set')
    try:
        require(base.inspect(**cfg) == first,
                'Inputs changed while measuring XMP key presence')
    except CohortError:
        raise
    except Exception as exc:
        raise CohortError('Reverification of original TIFF/evidence failed') from exc
    return {
        'schema': LAB_SCHEMA,
        'classification': LAB_CLASSIFICATION,
        'originalSpectralTiffCount': 4,
        'canonicalRequiredFieldsCompleteOnAllBands':
            first['allRequiredFieldsPresentAndWellFormed'],
        'canonicalRequiredFieldMissingCounts':
            first['requiredFieldMissingCounts'],
        'documentedAdditionalMarkerPresenceCounts': occurrences,
        'unknownDjiNamespaceMarkerCountsByInputOrder': unknown_by_input,
        'documentedMarkerCountsByInputOrder': documented_count_by_input,
        'canonicalVignettingAndPolynomialCooccurCount': overlaps,
        'manualReviewRequiredForCooccurringVignettingMetadata': overlaps > 0,
        'manualOnlyNoAutomaticAliases': True,
        'originalAndEvidencePinsRecheckedBeforeAndAfter': True,
        'firmwareVersionReadOrReleased': False,
        'firmwareVersionVerified': False,
        'manufacturerSourceAuthenticityVerified': False,
        'xmpMetadataClaimsScientificallyValidated': False,
        'rawNumbersOrMetadataReleased': False,
        'radiometricCalibrationVerified': False,
        'sunlightSensorValuesValidated': False,
        'bandCoregistrationVerified': False,
        'reflectanceReady': False,
        'ndviReady': False,
        'ndreReady': False,
        'scienceReady': False,
        'operationalUseAllowed': False,
        'prescriptionExportAllowed': False,
        'flightMissionAllowed': False,
    }

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--tiff', action='append', type=Path, required=True)
    p.add_argument('--source-receipt', type=Path, required=True)
    p.add_argument('--source-receipt-sha256', required=True)
    p.add_argument('--evidence-dir', type=Path, required=True)
    p.add_argument('--evidence-manifest-sha256', required=True)
    a = p.parse_args(argv)
    try:
        report = census(
            tiffs=a.tiff, source_receipt=a.source_receipt,
            source_receipt_sha256=a.source_receipt_sha256,
            evidence_dir=a.evidence_dir,
            evidence_manifest_sha256=a.evidence_manifest_sha256)
        print(json.dumps(report, sort_keys=True, allow_nan=False))
        return 0
    except Exception as exc:
        print('Private M3M XMP profile census refused: ' +
              type(exc).__name__, file=sys.stderr)
        return 2

if __name__ == '__main__':
    raise SystemExit(main())
