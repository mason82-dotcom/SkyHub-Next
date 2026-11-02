#!/usr/bin/env python3
"""P3.6b bounded private Mavic 3M radiometric XMP marker inventory.

Only audits documented DJI XMP fields in four already P1-pinned UINT16 TIFF
captures. Does NOT return raw numbers, names, UUIDs, coordinates, XMP or EXIF.
No radiometric calculation, DJI authenticity proof or operational readiness.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
from pathlib import Path
import re
import sys

DJI_NS = 'http://www.dji.com/drone-dji/1.0/'
BANDS = ('G', 'R', 'RE', 'NIR')
INDICES = {'G': 1, 'R': 2, 'RE': 3, 'NIR': 4}
REQUIRED = (
    'SensorGain',
    'ExposureTime',
    'SensorGainAdjustment',
    'Irradiance',
    'BlackLevel',
    'VignettingData',
    'SensorIndex',
)
OPTIONAL = (
    'CalibratedOpticalCenterX', 'CalibratedOpticalCenterY',
    'VignettingFlag', 'LS_status',
)
FIELDS = frozenset(REQUIRED + OPTIONAL)
FLOAT = re.compile(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\Z')
INTEGER = re.compile(r'(?:0|[1-9]\d*)\Z')
MAX_XMP = 32768
MAX_XML_NODES = 256
MAX_FIELD_CHARS = 1024


class RadiometricXmpError(ValueError):
    """XMP is missing trust anchors, ambiguous, non-finite or inconsistent."""


def need(ok, why):
    if not ok:
        raise RadiometricXmpError(why)


def _load_preflight():
    location = Path(__file__).resolve().with_name('m3m_field_evidence_preflight.py')
    spec = importlib.util.spec_from_file_location('_skyhub_p36b_field_preflight', location)
    need(spec is not None and spec.loader is not None, 'Field preflight worker unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _numbers(source, expected, *, positive=False, maximum=1e9):
    need(isinstance(source, str) and len(source) <= MAX_FIELD_CHARS, 'Invalid numeric XMP field')
    parts = [v.strip() for v in source.strip().split(',')]
    need(len(parts) == expected and all(FLOAT.fullmatch(v) is not None
                                         for v in parts), 'Invalid numeric XMP arity/format')
    values = tuple(float(v) for v in parts)
    need(all(math.isfinite(v) and abs(v) <= maximum and
             (not positive or v > 0) for v in values),
         'Nonfinite or out-of-range XMP number')
    return values


def _integer(raw, low, high):
    need(isinstance(raw, str) and INTEGER.fullmatch(raw.strip()) is not None
         and len(raw) <= 30, 'Invalid integer XMP field')
    value = int(raw.strip())
    need(low <= value <= high, 'Numeric XMP parameter outside bounded range')
    return value


def _validate(name, value, band):
    # Range checks are defensive parsing bounds, not empirical DJI calibration limits.
    if name in ('SensorGain', 'SensorGainAdjustment'):
        _numbers(value, 1, positive=True, maximum=10000)
    elif name == 'Irradiance':
        _numbers(value, 1, positive=True, maximum=1e9)
    elif name == 'ExposureTime':
        _integer(value, 1, 100000000)  # DJI guide documents microseconds.
    elif name == 'BlackLevel':
        _integer(value, 0, 65535)
    elif name == 'VignettingData':
        _numbers(value, 6, maximum=1e6)
    elif name == 'SensorIndex':
        need(_integer(value, 1, 4) == INDICES[band],
             'SensorIndex contradicts independently verified band identity')
    elif name in ('CalibratedOpticalCenterX', 'CalibratedOpticalCenterY'):
        _numbers(value, 1, maximum=1e6)
    elif name == 'VignettingFlag':
        need(_integer(value, 0, 1) == 0, 'Unexpected enabled vignette correction')
    elif name == 'LS_status':
        _integer(value, 0, 2)
    else:
        raise RadiometricXmpError('Unexpected field attempted to cross whitelist')


def _inspect_xmp(path, band):
    try:
        import tifffile
        from defusedxml import ElementTree
        with tifffile.TiffFile(path) as tiff:
            need(bool(tiff.pages), 'Missing TIFF directory')
            tag = tiff.pages[0].tags.get(700)
            if tag is None:
                return {field: False for field in (*REQUIRED, *OPTIONAL)}
            need(0 < tag.count <= MAX_XMP, 'XMP metadata length exceeds fixed limit')
            payload = tag.value
            need(isinstance(payload, bytes) and 0 < len(payload) <= MAX_XMP,
                 'TIFF XMP must be bounded bytes')
        root = ElementTree.fromstring(payload.rstrip(b'\x00'))
        seen = {}
        count = 0
        for node in root.iter():
            count += 1
            need(count <= MAX_XML_NODES and len(node.attrib) <= len(FIELDS)+20,
                 'Too many XMP XML nodes or attributes')
            for key, value in node.attrib.items():
                if key.startswith('{' + DJI_NS + '}'):
                    name = key[len(DJI_NS)+2:]
                    if name in FIELDS:
                        need(name not in seen, 'Repeated DJI XMP radiometric field')
                        seen[name] = value
            key = node.tag
            if isinstance(key, str) and key.startswith('{' + DJI_NS + '}'):
                name = key[len(DJI_NS)+2:]
                if name in FIELDS:
                    need(name not in seen, 'Repeated DJI XMP radiometric field')
                    seen[name] = node.text or ''
        for name, value in seen.items():
            _validate(name, value, band)
        return {field: field in seen for field in (*REQUIRED, *OPTIONAL)}
    except RadiometricXmpError:
        raise
    except Exception as exc:
        raise RadiometricXmpError('Invalid or undecodable private DJI XMP metadata') from exc


def inspect(*, tiffs, source_receipt, source_receipt_sha256,
            evidence_dir, evidence_manifest_sha256):
    need(isinstance(tiffs, (list, tuple)) and len(tiffs) == 4,
         'Four explicit originals required')
    cfg = dict(tiffs=tiffs, source_receipt=source_receipt,
               source_receipt_sha256=source_receipt_sha256,
               evidence_dir=evidence_dir,
               evidence_manifest_sha256=evidence_manifest_sha256)
    preflight = _load_preflight()
    try:
        original = preflight.preflight(**cfg)
    except Exception as exc:
        raise RadiometricXmpError('Source and independent evidence pins failed') from exc
    need(original.get('originalBytesMatchIndependentReceiptPin') is True and
         original.get('evidenceBytesMatchIndependentManifestPin') is True and
         original.get('sourceVerified') is False and
         original.get('radiometricCalibrationVerified') is False,
         'Source/candidate proof or readiness contradictory')
    # The preflight already constrains the 4 TIFFs; discover their *private*
    # band labels through the original metadata parser. Never print raw IDs.
    decoder = _load_preflight()._module()._audit_module()
    _, _, tifffile, element_tree, _ = decoder._libraries()
    observations = {}
    for path in tiffs:
        metadata = decoder._extract_xmp(Path(path), tifffile, element_tree)
        band = metadata['band']
        need(band in BANDS and metadata['xmpStatus'] == 'ok' and
             band not in observations, 'Ambiguous original band XMP hints')
        observations[band] = _inspect_xmp(Path(path), band)
    need(set(observations) == set(BANDS), 'Missing one of the four spectral bands')
    # Run the independently pinned original source/evidence check once more to
    # catch any mutation during radiometric metadata scanning.
    try:
        need(preflight.preflight(**cfg) == original,
             'Original TIFF or evidence changed during metadata scan')
    except RadiometricXmpError:
        raise
    except Exception as exc:
        raise RadiometricXmpError('Source/evidence changed during XMP audit') from exc

    missing = {name: sum(not observations[band][name] for band in BANDS)
               for name in REQUIRED}
    extra = {name: sum(observations[band][name] for band in BANDS)
             for name in OPTIONAL}
    return {
        'schema': 'skyhub-m3m-radiometric-xmp-inventory-v1',
        'classification': 'documented-xmp-marker-structure-only-not-calibration',
        'spectralOriginalsExamined': 4,
        'requiredFieldTypes': len(REQUIRED),
        'allRequiredFieldsPresentAndWellFormed': all(n == 0 for n in missing.values()),
        'requiredFieldMissingCounts': missing,
        'optionalFieldPresentCounts': extra,
        'sourceAndEvidencePinsReverified': True,
        'documentedUnitOfExposureTime': 'microsecond',
        'rawRadiometricNumbersReleased': False,
        'rawXmpOrCoordinatesReleased': False,
        'xmpClaimsAuthentic': False,
        'calibrationVerified': False,
        'sunlightSensorValuesValidated': False,
        'bandCoregistrationVerified': False,
        'radiometricCalibrationVerified': False,
        'reflectanceReady': False, 'ndviReady': False,
        'ndreReady': False, 'scienceReady': False,
        'operationalUseAllowed': False, 'prescriptionExportAllowed': False,
        'flightMissionAllowed': False,
    }


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--tiff', type=Path, action='append', required=True)
    p.add_argument('--source-receipt', type=Path, required=True)
    p.add_argument('--source-receipt-sha256', required=True)
    p.add_argument('--evidence-dir', type=Path, required=True)
    p.add_argument('--evidence-manifest-sha256', required=True)
    args = p.parse_args(argv)
    try:
        result = inspect(
            tiffs=args.tiff, source_receipt=args.source_receipt,
            source_receipt_sha256=args.source_receipt_sha256,
            evidence_dir=args.evidence_dir,
            evidence_manifest_sha256=args.evidence_manifest_sha256)
        print(json.dumps(result, sort_keys=True, allow_nan=False))
    except Exception as exc:
        print('Private M3M radiometric XMP inspection refused: ' +
              type(exc).__name__, file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
