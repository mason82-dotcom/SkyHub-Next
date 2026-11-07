"""Full offline synthetic M3M handoff across Python raster workers and Node catalog.

This test NEVER runs DEDAL/ODM, connects to DJI or contacts any network service.
It verifies that individual stages agree at their actual file/API boundaries.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

try:
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
except ImportError:
    np = rasterio = from_origin = None

ROOT = Path(__file__).resolve().parents[1]
WORKERS = ROOT / "backend" / "workers"
NODE_CATALOG = ROOT / "backend" / "smart-farming-catalog.js"
NODE = shutil.which("node")
JS_READ_CATALOG = (
    "const {listCandidates}=require(process.argv[1]);"
    "const options=JSON.parse(process.argv[2]);"
    "try{process.stdout.write(JSON.stringify(listCandidates(options)))}"
    "catch(_){process.stderr.write('CATALOG_REFUSED');process.exitCode=3}"
)


def worker_module(name: str):
    src = WORKERS / (name + ".py")
    spec = importlib.util.spec_from_file_location("_m3m_e2e_" + name, src)
    if spec is None or spec.loader is None:
        raise RuntimeError("Offline worker module is missing")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@unittest.skipUnless(
    np is not None and rasterio is not None and NODE is not None,
    "Isolated Python rasterio/numpy and Node.js are required",
)
class M3mOfflineEndToEndTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="skyhub-m3m-e2e-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.ortho = self.root / "synthetic-5band.tif"
        self.bundle = self.root / "bundle"
        self.seal = self.root / "evidence.seal.json"
        self.candidate = self.root / "candidate"
        self.catalog = self.root / "catalog"
        self.pipeline = worker_module("m3m_dedal_offline_pipeline")
        self.sealing = worker_module("m3m_raster_bundle_seal")
        self.register = worker_module("m3m_smart_farming_candidate")
        pixels = np.zeros((5, 4, 7), dtype=np.uint16)
        pixels[0] = 6554    # Red ~= .2
        pixels[1] = 9830    # Green ~= .3
        pixels[2] = 19661   # NIR ~= .6
        pixels[3] = 13107   # RedEdge ~= .4
        pixels[4] = 65535  # Alpha
        pixels[4, 1, 2] = 0
        with rasterio.open(
            self.ortho, "w", driver="GTiff", count=5, height=4, width=7,
            dtype="uint16", crs="EPSG:32632",
            transform=from_origin(440000, 5400000, .05, .05),
        ) as out:
            out.write(pixels)
        self.source_pin = hashlib.sha256(self.ortho.read_bytes()).hexdigest()

    def _pipeline(self):
        report = self.pipeline.run_pipeline(
            orthophoto=self.ortho,
            expected_sha256=self.source_pin,
            output_dir=self.bundle,
            calibration_status="accepted",
        )
        self.assertIs(report["independentRasterQaPassed"], True)
        self.assertIs(report["dedalExecutedBySkyHub"], False)
        self.assertIs(report["radiometricCalibrationVerified"], False)
        self.assertIs(report["operationalUseAllowed"], False)
        return report

    def _seal(self):
        receipt = self.sealing.create_seal(self.bundle, self.seal)
        self.assertEqual(receipt["filesMatched"], 11)
        self.assertIs(receipt["pixelQaRechecked"], True)
        self.assertIs(receipt["signedByTrustedAuthority"], False)
        return receipt["sha256OfSeal"]

    def _candidate(self, pin):
        result = self.register.create_candidate(
            bundle=self.bundle, seal=self.seal,
            trusted_seal_sha256=pin, output_dir=self.candidate,
        )
        self.assertEqual(result["state"], "experimental_candidate")
        self.assertEqual(result["indexCount"], 4)
        self.assertIs(result["flightMissionAllowed"], False)
        self.assertIs(result["prescriptionExportAllowed"], False)
        return result

    def _catalog(self, candidate_record):
        slot = self.catalog / "entries" / "synthetic"
        slot.mkdir(parents=True)
        raw_source = self.candidate / "candidate.json"
        raw_destination = slot / "candidate.json"
        shutil.copyfile(raw_source, raw_destination)
        raw = raw_destination.read_bytes()
        manifest = {
            "schema": "skyhub-m3m-smart-farming-catalog-manifest-v1",
            "entries": [{
                "candidateId": candidate_record["candidateId"],
                "slot": "synthetic",
                "candidateSha256": hashlib.sha256(raw).hexdigest(),
            }],
        }
        # Canonical format required by the real Node.js manifest reader.
        manifest_raw = (json.dumps(manifest, separators=(",", ":"), ensure_ascii=False) + "\n").encode()
        (self.catalog / "catalog-manifest.json").write_bytes(manifest_raw)
        return hashlib.sha256(manifest_raw).hexdigest(), raw_destination

    def _read_catalog(self, manifest_pin):
        options = json.dumps({"root": str(self.catalog), "manifestSha256": manifest_pin})
        return subprocess.run(
            [NODE, "-e", JS_READ_CATALOG, str(NODE_CATALOG), options],
            cwd=ROOT, text=True, capture_output=True, check=False, timeout=20,
        )

    def test_full_ortho_to_seal_to_candidate_to_node_catalog(self):
        pipeline_report = self._pipeline()
        self.assertEqual(pipeline_report["indicesValidPixels"]["ndvi"], 27)
        with rasterio.open(self.bundle / "indices" / "ndvi.tif") as image:
            self.assertEqual(image.crs.to_epsg(), 32632)
            self.assertAlmostEqual(float(image.read(1)[0, 0]), 0.5, places=4)
            self.assertEqual(float(image.read(1)[1, 2]), -9999.0)
        trusted_pin = self._seal()
        candidate_record = self._candidate(trusted_pin)
        manifest_pin, _ = self._catalog(candidate_record)
        response = self._read_catalog(manifest_pin)
        self.assertEqual(response.returncode, 0, response.stderr)
        records = json.loads(response.stdout)
        self.assertEqual(len(records), 1)
        item = records[0]
        self.assertEqual(item["candidateId"], candidate_record["candidateId"])
        self.assertEqual([x["index"] for x in item["indices"]], [
            "ndvi", "ndre", "gndvi", "osavi",
        ])
        self.assertAlmostEqual(item["indices"][0]["mean"], 0.5, places=4)
        self.assertIs(item["recordSha256VerifiedAtRead"], True)
        self.assertIs(item["rasterQaRecheckedAtRead"], False)
        for field in ("operationalUseAllowed", "prescriptionExportAllowed", "flightMissionAllowed"):
            self.assertIs(item[field], False)
        self.assertNotIn(str(self.root), response.stdout)
        self.assertNotIn(trusted_pin, response.stdout)
        self.assertNotIn("geolocation", response.stdout.lower())

    def test_modified_raster_after_sealing_refuses_private_candidate(self):
        self._pipeline()
        trusted_pin = self._seal()
        with (self.bundle / "indices" / "ndvi.tif").open("ab") as stream:
            stream.write(b"tampered-after-qa")
        with self.assertRaises(ValueError):
            self._candidate(trusted_pin)
        self.assertFalse(self.candidate.exists())
        self.assertFalse(self.catalog.exists())

    def test_pinned_node_catalog_rejects_modified_candidate_and_manifest(self):
        self._pipeline()
        trusted_pin = self._seal()
        record = self._candidate(trusted_pin)
        manifest_pin, candidate_copy = self._catalog(record)
        self.assertEqual(self._read_catalog(manifest_pin).returncode, 0)
        with candidate_copy.open("ab") as stream:
            stream.write(b" ")
        response = self._read_catalog(manifest_pin)
        self.assertEqual(response.returncode, 3)
        self.assertEqual(response.stderr, "CATALOG_REFUSED")
        # Even restoring the candidate does not permit an unpinned manifest.
        shutil.copyfile(self.candidate / "candidate.json", candidate_copy)
        with (self.catalog / "catalog-manifest.json").open("ab") as stream:
            stream.write(b" ")
        response = self._read_catalog(manifest_pin)
        self.assertEqual(response.returncode, 3)
        self.assertEqual(response.stderr, "CATALOG_REFUSED")


if __name__ == "__main__":
    unittest.main()
