#!/usr/bin/env python3
"""P3: private PNG preview of an independently sealed experimental index raster.

The image is a NONNUMERIC derivative. Source Float32 GeoTIFFs remain unchanged.
No tiles, HTTP routes, EXIF/CRS text, S3, drone, prescriptions or field approval.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import struct
import sys
import tempfile
import zlib

INDICES = ('ndvi', 'ndre', 'gndvi', 'osavi')
MAX_SIDE = 512
SHA = re.compile(r'[0-9a-fA-F]{64}\Z')
# Visualization palette only. Fixed bounds never used for numeric analyses.
STOPS = (
    (-0.25, (154, 48, 52)),
    (0.10, (206, 103, 57)),
    (0.30, (224, 205, 83)),
    (0.50, (136, 183, 94)),
    (0.80, (46, 119, 81)),
)


class PreviewError(ValueError):
    """A preview request has not met its integrity or privacy conditions."""


def _seal_module():
    file = Path(__file__).resolve().with_name('m3m_raster_bundle_seal.py')
    spec = importlib.util.spec_from_file_location('_skyhub_preview_seal', file)
    if spec is None or spec.loader is None:
        raise PreviewError('Bundle verifier unavailable')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _color(value: float):
    if value <= STOPS[0][0]:
        return STOPS[0][1]
    for index in range(1, len(STOPS)):
        right_x, right = STOPS[index]
        left_x, left = STOPS[index - 1]
        if value <= right_x:
            t = (value - left_x) / (right_x - left_x)
            return tuple(int(round(a + (b - a) * t)) for a, b in zip(left, right))
    return STOPS[-1][1]


def _chunk(tag: bytes, payload: bytes) -> bytes:
    content = tag + payload
    return struct.pack('>I', len(payload)) + content + struct.pack(
        '>I', zlib.crc32(content) & 0xffffffff)


def _png_rgba(pixels, mask, width: int, height: int) -> bytes:
    rows = bytearray()
    for row in range(height):
        rows.append(0)  # filter method 0
        for col in range(width):
            if not mask[row, col]:
                rows.extend((0, 0, 0, 0))
            else:
                rows.extend((*_color(float(pixels[row, col])), 255))
    header = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    return header + _chunk(b'IHDR', ihdr) + _chunk(
        b'IDAT', zlib.compress(bytes(rows), level=8)) + _chunk(b'IEND', b'')


def create_preview(*, bundle: Path, seal: Path, seal_sha256: str,
                   index: str, output_file: Path, private_output_ok: bool = False):
    if private_output_ok is not True:
        raise PreviewError('Explicit private preview consent required')
    if index not in INDICES or not isinstance(seal_sha256, str) or not SHA.fullmatch(seal_sha256):
        raise PreviewError('Approved index and independent seal digest required')
    root = Path(bundle).expanduser().absolute()
    receipt = Path(seal).expanduser().absolute()
    output = Path(output_file).expanduser().absolute()
    if (root.is_symlink() or not root.is_dir() or receipt.is_symlink() or
            output.parent.is_symlink() or not output.parent.is_dir() or
            output.suffix.lower() != '.png' or os.path.lexists(output)):
        raise PreviewError('Invalid private output or source')
    if root == output.parent or root in output.parents:
        raise PreviewError('Preview must not alter the integrity-checked bundle')

    verifier = _seal_module()
    def check_pin():
        verified = verifier.verify_seal(root, receipt, seal_sha256.lower())
        if (verified.get('filesMatched') != 11 or
                verified.get('pixelQaRechecked') is not True or
                verified.get('sha256OfSeal') != seal_sha256.lower() or
                verified.get('calibrationVerified') is not False or
                verified.get('operationalUseAllowed') is not False):
            raise PreviewError('Bundle lacks independently verified experimental integrity')
    check_pin()
    try:
        import numpy as np
        import rasterio
        from rasterio.enums import Resampling
    except ImportError as exc:
        raise PreviewError('Isolated NumPy/Rasterio installation required') from exc

    source = root / 'indices' / (index + '.tif')
    if source.is_symlink() or not source.is_file():
        raise PreviewError('Expected numerical index raster unavailable')
    with rasterio.Env(GDAL_PAM_ENABLED='NO', GDAL_DISABLE_READDIR_ON_OPEN='YES'):
        with rasterio.open(source) as ds:
            if (ds.driver != 'GTiff' or ds.count != 1 or ds.dtypes[0] != 'float32'
                    or ds.crs is None or ds.nodata != -9999.0):
                raise PreviewError('Input must be the signed numerical Float32 raster')
            scale = max(1, ds.width / MAX_SIDE, ds.height / MAX_SIDE)
            width = max(1, math.ceil(ds.width / scale))
            height = max(1, math.ceil(ds.height / scale))
            values = ds.read(1, out_shape=(height, width),
                             masked=True, resampling=Resampling.nearest)
            raw = np.asarray(values.data, dtype=np.float64)
            mask = (~np.ma.getmaskarray(values)) & np.isfinite(raw)
            if np.any(mask & ((raw < -2) | (raw > 2))):
                raise PreviewError('Out-of-range index pixels in preview')
            png = _png_rgba(raw, mask, width, height)

    # Full file-level/pixel verification must still pass after sampling.
    check_pin()
    tmp_fd, tmp_name = tempfile.mkstemp(prefix='.skyhub-private-preview-',
                                        suffix='.png', dir=output.parent)
    try:
        with os.fdopen(tmp_fd, 'wb') as target:
            target.write(png)
            target.flush()
            os.fsync(target.fileno())
        os.chmod(tmp_name, 0o600)
        # Hard-link publication is atomic and refuses existing target.
        os.link(tmp_name, output, follow_symlinks=False)
    finally:
        Path(tmp_name).unlink(missing_ok=True)
    return {
        'schema': 'skyhub-m3m-private-experimental-preview-v1',
        'classification': 'nonquantitative-private-rgba-preview-not-a-measurement',
        'index': index, 'width': width, 'height': height,
        'transparentPixels': int(np.size(mask) - np.count_nonzero(mask)),
        'paletteRange': [STOPS[0][0], STOPS[-1][0]],
        'pngSha256': hashlib.sha256(png).hexdigest(),
        'pixelsResampledForDisplay': True,
        'metadataGeolocationIncluded': False,
        'radiometricCalibrationVerified': False, 'reflectanceReady': False,
        'operationalUseAllowed': False, 'prescriptionExportAllowed': False,
        'flightMissionAllowed': False,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', required=True, type=Path)
    parser.add_argument('--seal', required=True, type=Path)
    parser.add_argument('--seal-sha256', required=True)
    parser.add_argument('--index', choices=INDICES, required=True)
    parser.add_argument('--output-file', required=True, type=Path)
    parser.add_argument('--private-output-ok', action='store_true')
    args = parser.parse_args(argv)
    try:
        report = create_preview(bundle=args.bundle, seal=args.seal,
                                seal_sha256=args.seal_sha256, index=args.index,
                                output_file=args.output_file,
                                private_output_ok=args.private_output_ok)
    except Exception as exc:
        print('M3M private preview refused: ' + type(exc).__name__, file=sys.stderr)
        return 2
    print(json.dumps(report, sort_keys=True, allow_nan=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
