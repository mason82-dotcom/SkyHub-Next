#!/usr/bin/env python3
"""P5 independent offline Metashape handoff and synthetic raster preview primitives.

No S3, no DJI, no HTTP router, no proprietary Metashape code. Sources remain read-only.
"""
from __future__ import annotations
from hashlib import sha256
from pathlib import Path
from zipfile import ZipFile, ZIP_STORED
from uuid import uuid4
import json
import math
import os
import stat
import struct
import zlib

MAX_ASSETS = 100
MAX_ASSET_BYTES = 64 * 1024 * 1024
MAX_PACKAGE_BYTES = 512 * 1024 * 1024
TILE = 256


class HandoffError(ValueError):
    pass


def private_root(root):
    p = Path(root)
    if not p.is_absolute() or p.is_symlink() or not p.is_dir() or p.resolve() != p:
        raise HandoffError("Private root required")
    if p.stat().st_mode & 0o077:
        raise HandoffError("Private root permissions required")
    return p


def read_regular(root, filename):
    if not isinstance(filename, str) or not filename or len(filename) > 120 or "/" in filename or "\\" in filename or filename.startswith("."):
        raise HandoffError("Only flat safe file names")
    path = root / filename
    st = path.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or st.st_size == 0 or st.st_size > MAX_ASSET_BYTES:
        raise HandoffError("Unsafe source file")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        if os.fstat(fd).st_ino != st.st_ino or os.fstat(fd).st_dev != st.st_dev:
            raise HandoffError("Source replaced during open")
        with os.fdopen(fd, "rb", closefd=False) as fh:
            data = fh.read(MAX_ASSET_BYTES + 1)
        if len(data) != st.st_size:
            raise HandoffError("Source size changed")
        if path.lstat().st_ino != st.st_ino:
            raise HandoffError("Source replaced")
        return data
    finally:
        os.close(fd)


def prepare_metashape_package(input_dir, output_dir, assets):
    source = private_root(input_dir)
    destination = private_root(output_dir)
    if source == destination:
        raise HandoffError("Output and input must differ")
    if not isinstance(assets, list) or not 1 <= len(assets) <= MAX_ASSETS:
        raise HandoffError("Invalid asset selection")
    rows = []
    seen = set()
    total = 0
    for item in assets:
        if not isinstance(item, dict) or set(item) != {"file", "channel", "sha256"}:
            raise HandoffError("Exact file/channel/hash required")
        name, channel, digest = item["file"], item["channel"], item["sha256"]
        if name in seen or channel not in ("RGB", "G", "R", "RE", "NIR") or (
                not isinstance(digest, str) or len(digest) != 64 or
                any(c not in "0123456789abcdef" for c in digest)):
            raise HandoffError("Invalid asset manifest")
        seen.add(name)
        data = read_regular(source, name)
        if sha256(data).hexdigest() != digest:
            raise HandoffError("Asset hash mismatch")
        total += len(data)
        if total > MAX_PACKAGE_BYTES:
            raise HandoffError("Package size limit")
        rows.append((name, channel, digest, data))
    # No claim that captures belong to one flight or that four bands are registered.
    manifest = {"schema": "skyhub-aeronexus-metashape-handoff-p5-v1",
                "classification": "unverified-external-offline-export",
                "sourceRadiometryVerified": False,
                "orthomosaicReady": False, "flightReady": False,
                "files": [{"file": n, "channel": c, "sha256": h, "bytes": len(b)}
                          for n, c, h, b in rows]}
    artifact = destination / ("aeronexus-p5-" + uuid4().hex + ".zip")
    temp = destination / ("." + uuid4().hex + ".part")
    try:
        with ZipFile(temp, "w", compression=ZIP_STORED, allowZip64=True) as pack:
            pack.writestr("manifest.json", json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n")
            for name, _, _, data in rows:
                pack.writestr("input/" + name, data)
        os.chmod(temp, 0o600)
        os.replace(temp, artifact)
        return {"package": str(artifact), "manifest": manifest}
    finally:
        if temp.exists():
            temp.unlink()


def grayscale_tile(values, width, height, low, high):
    """Small fixed 256x256 lab PNG; input is already selected numeric tile, no geodata."""
    if width != TILE or height != TILE or len(values) != TILE * TILE:
        raise HandoffError("Expected preselected 256x256 tile")
    if not all(math.isfinite(v) for v in (low, high)) or low >= high:
        raise HandoffError("Invalid display range")
    raw = bytearray()
    for y in range(TILE):
        raw.append(0)
        for x in range(TILE):
            n = values[y * TILE + x]
            if n is None or not isinstance(n, (float, int)) or not math.isfinite(n):
                raw.extend((0, 0, 0, 0))
            else:
                shade = max(0, min(255, round((n - low) * 255 / (high - low))))
                raw.extend((shade, shade, shade, 255))
    def chunk(name, body):
        return struct.pack(">I", len(body)) + name + body + struct.pack(">I", zlib.crc32(name + body) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" +
            chunk(b"IHDR", struct.pack(">IIBBBBB", TILE, TILE, 8, 6, 0, 0, 0)) +
            chunk(b"IDAT", zlib.compress(bytes(raw), level=6)) +
            chunk(b"IEND", b""))
