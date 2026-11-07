#!/usr/bin/env python3
"""Statically inspect a locally pinned DEDAL ZIP without importing or executing it.

Inspecting metadata is not CLI validation. Archive content and entry points are
untrusted, and every operational/calibration readiness flag stays false.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tomllib
import zipfile

PUBLISHED_MD5 = '8d59d0be195d361bca076411b1c6da6e'
ARCHIVE_NAME = 'dedal-calibration-0.1.0.zip'
ARCHIVE_PREFIX = 'dedal-calibration-0.1.0/'
MAX_ARCHIVE_BYTES = 20 * 1024 * 1024
MAX_MEMBERS = 300
MAX_UNCOMPRESSED = 150 * 1024 * 1024
MAX_METADATA_BYTES = 128 * 1024
EXPECTED_FILES = frozenset({
    'pyproject.toml', 'README.md', 'LICENSE',
    'panelcal/__init__.py', 'panelcal/calibrate.py', 'panelcal/dji.py',
    'panelcal/radiometry.py', 'panelcal/panels.py', 'panelcal/task.py',
    'tests/test_calibration.py',
})
CLI_TARGET = re.compile(r'^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$')
SHA = re.compile(r'^[a-fA-F0-9]{64}$')


class ArchiveInspectionError(ValueError):
    """The archive cannot be safely inventoried against this conservative profile."""


def _safe_file(path: Path) -> os.stat_result:
    if path.name != ARCHIVE_NAME or path.is_symlink():
        raise ArchiveInspectionError('Unexpected archive path or symlink')
    s = path.stat()
    if not stat.S_ISREG(s.st_mode) or not 32 <= s.st_size <= MAX_ARCHIVE_BYTES:
        raise ArchiveInspectionError('Not a bounded regular archive')
    return s


def _fingerprint(path: Path) -> tuple[str, str]:
    sha, md5 = hashlib.sha256(), hashlib.md5(usedforsecurity=False)
    with path.open('rb') as f:
        while data := f.read(1024 * 1024):
            sha.update(data)
            md5.update(data)
    return sha.hexdigest(), md5.hexdigest()


def _safe_members(zf: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    entries = zf.infolist()
    if not entries or len(entries) > MAX_MEMBERS:
        raise ArchiveInspectionError('Unexpected archive size')
    seen = set()
    by_relative = {}
    inflated_total = 0
    for info in entries:
        n = info.filename
        path = PurePosixPath(n)
        mode = (info.external_attr >> 16) & 0o170000
        if (not n or not n.startswith(ARCHIVE_PREFIX) or n.startswith('/')
            or '\\' in n or any(part in ('', '.', '..') for part in n.split('/')[:-1])
            or '..' in path.parts or info.flag_bits & 1
            or mode == stat.S_IFLNK or mode not in (0, stat.S_IFDIR, stat.S_IFREG)):
            raise ArchiveInspectionError('Unsafe archive member')
        if n in seen:
            raise ArchiveInspectionError('Repeated archive member')
        seen.add(n)
        inflated_total += info.file_size
        if inflated_total > MAX_UNCOMPRESSED:
            raise ArchiveInspectionError('Archive expansion size exceeded')
        if info.file_size > 4096 and info.file_size > 100 * max(1, info.compress_size):
            raise ArchiveInspectionError('Suspicious compression ratio')
        if info.is_dir():
            continue
        relative = n.removeprefix(ARCHIVE_PREFIX)
        if not relative or relative.startswith('/') or relative in by_relative:
            raise ArchiveInspectionError('Invalid archive member path')
        by_relative[relative] = info
    if not EXPECTED_FILES.issubset(by_relative):
        raise ArchiveInspectionError('Missing DEDAL archive source layout')
    return by_relative


def _bounded_read(zf: zipfile.ZipFile, entry: zipfile.ZipInfo) -> bytes:
    if not 1 <= entry.file_size <= MAX_METADATA_BYTES:
        raise ArchiveInspectionError('Bounded metadata source missing or oversized')
    # zipfile may decode source text but never imports or executes it.
    with zf.open(entry, 'r') as f:
        contents = f.read(MAX_METADATA_BYTES + 1)
    if len(contents) != entry.file_size:
        raise ArchiveInspectionError('Truncated archive entry')
    return contents


def _static_cli_metadata(pyproject: bytes, calibrate: bytes) -> dict:
    try:
        data = tomllib.loads(pyproject.decode('utf-8'))
        tree = ast.parse(calibrate.decode('utf-8'))
    except (UnicodeError, SyntaxError, tomllib.TOMLDecodeError) as exc:
        raise ArchiveInspectionError('Invalid static Python package metadata') from exc
    if not isinstance(data, dict):
        raise ArchiveInspectionError('Invalid pyproject metadata')
    project = data.get('project', {})
    tool = data.get('tool', {})
    if not isinstance(project, dict) or not isinstance(tool, dict):
        raise ArchiveInspectionError('Invalid pyproject top-level tables')
    scripts = project.get('scripts', {})
    poetry = tool.get('poetry', {})
    if not isinstance(poetry, dict):
        raise ArchiveInspectionError('Invalid tool.poetry table')
    poetry_scripts = poetry.get('scripts', {})
    if not isinstance(scripts, dict) or not isinstance(poetry_scripts, dict):
        raise ArchiveInspectionError('Invalid CLI declaration')
    entries = dict(scripts)
    for k, v in poetry_scripts.items():
        if k in entries:
            raise ArchiveInspectionError('Duplicate CLI entrypoint declaration')
        entries[k] = v
    names = set()
    for k, v in entries.items():
        if (not isinstance(k, str) or not re.fullmatch(r'[a-zA-Z][a-zA-Z0-9_.-]{0,63}', k)
            or k in names or not isinstance(v, str) or not CLI_TARGET.fullmatch(v)):
            raise ArchiveInspectionError('Unsafe or unsupported CLI declaration')
        names.add(k)
    # Top-level symbols are only *syntactic* evidence, never execution proof.
    functions = {n.name for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    main_guard = any(
        isinstance(n, ast.If)
        and isinstance(n.test, ast.Compare)
        and isinstance(n.test.left, ast.Name)
        and n.test.left.id == '__name__'
        and len(n.test.comparators) == 1
        and isinstance(n.test.comparators[0], ast.Constant)
        and n.test.comparators[0].value == '__main__'
        for n in tree.body
    )
    return {
        'cliDeclarations': entries,
        'calibrateMainFunctionPresent': 'main' in functions,
        'calibrateMainGuardPresent': main_guard,
        'pyprojectProjectVersion': project.get('version') if isinstance(project.get('version'), str) else None,
        'packageName': project.get('name') if isinstance(project.get('name'), str) else None,
    }


def inspect(archive: Path, expected_sha256: str) -> dict:
    """Return a *public aggregate*, never CLI strings or source bytes."""
    if not isinstance(expected_sha256, str) or not SHA.fullmatch(expected_sha256):
        raise ArchiveInspectionError('Expected SHA256 must be 64 hex digits')
    archive = Path(archive).absolute()
    before = _safe_file(archive)
    sha, md5 = _fingerprint(archive)
    if sha.lower() != expected_sha256.lower() or md5.lower() != PUBLISHED_MD5:
        raise ArchiveInspectionError('Pinned archive checksums do not match')
    with zipfile.ZipFile(archive, 'r') as zf:
        members = _safe_members(zf)
        metadata = _static_cli_metadata(
            _bounded_read(zf, members['pyproject.toml']),
            _bounded_read(zf, members['panelcal/calibrate.py'])
        )
        member_count = len(zf.infolist())
    after = _safe_file(archive)
    if ((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
        != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
        or _fingerprint(archive)[0] != sha):
        raise ArchiveInspectionError('Archive changed during inspection')
    return {
        'schema': 'skyhub-m3m-dedal-archive-static-inspection-v1',
        'classification': 'verified-file-checksum-and-static-source-inventory-only',
        'archiveSha256MatchesOperatorPin': True,
        'archiveMd5MatchesPublishedZenodo': True,
        'expectedFilesPresent': True,
        'archiveEntryCount': member_count,
        'declaredCliEntryPointCount': len(metadata['cliDeclarations']),
        'calibrateMainFunctionPresent': metadata['calibrateMainFunctionPresent'],
        'calibrateMainGuardPresent': metadata['calibrateMainGuardPresent'],
        'projectVersionMatchesZenodoRecord': metadata['pyprojectProjectVersion'] == '0.1.1',
        'packageVersionDeclared': metadata['pyprojectProjectVersion'] is not None,
        'cliRuntimeVerified': False,
        'dedalExecuted': False,
        'calibrationVerified': False,
        'operationalUseAllowed': False,
        'warning': 'Static package inspection does not validate the CLI contract or the calibration algorithm.',
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True, type=Path)
    parser.add_argument('--archive-sha256', required=True)
    args = parser.parse_args(argv)
    try:
        report = inspect(args.archive, args.archive_sha256)
    except (ArchiveInspectionError, OSError, zipfile.BadZipFile, RuntimeError) as exc:
        print('DEDAL static archive inspection refused: ' + type(exc).__name__, file=sys.stderr)
        return 2
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
