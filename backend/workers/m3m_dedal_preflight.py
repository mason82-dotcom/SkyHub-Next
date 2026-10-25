#!/usr/bin/env python3
"""Offline, non-executing DEDAL 0.1.0 archive and Mavic 3M job preflight.

The published Zenodo record is v0.1.1 but contains a 0.1.0-named ZIP.
This tool never downloads, unpacks, imports or executes that third-party code.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import zipfile

PUBLISHED_MD5 = '8d59d0be195d361bca076411b1c6da6e'
ARCHIVE_NAME = 'dedal-calibration-0.1.0.zip'
RECORD_URL = 'https://zenodo.org/records/23301986'
BANDS = ('G', 'R', 'RE', 'NIR')
NAME = re.compile(r'^(DJI_\d{14}_\d{4})_MS_(G|R|RE|NIR)\.TIF$', re.I)
CAPTURE = re.compile(r'^DJI_\d{14}_\d{4}$', re.I)
SHA256 = re.compile(r'^[a-fA-F0-9]{64}$')
MAX_IMAGES = 2500
MAX_ENTRIES = 10000
MAX_IMAGE_BYTES = 128 * 1024 * 1024
MAX_ARCHIVE_BYTES = 20 * 1024 * 1024
MAX_PANEL_BYTES = 64 * 1024
MAX_UNZIP_BYTES = 150 * 1024 * 1024


class PreflightError(ValueError):
    """Input cannot be accepted even for an experimental DEDAL job plan."""


def _regular(path: Path, max_bytes: int):
    if path.is_symlink():
        raise PreflightError('Symlink not accepted')
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or not 1 <= info.st_size <= max_bytes:
        raise PreflightError('Not a bounded regular file')
    return info


def _hash(path: Path, max_bytes: int):
    before = _regular(path, max_bytes)
    sha = hashlib.sha256()
    md5 = hashlib.md5(usedforsecurity=False)
    with path.open('rb') as source:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            sha.update(chunk)
            md5.update(chunk)
    after = _regular(path, max_bytes)
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
        after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns
    ):
        raise PreflightError('Input changed during read')
    return sha.hexdigest(), md5.hexdigest(), before.st_size


def _unique_object_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise PreflightError('Duplicate JSON key')
        result[key] = value
    return result


def _panel(path: Path):
    _regular(path, MAX_PANEL_BYTES)
    with path.open('r', encoding='utf-8') as source:
        data = json.load(source, object_pairs_hook=_unique_object_pairs)
    if not isinstance(data, dict) or not isinstance(data.get('bands'), dict) or set(data['bands']) != set(BANDS):
        raise PreflightError('Missing or unexpected panel bands')
    values = {}
    for band in BANDS:
        obj = data['bands'][band]
        if not isinstance(obj, dict):
            raise PreflightError('Panel band is not an object')
        value = obj.get('reflectance')
        if type(value) not in (float, int) or not 0 < value <= 1:
            raise PreflightError('Panel reflectance must be a fraction (0,1]')
        wave = obj.get('wavelength_nm')
        if wave is not None and (type(wave) not in (int, float) or not 350 <= wave <= 1100):
            raise PreflightError('Invalid panel wavelength')
        values[band] = float(value)
    return values


def _archive(path: Path, expected_sha256: str):
    if path.name != ARCHIVE_NAME or not SHA256.fullmatch(expected_sha256):
        raise PreflightError('Archive filename or SHA256 pin invalid')
    sha, md5, size = _hash(path, MAX_ARCHIVE_BYTES)
    if sha.lower() != expected_sha256.lower() or md5.lower() != PUBLISHED_MD5:
        raise PreflightError('Archive digest does not match pinned inputs')
    with zipfile.ZipFile(path, 'r') as archive:
        infos = archive.infolist()
        if not infos or len(infos) > 300:
            raise PreflightError('Unexpected ZIP entries')
        total = 0
        for info in infos:
            p = PurePosixPath(info.filename)
            mode = (info.external_attr >> 16) & 0o170000
            if (not info.filename or info.filename.startswith('/') or '\\' in info.filename
                or '..' in p.parts or mode == stat.S_IFLNK or info.flag_bits & 1):
                raise PreflightError('Unsafe ZIP entry')
            total += info.file_size
            if total > MAX_UNZIP_BYTES or (info.file_size > 4096 and
                                          info.file_size > 100 * max(1, info.compress_size)):
                raise PreflightError('Unexpected ZIP decompression size')
    return {'sha256': sha, 'bytes': size, 'zipEntries': len(infos)}


def _images(directory: Path, panel_captures: tuple[str, ...]):
    if directory.is_symlink() or not directory.is_dir():
        raise PreflightError('Image directory must be direct and local')
    groups = {}
    fingerprints = []
    count = 0
    scanned = 0
    # No recursive traversal, and no silently ignored TIFF files.
    with os.scandir(directory) as entries:
        for entry in entries:
            scanned += 1
            if scanned > MAX_ENTRIES:
                raise PreflightError('Too many directory entries')
            if entry.is_dir(follow_symlinks=False):
                continue
            if entry.name.upper().endswith(('.TIF', '.TIFF')):
                count += 1
                if count > MAX_IMAGES:
                    raise PreflightError('Too many images')
                match = NAME.fullmatch(entry.name)
                if match is None:
                    raise PreflightError('Unrecognized TIFF filename')
                path = directory / entry.name
                if not entry.is_file(follow_symlinks=False):
                    raise PreflightError('Not a regular image')
                with path.open('rb') as source:
                    if source.read(4) not in (b'II*\x00', b'MM\x00*'):
                        raise PreflightError('Not a classic TIFF')
                sha, _, size = _hash(path, MAX_IMAGE_BYTES)
                label, band = match.group(1).upper(), match.group(2).upper()
                item = groups.setdefault(label, {})
                if band in item:
                    raise PreflightError('Duplicate spectral band in capture')
                item[band] = (entry.name, sha, size)
                fingerprints.append(sha)
    if not groups or any(set(bands) != set(BANDS) for bands in groups.values()):
        raise PreflightError('All capture groups must have exactly four bands')
    if len(fingerprints) != len(set(fingerprints)):
        raise PreflightError('Byte-identical images in different bands')
    labels = [x.upper() for x in panel_captures]
    if not labels or len(labels) != len(set(labels)) or any(not CAPTURE.fullmatch(x) for x in labels):
        raise PreflightError('One or more distinct panel-capture labels are required')
    if not set(labels) <= set(groups) or len(groups) <= len(labels):
        raise PreflightError('Panel captures must be complete and leave flight images')
    details = [{'capture': label, 'bands': {band: {'name': groups[label][band][0],
                                                 'sha256': groups[label][band][1],
                                                 'bytes': groups[label][band][2]}
                                             for band in BANDS}}
               for label in sorted(groups)]
    return details, len(labels)


def preflight(*, archive: Path, expected_sha256: str, panel: Path, images: Path,
              panel_captures: tuple[str, ...], output_dir: Path):
    """Write a private, pinned **plan**, never invoke DEDAL or ODM."""
    archive, panel, images = Path(archive).absolute(), Path(panel).absolute(), Path(images).absolute()
    archive_record = _archive(archive, expected_sha256)
    panel_values = _panel(panel)
    panel_sha, _, _ = _hash(panel, MAX_PANEL_BYTES)
    captures, panel_count = _images(images, panel_captures)
    output_dir = Path(output_dir).absolute()
    if not output_dir.parent.is_dir() or os.path.lexists(output_dir):
        raise PreflightError('Output directory must be new inside an existing parent')
    manifest = {
        'schema': 'skyhub-m3m-dedal-preflight-private-v1',
        'recordUrl': RECORD_URL,
        'recordVersion': '0.1.1',
        'archiveFilenameVersion': '0.1.0',
        'archive': {'path': str(archive), **archive_record},
        'panel': {'path': str(panel), 'sha256': panel_sha,
                  'bands': panel_values},
        'imagesRoot': str(images),
        'captures': captures,
        'panelCaptures': [x.upper() for x in panel_captures],
        'runDEDAL': False,
        'calibrationVerified': False,
        'reflectanceReady': False,
        'operationalUseAllowed': False,
    }
    os.mkdir(output_dir, mode=0o700)
    try:
        path = output_dir / 'private-preflight.json'
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as destination:
            json.dump(manifest, destination, indent=2, allow_nan=False)
            destination.write('\n')
    except BaseException:
        shutil.rmtree(output_dir)
        raise
    return {
        'schema': 'skyhub-m3m-dedal-preflight-summary-v1',
        'classification': 'checksum-matched-archive-and-unverified-image-hints',
        'captureGroups': len(captures),
        'spectralFiles': 4 * len(captures),
        'panelCaptureGroupsClaimed': panel_count,
        'archiveChecksumMatchesSuppliedSha256': True,
        'archiveChecksumMatchesPublishedMd5': True,
        'panelValuesSyntacticallyValid': True,
        'captureImagePayloadDecoded': False,
        'panelCaptureContentVerified': False,
        'dedalExecuted': False,
        'calibrationVerified': False,
        'reflectanceReady': False,
        'operationalUseAllowed': False,
        'warning': 'A reproducible input inventory is not an executed or verified calibration.',
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True, type=Path)
    parser.add_argument('--archive-sha256', required=True)
    parser.add_argument('--panel', required=True, type=Path)
    parser.add_argument('--images', required=True, type=Path)
    parser.add_argument('--panel-capture', required=True, action='append')
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        summary = preflight(archive=args.archive, expected_sha256=args.archive_sha256,
                            panel=args.panel, images=args.images,
                            panel_captures=tuple(args.panel_capture),
                            output_dir=args.output_dir)
    except (OSError, ValueError, zipfile.BadZipFile, UnicodeError) as exc:
        print('DEDAL preflight refused: ' + type(exc).__name__, file=sys.stderr)
        return 2
    print(json.dumps(summary, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
