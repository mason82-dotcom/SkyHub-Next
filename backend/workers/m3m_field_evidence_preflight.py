#!/usr/bin/env python3
"""P3.6 offline M3M field evidence preflight; never establishes calibration.

Matches original four-band TIFF bytes against an independently pinned P1
capture receipt and optionally inventories separately pinned operator-supplied
sunlight sensor / calibration panel / registration evidence. Everything is
untrusted until scientifically validated. No original filenames, GPS, XMP,
UUIDs, opaque evidence data, paths or receipt hashes in the public summary.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys

BANDS = ('G', 'R', 'RE', 'NIR')
KINDS = (
    ('sunlightSensor', 'sunlight-sensor-evidence.bin'),
    ('panelImage', 'panel-image-evidence.bin'),
    ('panelCertificate', 'panel-certificate-evidence.bin'),
    ('bandRegistration', 'band-registration-evidence.bin'),
    ('independentReference', 'independent-reference-evidence.bin'),
)
SCHEMA = 'skyhub-m3m-field-evidence-manifest-v1'
HEX = re.compile(r'[a-f0-9]{64}\Z')
MAX_RECEIPT = 16384
MAX_MANIFEST = 16384
MAX_ASSET = 32 * 1024 * 1024
FALSE_FLAGS = ('sourceVerified', 'radiometricCalibrationVerified',
               'bandCoregistrationVerified', 'reflectanceReady', 'ndviReady',
               'ndreReady', 'operationalUseAllowed', 'prescriptionExportAllowed',
               'flightMissionAllowed')


class EvidenceError(ValueError):
    """The local candidate or evidence inventory cannot be trusted."""


def require(ok, reason):
    if not ok:
        raise EvidenceError(reason)


def _read_file(path: Path, maximum: int, private=False):
    require(not path.is_symlink(), 'Symlinked evidence not allowed')
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
                0 < before.st_size <= maximum, 'Not an ordinary bounded artifact')
        if private:
            require((before.st_mode & 0o077) == 0,
                    'Evidence manifest/receipt must be private (0600)')
        content = bytearray()
        while len(content) < before.st_size:
            block = os.read(fd, min(1024 * 1024, before.st_size - len(content)))
            require(block, 'Input truncated')
            content.extend(block)
        after = os.fstat(fd)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
                 before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns,
                 after.st_ctime_ns), 'Input mutated during read')
        return bytes(content)
    finally:
        os.close(fd)


def _digest(path: Path, maximum: int, private=False):
    payload = _read_file(path, maximum, private=private)
    return {'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)}


def _pairs(items):
    result = {}
    for name, value in items:
        require(name not in result, 'Duplicate JSON key')
        result[name] = value
    return result


def _bad_number(_):
    raise EvidenceError('Non-finite JSON value')


def _parse(raw):
    try:
        data = json.loads(raw.decode('utf-8'), object_pairs_hook=_pairs,
                          parse_constant=_bad_number)
    except (UnicodeError, TypeError, ValueError) as exc:
        raise EvidenceError('Untrusted evidence JSON') from exc
    require(isinstance(data, dict), 'Expected JSON object')
    return data


def _canonical(data):
    return (json.dumps(data, sort_keys=True, separators=(',', ':'),
                       allow_nan=False) + '\n').encode('utf-8')


def _module():
    source = Path(__file__).resolve().with_name('m3m_source_capture_receipt.py')
    spec = importlib.util.spec_from_file_location('_skyhub_p36_source_receipt', source)
    require(spec is not None and spec.loader is not None,
            'Local P1 capture decoder unavailable')
    item = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(item)
    return item


def _validate_source(tiffs, receipt_path: Path, pin: str):
    payload = _read_file(receipt_path, MAX_RECEIPT, private=True)
    require(hashlib.sha256(payload).hexdigest() == pin,
            'Original capture receipt differs from independently recorded digest')
    saved = _parse(payload)
    require(set(saved) == {'schema', 'classification', 'bands',
                           'spectralSourceCount', 'decodedPixelCount',
                           'saturatedSampleCount', 'allSpectralDimensionsEqual',
                           'captureUuidMatchedPrivately', 'sha256OriginalBytes',
                           'rgbCandidate', *FALSE_FLAGS} and
            saved['schema'] == 'skyhub-m3m-source-candidate-receipt-v1' and
            saved['classification'] ==
            'locally-decoded-xmp-capture-hints-not-dji-provenance' and
            saved['rgbCandidate'] is None and
            all(saved.get(flag) is False for flag in FALSE_FLAGS),
            'Source candidate receipt has unexpected readiness or schema')
    try:
        recreated = _module().create_receipt(tiffs)
    except Exception as exc:
        raise EvidenceError('Original TIFF capture is incomplete or inconsistent') from exc
    require(saved == recreated and
            saved['spectralSourceCount'] == 4 and
            saved['allSpectralDimensionsEqual'] is True and
            saved['captureUuidMatchedPrivately'] is True,
            'Original TIFFs do not match independently pinned capture receipt')
    return recreated


def _validate_evidence(root: Path, pin: str):
    require(not root.is_symlink() and root.is_dir() and
            (root.lstat().st_mode & 0o077) == 0,
            'Private 0700 evidence folder required')
    manifest_file = root / 'field-evidence-manifest.json'
    payload = _read_file(manifest_file, MAX_MANIFEST, private=True)
    require(hashlib.sha256(payload).hexdigest() == pin,
            'Evidence manifest differs from independently recorded SHA256')
    manifest = _parse(payload)
    require(_canonical(manifest) == payload, 'Evidence JSON must be canonical')
    require(set(manifest) == {'schema', 'classification', 'assets',
                             'operatorClaimOfValidation',
                             'calibrationVerified', 'operationalUseAllowed'} and
            manifest['schema'] == SCHEMA and
            manifest['classification'] == 'opaque-operator-evidence-unvalidated' and
            manifest['operatorClaimOfValidation'] is False and
            manifest['calibrationVerified'] is False and
            manifest['operationalUseAllowed'] is False,
            'Evidence must not declare scientific or operational validation')
    assets = manifest['assets']
    require(isinstance(assets, list) and len(assets) == len(KINDS),
            'Five known evidence categories required, including absent markers')
    inventory = {}
    names = {'field-evidence-manifest.json'}
    for item, (kind, filename) in zip(assets, KINDS):
        require(isinstance(item, dict) and set(item) ==
                {'kind', 'filename', 'sha256', 'bytes', 'provided',
                 'contentScientificallyVerified'} and
                item['kind'] == kind and
                item['contentScientificallyVerified'] is False and
                type(item['provided']) is bool,
                'Unknown or overclaimed evidence entry')
        if item['provided']:
            require(item['filename'] == filename and
                    isinstance(item['sha256'], str) and
                    HEX.fullmatch(item['sha256']) is not None and
                    type(item['bytes']) is int and 1 <= item['bytes'] <= MAX_ASSET,
                    'Evidence reference needs a fixed filename and SHA256')
            observed = _digest(root / filename, MAX_ASSET, private=True)
            require(observed == {'sha256': item['sha256'], 'bytes': item['bytes']},
                    'Evidence file differs from pinned manifest')
            names.add(filename)
            inventory[kind] = True
        else:
            require(item['filename'] is None and item['sha256'] is None and
                    item['bytes'] is None,
                    'Unavailable evidence must not advertise hashes or filenames')
            inventory[kind] = False
    require({p.name for p in root.iterdir()} == names,
            'Private evidence inventory has missing or unexpected files')
    return inventory


def preflight(*, tiffs, source_receipt: Path, source_receipt_sha256: str,
              evidence_dir: Path, evidence_manifest_sha256: str):
    require(isinstance(tiffs, (list, tuple)) and len(tiffs) == 4,
            'Exactly four explicit original TIFF paths are required')
    require(all(isinstance(d, str) and HEX.fullmatch(d) is not None
                for d in (source_receipt_sha256, evidence_manifest_sha256)),
            'Two externally retained independent SHA256 pins required')
    paths = [Path(p).expanduser().absolute() for p in tiffs]
    receipt = Path(source_receipt).expanduser().absolute()
    root = Path(evidence_dir).expanduser().absolute()
    require(len(set(paths)) == 4 and not receipt.is_symlink() and
            not root.is_symlink() and
            receipt not in paths and root not in paths and
            root not in [p.parent for p in paths] and
            root != receipt.parent and
            all(not p.is_symlink() for p in paths),
            'Original captures, receipt and evidence must be separate artifacts')
    initial = _validate_source(paths, receipt, source_receipt_sha256)
    present = _validate_evidence(root, evidence_manifest_sha256)
    # Both artifacts and full TIFF pixel/XMP inventory are rechecked at end,
    # so late source/evidence changes never produce a valid summary.
    require(_validate_source(paths, receipt, source_receipt_sha256) == initial and
            _validate_evidence(root, evidence_manifest_sha256) == present,
            'Capture or evidence changed during inspection')
    return {
        'schema': 'skyhub-m3m-field-evidence-preflight-v1',
        'classification': 'local-source-and-evidence-presence-not-scientific-validation',
        'originalSpectralTiffCount': 4,
        'decodedPixelCount': initial['decodedPixelCount'],
        'saturatedSampleCount': initial['saturatedSampleCount'],
        'sameCaptureXmpHint': True,
        'allBandImageDimensionsEqual': initial['allSpectralDimensionsEqual'],
        'originalBytesMatchIndependentReceiptPin': True,
        'evidenceBytesMatchIndependentManifestPin': True,
        'evidencePresentButUnvalidated': [name for name, _ in KINDS if present[name]],
        'evidenceMissing': [name for name, _ in KINDS if not present[name]],
        'evidenceAssetsPresent': sum(present.values()),
        'allEvidenceTypesSupplied': all(present.values()),
        'scienceReady': False,
        'sourceVerified': False,
        'djiHardwareProvenanceVerified': False,
        'sunlightSensorValuesValidated': False,
        'panelCalibrationVerified': False,
        'independentGroundTruthVerified': False,
        'radiometricCalibrationVerified': False,
        'bandCoregistrationVerified': False,
        'reflectanceReady': False,
        'ndviReady': False,
        'ndreReady': False,
        'operationalUseAllowed': False,
        'prescriptionExportAllowed': False,
        'flightMissionAllowed': False,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tiff', action='append', type=Path, required=True)
    parser.add_argument('--source-receipt', type=Path, required=True)
    parser.add_argument('--source-receipt-sha256', required=True)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    parser.add_argument('--evidence-manifest-sha256', required=True)
    a = parser.parse_args(argv)
    try:
        print(json.dumps(preflight(
            tiffs=a.tiff, source_receipt=a.source_receipt,
            source_receipt_sha256=a.source_receipt_sha256,
            evidence_dir=a.evidence_dir,
            evidence_manifest_sha256=a.evidence_manifest_sha256),
            sort_keys=True, allow_nan=False))
    except Exception as exc:
        print('M3M P3.6 private evidence preflight refused: ' +
              type(exc).__name__, file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
