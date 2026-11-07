#!/usr/bin/env python3
"""Bounded offline audit of DJI-style 16-bit TIFF payloads and XMP band hints.

This module validates local image decode and private capture-label equality.
It does not verify DJI origin, perform radiometric calibration, or calculate NDVI.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import uuid

MAX_FILES = 4
MAX_FILE_BYTES = 128 * 1024 * 1024
MAX_XMP_BYTES = 32768
MAX_PIXELS = 16_777_216
CHUNK_BYTES = 1024 * 1024
DJI_NS = 'http://www.dji.com/drone-dji/1.0/'
BANDS = ('G', 'R', 'RE', 'NIR')
NAMES = {'Green': 'G', 'Red': 'R', 'RedEdge': 'RE', 'NIR': 'NIR'}
SOURCES = {'MS_G_CAMERA': 'G', 'MS_R_CAMERA': 'R',
           'MS_RE_CAMERA': 'RE', 'MS_NIR_CAMERA': 'NIR'}


class InvalidTiff(ValueError):
    """An input could not be safely classified as a decodable spectral TIFF."""


def _libraries():
    try:
        import numpy as np
        import rasterio
        import tifffile
        from defusedxml import ElementTree
        from rasterio.windows import Window
    except ImportError as exc:
        raise RuntimeError('Offline audit needs numpy, rasterio, tifffile and defusedxml') from exc
    return np, rasterio, tifffile, ElementTree, Window


def _metadata(xml: bytes, element_tree) -> dict:
    """Parse no arbitrary XML fields; UUID stays process-private."""
    result = {'band': 'unknown', 'captureUuid': None, 'xmpStatus': 'unavailable'}
    if not xml or len(xml) > MAX_XMP_BYTES:
        return result
    try:
        root = element_tree.fromstring(xml.rstrip(b'\x00'))
    except Exception:
        # The XML parser is defusedxml; malformed or hostile XML is not trusted.
        result['xmpStatus'] = 'invalid'
        return result
    found = {field: [] for field in ('BandName', 'ImageSource', 'CaptureUUID', 'CaptureUuid')}
    for node in root.iter():
        for key, value in node.attrib.items():
            for field in found:
                if key == '{' + DJI_NS + '}' + field:
                    found[field].append(value)
        for field in found:
            if node.tag == '{' + DJI_NS + '}' + field:
                found[field].append(node.text or '')
    if not any(found.values()):
        result['xmpStatus'] = 'no-dji-fields'
        return result
    if any(len(found[key]) > 1 for key in found):
        result['xmpStatus'] = 'duplicate-fields'
        return result
    from_name = NAMES.get(found['BandName'][0]) if len(found['BandName']) == 1 else None
    from_source = SOURCES.get(found['ImageSource'][0]) if len(found['ImageSource']) == 1 else None
    if ((found['BandName'] and from_name is None) or
            (found['ImageSource'] and from_source is None) or
            (from_name and from_source and from_name != from_source)):
        result['xmpStatus'] = 'inconsistent-band'
        return result
    result['band'] = from_name or from_source or 'unknown'
    markers = found['CaptureUUID'] + found['CaptureUuid']
    if len(markers) == 1:
        value = markers[0].strip()
        if re.fullmatch(r'[0-9a-fA-F]{32}|[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', value):
            try:
                parsed = uuid.UUID(value)
                if parsed.version == 4 and parsed.variant == uuid.RFC_4122:
                    result['captureUuid'] = parsed.hex
            except ValueError:
                pass
    result['xmpStatus'] = 'ok' if result['band'] != 'unknown' else 'band-unknown'
    return result


def _initial_file(path: Path):
    if path.suffix.lower() not in ('.tif', '.tiff') or path.is_symlink():
        raise InvalidTiff('Only direct local TIFF file paths are accepted')
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or not 16 <= info.st_size <= MAX_FILE_BYTES:
        raise InvalidTiff('Not an ordinary bounded local file')
    with path.open('rb') as file:
        header = file.read(8)
    if header[:4] not in (b'II*\x00', b'MM\x00*'):
        raise InvalidTiff('Only classic TIFF is supported')
    return info


def _fingerprint(path: Path) -> bytes:
    digest = hashlib.sha256()
    with path.open('rb') as file:
        while True:
            data = file.read(CHUNK_BYTES)
            if not data:
                break
            digest.update(data)
    return digest.digest()


def _extract_xmp(path, tifffile, element_tree):
    with tifffile.TiffFile(path) as file:
        if not file.pages:
            raise InvalidTiff('TIFF has no image directory')
        tag = file.pages[0].tags.get(700)
        if tag is None:
            return _metadata(b'', element_tree)
        if not 0 < tag.count <= MAX_XMP_BYTES:
            return {'band': 'unknown', 'captureUuid': None, 'xmpStatus': 'oversized'}
        value = tag.value
        if not isinstance(value, bytes):
            return {'band': 'unknown', 'captureUuid': None, 'xmpStatus': 'invalid'}
        return _metadata(value, element_tree)


def audit(paths) -> dict:
    """Consume up to four explicit local TIFF paths; return only aggregate safe output."""
    np, rasterio, tifffile, element_tree, Window = _libraries()
    if not isinstance(paths, (tuple, list)) or not 1 <= len(paths) <= MAX_FILES:
        raise InvalidTiff('Accept 1 to 4 local TIFFs per inspection')
    resolved = [Path(p).expanduser().absolute() for p in paths]
    infos = [_initial_file(p) for p in resolved]
    identities = [(s.st_dev, s.st_ino) for s in infos]
    if len(set(identities)) != len(identities):
        raise InvalidTiff('Repeated or hard-linked input files')
    observations, payloads = [], set()
    pixel_sizes = set()
    for path, before in zip(resolved, infos):
        before_digest = _fingerprint(path)
        if before_digest in payloads:
            raise InvalidTiff('Byte-identical files cannot be separate spectral sources')
        payloads.add(before_digest)
        xmp = _extract_xmp(path, tifffile, element_tree)
        with rasterio.Env(GDAL_PAM_ENABLED='NO', GDAL_DISABLE_READDIR_ON_OPEN='YES'):
            with rasterio.open(path) as src:
                if (src.driver != 'GTiff' or src.count != 1 or src.dtypes[0] != 'uint16'
                        or src.width < 1 or src.height < 1
                        or src.width * src.height > MAX_PIXELS):
                    raise InvalidTiff('Not one bounded uint16 TIFF band')
                pixel_sizes.add((src.width, src.height))
                seen = nonzero = saturated = masked = 0
                for row in range(0, src.height, 256):
                    for col in range(0, src.width, 256):
                        window = Window(col, row, min(256, src.width - col),
                                        min(256, src.height - row))
                        arr = src.read(1, window=window, masked=True)
                        valid = ~np.ma.getmaskarray(arr)
                        seen += arr.size
                        masked += int(np.count_nonzero(~valid))
                        nonzero += int(np.count_nonzero(valid & (arr.data > 0)))
                        saturated += int(np.count_nonzero(valid & (arr.data == 65535)))
                if seen != src.width * src.height or nonzero == 0:
                    raise InvalidTiff('No meaningful readable uint16 samples')
        after = path.stat()
        if ((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
                != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
                or _fingerprint(path) != before_digest):
            raise InvalidTiff('Input changed while it was audited')
        observations.append({**xmp, 'pixelCount': seen, 'maskedPixels': masked,
                             'nonzeroPixels': nonzero, 'saturatedPixels': saturated})
    hints = [x['band'] for x in observations]
    captures = [x['captureUuid'] for x in observations]
    coherent = (len(observations) > 1 and all(x is not None for x in captures) and len(set(captures)) == 1
                and len(set(hints)) == len(hints) and all(h in BANDS for h in hints))
    return {
        'schema': 'skyhub-m3m-local-tiff-payload-audit-v1',
        'classification': 'local-uint16-decode-and-unverified-xmp-hints-only',
        'examined': len(observations),
        'decodedPayloads': len(observations),
        'totalDecodedPixels': sum(x['pixelCount'] for x in observations),
        'totalMaskedPixels': sum(x['maskedPixels'] for x in observations),
        'totalNonzeroPixels': sum(x['nonzeroPixels'] for x in observations),
        'totalSaturatedPixels': sum(x['saturatedPixels'] for x in observations),
        'sameImageDimensions': len(pixel_sizes) == 1,
        'bandHints': {b: hints.count(b) for b in BANDS},
        'unknownBandHints': hints.count('unknown'),
        'xmpStatusCounts': {s: sum(x['xmpStatus'] == s for x in observations)
                            for s in ('ok', 'unavailable', 'invalid', 'oversized',
                                      'no-dji-fields', 'duplicate-fields',
                                      'inconsistent-band', 'band-unknown')},
        'captureGroupHint': bool(coherent),
        'redNirPairHint': bool(coherent and {'R', 'NIR'}.issubset(hints)),
        'fullFourBandHint': bool(coherent and set(hints) == set(BANDS)),
        'sha256UsedForLocalStabilityCheck': True,
        'sourceVerified': False,
        'imageContentVerifiedAsDjiM3M': False,
        'radiometricCalibrationVerified': False,
        'bandCoregistrationVerified': False,
        'reflectanceReady': False,
        'ndviReady': False,
        'ndreReady': False,
        'operationalUseAllowed': False,
        'warning': 'Decoding and matching untrusted XMP claims do not establish sensor provenance, calibration, registration or reflectance.',
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tiff', type=Path, action='append', required=True,
                        help='One local TIFF; repeat 1 to 4 times')
    args = parser.parse_args(argv)
    try:
        result = audit(args.tiff)
    except Exception as exc:
        # Do not print exception messages that may contain user-provided paths.
        print('M3M payload audit refused input: ' + type(exc).__name__, file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
