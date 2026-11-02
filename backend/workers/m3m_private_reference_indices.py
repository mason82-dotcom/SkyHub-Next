#!/usr/bin/env python3
"""P3.5b: private cross-pipeline vegetation index agreement against pinned reference bands.

Read-only/offline. Externally supplied reflectance TIFFs are operator-provided,
NOT independently authenticated or scientifically calibrated by this process.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import importlib.util
import json
import math
from pathlib import Path
import sys

INDICES = ('ndvi', 'ndre', 'gndvi', 'osavi')
BANDS = ('red', 'green', 'red_edge', 'nir')
NODATA = -9999.0
EPSILON = 1e-6
MAX_PIXELS = 2_000_000
WINDOW = 256

# Experimental comparison diagnostics; never equate threshold passing with
# scientific calibration, corrected radiometry or agronomic readiness.
LAB_MAE = 0.05
LAB_RMSE = 0.08
LAB_P95 = 0.15
LAB_MASK_IOU = 0.95


class IndexAgreementError(ValueError):
    """Private source/reference index comparison must fail closed."""


def require(ok, text):
    if not ok:
        raise IndexAgreementError(text)


def _reference_module():
    source = Path(__file__).resolve().with_name('m3m_private_reference_agreement.py')
    spec = importlib.util.spec_from_file_location('_skyhub_reference_parent', source)
    require(spec is not None and spec.loader is not None, 'Trusted reference verifier not found')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _verify_inputs(reference, bundle, seal, pin, ref_dir, ref_pin):
    # The independently pinned seal also re-validates all four mathematical
    # source vegetation indices, original pixel QA and the 11-file inventory.
    check = reference._module().verify_seal(bundle, seal, pin)
    require(check.get('filesMatched') == 11 and
            check.get('pixelQaRechecked') is True and
            check.get('sha256OfSeal') == pin and
            check.get('calibrationVerified') is False and
            check.get('operationalUseAllowed') is False,
            'Full source bundle pin verification failed')
    reference._check_reference(ref_dir, ref_pin)


def _reference_formulas(np, raw):
    nir, red, green, red_edge = (raw[k] for k in
                                 ('nir', 'red', 'green', 'red_edge'))
    return {
        'ndvi': (nir-red, nir+red),
        'ndre': (nir-red_edge, nir+red_edge),
        'gndvi': (nir-green, nir+green),
        'osavi': (1.16*(nir-red), nir+red+0.16)
    }


def audit(*, bundle: Path, seal: Path, seal_sha256: str,
          reference_dir: Path, reference_manifest_sha256: str) -> dict:
    source = Path(bundle).expanduser().absolute()
    receipt = Path(seal).expanduser().absolute()
    ref_dir = Path(reference_dir).expanduser().absolute()
    ref = _reference_module()

    # Verifies independent pin syntax, exact CRS, reference values and difference
    # from source bytes. In particular a byte-cloned reference cannot pass.
    bands = ref.audit(bundle=source, seal=receipt, seal_sha256=seal_sha256,
                      reference_dir=ref_dir,
                      reference_manifest_sha256=reference_manifest_sha256)
    require(bands.get('schema') == 'skyhub-m3m-private-reference-agreement-v1' and
            bands.get('radiometricCalibrationVerified') is False and
            bands.get('sourceIntegrityRecheckedBeforeAndAfter') is True and
            bands.get('referenceIntegrityRecheckedBeforeAndAfter') is True and
            bands.get('bandCoregistrationVerified') is False,
            'Untrusted source/reference comparison')
    _verify_inputs(ref, source, receipt, seal_sha256, ref_dir,
                   reference_manifest_sha256)

    try:
        import numpy as np
        import rasterio
        from rasterio.windows import Window
    except ImportError as exc:
        raise IndexAgreementError('Offline rasterio + NumPy required') from exc
    stats = {}
    with rasterio.Env(GDAL_PAM_ENABLED='NO', GDAL_DISABLE_READDIR_ON_OPEN='YES',
                      PROJ_NETWORK='OFF'):
        with ExitStack() as opened:
            ref_bands = {
                key: opened.enter_context(rasterio.open(ref_dir / (key + '.tif')))
                for key in BANDS
            }
            src_indices = {
                key: opened.enter_context(rasterio.open(source / 'indices' / (key + '.tif')))
                for key in INDICES
            }
            base = ref_bands['red']
            require(base.crs is not None and
                    0 < base.width*base.height <= MAX_PIXELS, 'Invalid reference dimensions')
            for dataset in (*ref_bands.values(), *src_indices.values()):
                require(dataset.driver == 'GTiff' and dataset.count == 1 and
                        dataset.dtypes[0] == 'float32' and dataset.nodata == NODATA and
                        dataset.crs == base.crs and
                        dataset.transform == base.transform and
                        dataset.width == base.width and dataset.height == base.height,
                        'Index/reference grids not exactly registered')
            accumulators = {
                name: {'sourceValid':0, 'referenceValid':0, 'shared':0,
                       'sum':0., 'abs':0., 'square':0., 'errors': []}
                for name in INDICES
            }
            for row in range(0, base.height, WINDOW):
                for col in range(0, base.width, WINDOW):
                    window = Window(col, row, min(WINDOW, base.width-col),
                                    min(WINDOW, base.height-row))
                    raw = {name: ds.read(1, window=window).astype(np.float64)
                           for name, ds in ref_bands.items()}
                    common = None
                    for values in raw.values():
                        require(np.isfinite(values).all(), 'Nonfinite reference TIFF')
                        mask = values != NODATA
                        require(not np.any((values[mask] < 0) | (values[mask] > 1)),
                                'Reference reflectance out of physically plausible range')
                        common = mask.copy() if common is None else common & mask
                    for name, (numerator, denominator) in _reference_formulas(np, raw).items():
                        source_index = src_indices[name].read(1, window=window)
                        require(np.isfinite(source_index).all(),
                                'Nonfinite source index pixels')
                        source_valid = source_index != NODATA
                        expected_valid = common & np.isfinite(denominator) & (denominator > EPSILON)
                        derived = np.full(source_index.shape, np.nan, dtype=np.float64)
                        with np.errstate(divide='ignore', invalid='ignore'):
                            derived[expected_valid] = numerator[expected_valid]/denominator[expected_valid]
                        require(np.isfinite(derived[expected_valid]).all() and
                                not np.any(np.abs(derived[expected_valid]) > 2),
                                'Invalid reference-derived index')
                        shared = source_valid & expected_valid
                        diff = source_index[shared].astype(np.float64) - derived[shared]
                        item = accumulators[name]
                        item['sourceValid'] += int(np.count_nonzero(source_valid))
                        item['referenceValid'] += int(np.count_nonzero(expected_valid))
                        item['shared'] += int(np.count_nonzero(shared))
                        if diff.size:
                            absolute = np.abs(diff)
                            item['sum'] += float(diff.sum(dtype=np.float64))
                            item['abs'] += float(absolute.sum(dtype=np.float64))
                            item['square'] += float(np.dot(diff, diff))
                            item['errors'].append(absolute)
            for name, item in accumulators.items():
                require(item['shared'] > 0, 'No shared numerical index pixels')
                overlap_count = (item['sourceValid'] +
                                 item['referenceValid'] - item['shared'])
                iou = item['shared']/overlap_count
                mae = item['abs']/item['shared']
                rmse = math.sqrt(item['square']/item['shared'])
                p95 = float(np.percentile(np.concatenate(item['errors']), 95))
                stats[name] = {
                    'sharedValidPixels': item['shared'],
                    'sourceIndexValidPixels': item['sourceValid'],
                    'referenceDerivedValidPixels': item['referenceValid'],
                    'sourceOnlyValidPixels': item['sourceValid'] - item['shared'],
                    'referenceOnlyValidPixels': item['referenceValid'] - item['shared'],
                    'maskIntersectionOverUnion': iou,
                    'meanSignedError': item['sum']/item['shared'],
                    'meanAbsoluteError': mae,
                    'rmse': rmse,
                    'p95AbsoluteError': p95,
                    'withinExploratoryLimits': bool(mae <= LAB_MAE and
                        rmse <= LAB_RMSE and p95 <= LAB_P95 and iou >= LAB_MASK_IOU)
                }
    # Re-verify all pinned source/reference files and mathematical index QA.
    _verify_inputs(ref, source, receipt, seal_sha256, ref_dir,
                   reference_manifest_sha256)
    return {
        'schema': 'skyhub-m3m-private-reference-index-agreement-v1',
        'classification': 'experimental-cross-pipeline-index-comparison-not-calibration',
        'indexFormulaInputs': ['red', 'green', 'red_edge', 'nir'],
        'referenceIndexFormulas': ['NDVI', 'NDRE', 'GNDVI', 'OSAVI'],
        'sourceFourBandAgreementWithinExploratoryLimits': bands['allBandsWithinExploratoryLimits'],
        'indices': stats,
        'labThresholds': {'meanAbsoluteErrorMax': LAB_MAE, 'rmseMax': LAB_RMSE,
                          'p95AbsoluteErrorMax': LAB_P95,
                          'maskIntersectionOverUnionMin': LAB_MASK_IOU},
        'allIndicesWithinExploratoryLimits': all(
            val['withinExploratoryLimits'] for val in stats.values()),
        'sourceAndReferencePinsRecheckedAfterRead': True,
        'referenceProvenanceIndependentlyVerified': False,
        'sourceProvenanceVerified': False,
        'radiometricCalibrationVerified': False,
        'bandCoregistrationVerified': False,
        'reflectanceReady': False, 'ndviReady': False, 'ndreReady': False,
        'operationalUseAllowed': False, 'prescriptionExportAllowed': False,
        'flightMissionAllowed': False,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--seal', type=Path, required=True)
    parser.add_argument('--seal-sha256', required=True)
    parser.add_argument('--reference-dir', type=Path, required=True)
    parser.add_argument('--reference-manifest-sha256', required=True)
    args = parser.parse_args(argv)
    try:
        report = audit(bundle=args.bundle, seal=args.seal,
                       seal_sha256=args.seal_sha256,
                       reference_dir=args.reference_dir,
                       reference_manifest_sha256=args.reference_manifest_sha256)
        print(json.dumps(report, sort_keys=True, allow_nan=False))
    except Exception as exc:
        print('Private M3M reference index audit refused: ' +
              type(exc).__name__, file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
