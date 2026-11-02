import importlib.util
import pathlib
import unittest

PATH = pathlib.Path(__file__).resolve().parents[1] / "backend/workers/aeronexus_m3m_preprocess_lab.py"
spec = importlib.util.spec_from_file_location("aeronexus_p4_lab", PATH)
module = importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name] = module
spec.loader.exec_module(module)

CAL = module.BandCalibration(black_level=100, sensor_gain=2, exposure_us=10000,
                             gain_adjustment=1, irradiance=100,
                             optical_center_x=0, optical_center_y=0,
                             vignette=(0, 0, 0, 0, 0, 0))

class P4LabTests(unittest.TestCase):
    def test_black_saturation_and_finite_numeric_correction(self):
        report = module.process_band([100, 1100, 65535, 4000], 2, 2, CAL)
        self.assertEqual(report["valid_pixels"], 2)
        self.assertIsNone(report["values"][0])
        self.assertIsNone(report["values"][2])
        self.assertGreater(report["values"][1], 0)
        self.assertFalse(report["radiometricCalibrationVerified"])
        self.assertFalse(report["reflectanceReady"])
        self.assertFalse(report["bandCoregistrationVerified"])

    def test_four_band_gate_and_missing_dls_fail_closed(self):
        values = ([200, 300, 400, 500], CAL)
        all_bands = {name: values for name in module.BAND_ORDER}
        self.assertEqual(len(module.preprocess_capture(all_bands, 2, 2)["bands"]), 4)
        with self.assertRaises(module.M3MLabError):
            module.preprocess_capture({"NIR": values}, 2, 2)
        from dataclasses import replace
        with self.assertRaises(module.M3MLabError):
            module.process_band(values[0], 2, 2, replace(CAL, irradiance=0))
        with self.assertRaises(module.M3MLabError):
            module.process_band([200, -1, 300, 400], 2, 2, CAL)

if __name__ == "__main__":
    unittest.main()
