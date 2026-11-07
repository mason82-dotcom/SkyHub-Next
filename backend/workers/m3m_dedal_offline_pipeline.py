#!/usr/bin/env python3
"""Offline-only M3M ODM orthomosaic -> reflectance -> index pipeline.

No DEDAL installation or execution. Caller supplies an already externally
calibrated 5-band ODM GeoTIFF and its independently recorded SHA-256.
Calibration claims are never elevated to operational readiness.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile

SHA256 = re.compile(r'^[a-fA-F0-9]{64}$')
MAX_ORTHO_BYTES = 100 * 1024 * 1024 * 1024
EXPECTED_BANDS = ('red', 'green', 'red_edge', 'nir')
EXPECTED_INDICES = ('ndvi', 'ndre', 'gndvi', 'osavi')
REQUIRED_FALSE_FLAGS = ('operationalUseAllowed', 'reflectanceReady', 'ndviReady', 'ndreReady')
_CHUNK = 1024 * 1024


class PipelineError(ValueError):
    """An experimental pipeline input or subworker output was rejected."""


def _load_worker(module_name: str):
    """Load only a code-reviewed SkyHub sibling file, never DEDAL package code."""
    src = Path(__file__).resolve().with_name(module_name + '.py')
    spec = importlib.util.spec_from_file_location('_skyhub_' + module_name, src)
    if spec is None or spec.loader is None:
        raise PipelineError('Expected bundled local SkyHub worker is unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _input_identity(path: Path):
    if path.is_symlink() or path.suffix.lower() not in ('.tif', '.tiff'):
        raise PipelineError('Orthomosaic must be an ordinary direct local TIFF')
    s = path.stat()
    if not stat.S_ISREG(s.st_mode) or not 16 <= s.st_size <= MAX_ORTHO_BYTES:
        raise PipelineError('Invalid or oversized orthomosaic')
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns)


def _hash_input(path: Path):
    identity = _input_identity(path)
    h = hashlib.sha256()
    total = 0
    with path.open('rb') as f:
        while data := f.read(_CHUNK):
            total += len(data)
            if total > MAX_ORTHO_BYTES:
                raise PipelineError('Orthomosaic exceeds input limit')
            h.update(data)
    if total != identity[2] or _input_identity(path) != identity:
        raise PipelineError('Orthomosaic changed while hashing')
    return h.hexdigest(), identity


def _validate_stage_report(report, *, stage):
    if not isinstance(report, dict):
        raise PipelineError('Missing derived-raster report')
    schema = ('skyhub-m3m-dedal-ortho-handoff-v1' if stage == 'handoff'
              else 'skyhub-m3m-experimental-index-raster-v1')
    if report.get('schema') != schema:
        raise PipelineError('Unexpected derived-raster report schema')
    if any(report.get(flag) is not False for flag in REQUIRED_FALSE_FLAGS):
        raise PipelineError('Subworker attempts to elevate readiness')
    outputs = report.get('outputs')
    if not isinstance(outputs, dict) or set(outputs) != set(EXPECTED_BANDS if stage == 'handoff' else EXPECTED_INDICES):
        raise PipelineError('Incorrect derived-raster outputs')
    if any(type(v.get('validPixels')) is not int or v['validPixels'] <= 0 for v in outputs.values()):
        raise PipelineError('Derived output has no usable signal')


def run_pipeline(*, orthophoto: Path, expected_sha256: str, output_dir: Path,
                 calibration_status: str, allow_flagged: bool = False) -> dict:
    """Publish complete outputs together or remove all temporary products.

    SHA pin identifies bytes (not calibration authenticity). Source TOCTOU is
    mitigated by checking the whole file before and after the two stages.
    """
    if not isinstance(expected_sha256, str) or SHA256.fullmatch(expected_sha256) is None:
        raise PipelineError('Expected SHA256 must be 64 hexadecimal characters')
    if calibration_status not in ('accepted', 'flagged', 'not_calibrated'):
        raise PipelineError('Unknown operator-claimed DEDAL status')
    if calibration_status == 'not_calibrated' or (calibration_status == 'flagged' and not allow_flagged):
        raise PipelineError('External calibration status not suitable even for PoC')
    if type(allow_flagged) is not bool:
        raise PipelineError('Explicit flagged opt-in must be boolean')

    orthophoto = Path(orthophoto).expanduser().absolute()
    source_sha, source_identity = _hash_input(orthophoto)
    if source_sha != expected_sha256.lower():
        raise PipelineError('Input orthomosaic does not match operator-supplied pin')
    output_dir = Path(output_dir).expanduser().absolute()
    if os.path.lexists(output_dir) or not output_dir.parent.is_dir():
        raise PipelineError('Destination must be new, with an existing parent')
    if output_dir.parent.is_symlink():
        raise PipelineError('Output parent must not be a symlink')
    handoff = _load_worker('m3m_dedal_ortho_handoff')
    indices = _load_worker('m3m_reflectance_indices')
    stage = Path(tempfile.mkdtemp(dir=output_dir.parent, prefix='.skyhub-m3m-pipeline-'))
    try:
        fraction_dir = stage / 'reflectance'
        index_dir = stage / 'indices'
        first = handoff.convert_orthophoto(orthophoto, fraction_dir,
                                          calibration_status=calibration_status,
                                          allow_flagged=allow_flagged)
        _validate_stage_report(first, stage='handoff')
        second = indices.produce(*(fraction_dir / (band + '.tif') for band in EXPECTED_BANDS), index_dir)
        _validate_stage_report(second, stage='indices')

        # Require physical products and bounded, non-empty regular files.
        for directory, names in ((fraction_dir, EXPECTED_BANDS), (index_dir, EXPECTED_INDICES)):
            for name in names:
                file = directory / (name + '.tif')
                if file.is_symlink() or not file.is_file() or file.stat().st_size < 16:
                    raise PipelineError('Stage omitted a derived GeoTIFF')

        after_sha, after_identity = _hash_input(orthophoto)
        if after_sha != source_sha or after_identity != source_identity:
            raise PipelineError('Input orthomosaic changed during processing')

        result = {
            'schema': 'skyhub-m3m-offline-orthomosaic-index-bundle-v1',
            'classification': 'operator-claimed-external-calibration-experimental',
            'sourceSha256MatchesOperatorPin': True,
            'sourceRetainedDuringRun': True,
            'externalCalibrationStatusClaim': calibration_status,
            'captureAndPanelProvenanceVerified': False,
            'dedalExecutedBySkyHub': False,
            'radiometricCalibrationVerified': False,
            'bandCoregistrationVerified': False,
            'reflectanceReady': False,
            'ndviReady': False,
            'ndreReady': False,
            'operationalUseAllowed': False,
            'stageSchemas': [first['schema'], second['schema']],
            'reflectanceValidPixels': {k: first['outputs'][k]['validPixels'] for k in EXPECTED_BANDS},
            'indicesValidPixels': {k: second['outputs'][k]['validPixels'] for k in EXPECTED_INDICES},
            'outputs': {'reflectance': 'reflectance/', 'indices': 'indices/'},
            'warning': 'Synthetic or operator-provided ODM data; unverified calibration and no agronomic approval.',
        }
        (stage / 'bundle-report.json').write_text(json.dumps(result, sort_keys=True, indent=2) + '\n',
                                                   encoding='utf-8')
        # Independently decode and verify eight output rasters, their common
        # grid/masks, index equations and every published count/statistic.
        # Any verification failure cleans the temporary bundle before publish.
        qa = _load_worker('m3m_raster_bundle_verify').verify_bundle(stage)
        if (qa.get('pixelFormulaAndMaskChecksPassed') is not True
            or qa.get('allGridMetadataMatched') is not True
            or qa.get('operationalUseAllowed') is not False):
            raise PipelineError('Independent raster QA failed')
        result['independentRasterQaPassed'] = True
        (stage / 'bundle-report.json').write_text(json.dumps(result, sort_keys=True, indent=2) + '\n',
                                                   encoding='utf-8')
        if os.path.lexists(output_dir):
            raise PipelineError('Destination appeared during processing')
        os.rename(stage, output_dir)
    except BaseException:
        shutil.rmtree(stage, ignore_errors=True)
        raise
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--orthophoto', required=True, type=Path)
    parser.add_argument('--orthophoto-sha256', required=True)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--calibration-status', choices=('accepted', 'flagged', 'not_calibrated'),
                        required=True)
    parser.add_argument('--allow-flagged', action='store_true')
    args = parser.parse_args(argv)
    try:
        result = run_pipeline(orthophoto=args.orthophoto, expected_sha256=args.orthophoto_sha256,
                              output_dir=args.output_dir, calibration_status=args.calibration_status,
                              allow_flagged=args.allow_flagged)
    except Exception as exc:
        # Keep local source paths, capture IDs, GDAL exception detail out of CLI output.
        print('Offline M3M pipeline refused: ' + type(exc).__name__, file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
