#!/usr/bin/env python3
"""P3.5b private panel-ROI consistency checks on pinned experimental M3M raster.

The panel geometries and reflectance values are operator-supplied, not
authenticated laboratory measurements. This tool NEVER calibrates or approves
reflectance data; no writes, network calls, HTTP endpoints or DJI control.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import stat
import sys

BANDS = ('red', 'green', 'red_edge', 'nir')
SCHEMA = 'skyhub-m3m-private-panel-observations-v1'
HEX = re.compile(r'[0-9a-f]{64}\Z')
MAX_MANIFEST_BYTES = 64 * 1024
MAX_SAMPLES = 4
MIN_SAMPLES = 2
MAX_TOTAL_SAMPLE_PIXELS = 250_000
NODATA = -9999.0


class PanelEvidenceError(ValueError):
    """Panel evidence does not meet the private experimental agreement contract."""


def require(ok, reason):
    if not ok:
        raise PanelEvidenceError(reason)


def _load(filename, alias):
    file = Path(__file__).resolve().with_name(filename)
    spec = importlib.util.spec_from_file_location(alias, file)
    require(spec is not None and spec.loader is not None,
            'Offline GIS verification dependency unavailable')
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate panel evidence JSON field')
        result[key] = value
    return result


def _constant(_):
    raise PanelEvidenceError('Nonfinite panel evidence values prohibited')


def _read_private(path):
    require(not path.is_symlink() and not path.parent.is_symlink() and
            path.parent.is_dir() and (path.parent.stat().st_mode & 0o077) == 0,
            'Panel manifest must be within a private direct directory')
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
                2 <= before.st_size <= MAX_MANIFEST_BYTES,
                'Private panel manifest size or type refused')
        buf = bytearray()
        while len(buf) < before.st_size:
            part = os.read(fd, min(8192, before.st_size - len(buf)))
            require(bool(part), 'Private panel manifest was truncated')
            buf.extend(part)
        after = os.fstat(fd)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
                 before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns,
                 after.st_ctime_ns), 'Private panel manifest modified during read')
        payload = bytes(buf)
    finally:
        os.close(fd)
    return payload, hashlib.sha256(payload).hexdigest()


def _parse_manifest(raw, gis):
    try:
        data = json.loads(raw.decode('utf-8'), object_pairs_hook=_pairs,
                          parse_constant=_constant)
    except (ValueError, UnicodeError) as exc:
        raise PanelEvidenceError('Invalid panel manifest encoding') from exc
    # Require one canonical byte representation; a re-pinned noncanonical
    # manifest is still invalid and must not bypass the documented contract.
    try:
        canonical = (json.dumps(data, sort_keys=True, separators=(',', ':'),
                                allow_nan=False) + '\n').encode('utf-8')
    except (TypeError, ValueError) as exc:
        raise PanelEvidenceError('Invalid panel manifest values') from exc
    require(raw == canonical, 'Panel evidence requires canonical JSON')
    require(isinstance(data, dict) and set(data) == {
        'schema', 'classification', 'samples',
        'captureProvenanceVerified', 'panelInstrumentTraceabilityVerified',
        'radiometricCalibrationVerified', 'operationalUseAllowed'
    }, 'Unexpected private panel evidence schema')
    require(data['schema'] == SCHEMA and
            data['classification'] ==
            'operator-supplied-panel-measurements-unverified-independent-provenance' and
            data['captureProvenanceVerified'] is False and
            data['panelInstrumentTraceabilityVerified'] is False and
            data['radiometricCalibrationVerified'] is False and
            data['operationalUseAllowed'] is False,
            'Panel evidence must not claim authenticity or calibration')
    samples = data['samples']
    require(isinstance(samples, list) and
            MIN_SAMPLES <= len(samples) <= MAX_SAMPLES,
            'At least two and at most four separate panel observations required')
    seen_ids = set()
    result = []
    for item in samples:
        require(isinstance(item, dict) and set(item) == {
            'panelId', 'geometry', 'operatorReferenceReflectance',
            'operatorAbsoluteUncertainty'
        }, 'Incomplete or ambiguous panel observation')
        ident = item['panelId']
        require(isinstance(ident, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,32}', ident)
                and ident not in seen_ids, 'Panel identities must be distinct')
        seen_ids.add(ident)
        geometry = gis._validate_geometry(item['geometry'])
        require(geometry['type'] == 'Polygon',
                'Each panel observation must cover a closed polygon')
        for field, bound in (('operatorReferenceReflectance', (0, 1)),
                             ('operatorAbsoluteUncertainty', (0.001, 0.25))):
            values = item[field]
            require(isinstance(values, dict) and set(values) == set(BANDS),
                    'Exactly four panel band fractions required')
            for name in BANDS:
                value = values[name]
                require(type(value) in (float, int) and math.isfinite(value) and
                        bound[0] <= value <= bound[1],
                        'Invalid operator-supplied panel band fraction/uncertainty')
        result.append(item | {'geometry': geometry})
    return result


def audit(*, bundle: Path, seal: Path, seal_sha256: str,
          panels_file: Path, panels_sha256: str):
    require(isinstance(seal_sha256, str) and HEX.fullmatch(seal_sha256) and
            isinstance(panels_sha256, str) and HEX.fullmatch(panels_sha256),
            'Both bundle and panel manifest pins must be independently supplied')
    root = Path(bundle).expanduser().absolute()
    receipt = Path(seal).expanduser().absolute()
    panels_path = Path(panels_file).expanduser().absolute()
    require(not root.is_symlink() and root.is_dir() and
            not receipt.is_symlink() and
            root not in panels_path.parents and root != panels_path.parent and
            panels_path != receipt,
            'Source and sensitive panel evidence must be separate files')
    # Disallow aliases through ancestor symlinks as well as symlink leaves.
    # This static precheck is not a full openat-based race-proof sandbox.
    for candidate in (root, receipt, panels_path):
        require(candidate.resolve(strict=True) == candidate,
                'Noncanonical or symlinked private input path')
    gis = _load('m3m_private_gis_query.py', '_skyhub_panel_gis')
    verifier = _load('m3m_raster_bundle_seal.py', '_skyhub_panel_seal')
    def source_check():
        qa = verifier.verify_seal(root, receipt, seal_sha256)
        require(qa.get('filesMatched') == 11 and
                qa.get('pixelQaRechecked') is True and
                qa.get('sha256OfSeal') == seal_sha256 and
                qa.get('calibrationVerified') is False and
                qa.get('operationalUseAllowed') is False,
                'Source is not an independently pinned experimental bundle')
    def panel_check():
        payload, hash_value = _read_private(panels_path)
        require(hash_value == panels_sha256, 'Independent panel evidence pin mismatch')
        return payload
    source_check()
    samples = _parse_manifest(panel_check(), gis)
    try:
        import numpy as np
        import rasterio
    except ImportError as exc:
        raise PanelEvidenceError('Isolated NumPy and Rasterio wheels required') from exc
    seen_pixels = set()
    summary = {name: {'comparedPanels': 0, 'samplePixels': 0,
                      'sumSignedDeviation': 0.0, 'sumAbsDeviation': 0.0,
                      'maxAbsoluteDeviation': 0.0,
                      'samplesWithinOperatorUncertainty': 0}
               for name in BANDS}
    with rasterio.Env(GDAL_PAM_ENABLED='NO', GDAL_DISABLE_READDIR_ON_OPEN='YES',
                      PROJ_NETWORK='OFF'):
        with ExitStack() as stack:
            sources = {}
            for name in BANDS:
                file = root / 'reflectance' / (name + '.tif')
                require(not file.is_symlink() and file.is_file(),
                        'Direct source band required')
                sources[name] = stack.enter_context(rasterio.open(file))
            base = sources['red']
            require(base.driver == 'GTiff' and base.crs is not None and
                    base.count == 1 and base.dtypes[0] == 'float32' and
                    base.nodata == NODATA, 'Expected bounded source georeference')
            for ds in sources.values():
                require(ds.driver == 'GTiff' and ds.crs == base.crs and
                        ds.transform == base.transform and ds.width == base.width and
                        ds.height == base.height and ds.count == 1 and
                        ds.dtypes[0] == 'float32' and ds.nodata == NODATA,
                        'Source bands are not coregistered on same numeric grid')
            for sample in samples:
                window, inside, covered = gis._window_for_geometry(
                    rasterio, base, sample['geometry'])
                require(inside is not None and covered >= 1,
                        'Panel polygon must cover actual pixel centers')
                # Reject overlapping pixels: reusing one measurement as many
                # panels can create spurious evidence of repeatability.
                ys, xs = np.nonzero(inside)
                points = {(int(window.row_off)+int(y), int(window.col_off)+int(x))
                          for y, x in zip(ys, xs)}
                require(not seen_pixels.intersection(points),
                        'Panel footprints overlap on the source raster grid')
                seen_pixels.update(points)
                require(len(seen_pixels) <= MAX_TOTAL_SAMPLE_PIXELS,
                        'Panel queries exceed private pixel budget')
                for name, ds in sources.items():
                    pixels = ds.read(1, window=window, masked=True)
                    values = np.asarray(pixels.data, dtype=np.float64)
                    valid = inside & ~np.ma.getmaskarray(pixels) & np.isfinite(values)
                    selected = values[valid]
                    require(selected.size >= 1 and
                            np.all((selected >= 0) & (selected <= 1)),
                            'Every panel requires a valid physical band fraction')
                    observed = float(np.mean(selected))
                    supplied = sample['operatorReferenceReflectance'][name]
                    delta = observed - supplied
                    item = summary[name]
                    item['comparedPanels'] += 1
                    item['samplePixels'] += int(selected.size)
                    item['sumSignedDeviation'] += delta
                    item['sumAbsDeviation'] += abs(delta)
                    item['maxAbsoluteDeviation'] = max(
                        item['maxAbsoluteDeviation'], abs(delta))
                    if abs(delta) <= sample['operatorAbsoluteUncertainty'][name]:
                        item['samplesWithinOperatorUncertainty'] += 1
    # Validate all evidence and source again, after actual raster reads.
    require(hashlib.sha256(panel_check()).hexdigest() == panels_sha256,
            'Panel evidence changed while sampling')
    source_check()
    safe = {}
    for name, value in summary.items():
        n = value['comparedPanels']
        require(n == len(samples), 'Incomplete band/panel comparisons')
        safe[name] = {
            'panelCount': n,
            'samplePixels': value['samplePixels'],
            'meanSignedDeviation': value['sumSignedDeviation'] / n,
            'meanAbsoluteDeviation': value['sumAbsDeviation'] / n,
            'maxAbsoluteDeviation': value['maxAbsoluteDeviation'],
            'withinOperatorUncertaintyCount': value['samplesWithinOperatorUncertainty'],
        }
    return {
        'schema': 'skyhub-m3m-private-panel-consistency-v1',
        'classification': 'operator-claimed-reference-panel-consistency-only',
        'panelCount': len(samples),
        'uniqueCoveredPixels': len(seen_pixels),
        'bands': safe,
        'allPanelsWithinOperatorProvidedUncertainty': all(
            item['withinOperatorUncertaintyCount'] == len(samples)
            for item in safe.values()),
        'sourceBundleQaRecheckedAfterRead': True,
        'panelEvidenceSha256RecheckedAfterRead': True,
        'panelInstrumentTraceabilityVerified': False,
        'independentPanelMeasurementsVerified': False,
        'radiometricCalibrationVerified': False,
        'captureProvenanceVerified': False,
        'bandCoregistrationVerified': False,
        'reflectanceReady': False,
        'ndviReady': False,
        'ndreReady': False,
        'operationalUseAllowed': False,
        'prescriptionExportAllowed': False,
        'flightMissionAllowed': False
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--seal', type=Path, required=True)
    parser.add_argument('--seal-sha256', required=True)
    parser.add_argument('--panels-file', type=Path, required=True)
    parser.add_argument('--panels-sha256', required=True)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(audit(bundle=args.bundle, seal=args.seal,
                               seal_sha256=args.seal_sha256,
                               panels_file=args.panels_file,
                               panels_sha256=args.panels_sha256),
                         sort_keys=True, allow_nan=False))
    except Exception as exc:
        print('M3M private panel QA refused: ' + type(exc).__name__,
              file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
