#!/usr/bin/env python3
"""P4 isolated DJI M3M scalar/preprocessing experiment.

Numerical basis: AeroNexusAdvanced multispectral.py. NO verified DJI radiometry,
band co-registration, NDVI, prescription, HTTP, MQTT, S3, or production import.
"""
from __future__ import annotations
import math
from dataclasses import dataclass
from typing import Sequence

MAX_PIXELS = 1024 * 1024
BAND_ORDER = ("Green", "Red", "RedEdge", "NIR")


class M3MLabError(ValueError):
    pass


@dataclass(frozen=True)
class BandCalibration:
    black_level: float
    sensor_gain: float
    exposure_us: float
    gain_adjustment: float
    irradiance: float
    optical_center_x: float
    optical_center_y: float
    vignette: tuple[float, ...]  # order k0..k5, polynomial k5*r**6 + ... + k0*r + 1
    bits: int = 16

    def validate(self, width: int, height: int) -> None:
        scalars = (self.black_level, self.sensor_gain, self.exposure_us,
                   self.gain_adjustment, self.irradiance,
                   self.optical_center_x, self.optical_center_y)
        if not all(math.isfinite(v) for v in scalars):
            raise M3MLabError("Non-finite calibration")
        if not (self.bits == 16 and 0 <= self.black_level < 65535
                and 0 < self.sensor_gain <= 10000
                and 1 <= self.exposure_us <= 100000000
                and 0 < self.gain_adjustment <= 10000
                and 1 < self.irradiance <= 10000000
                and 0 <= self.optical_center_x < width
                and 0 <= self.optical_center_y < height):
            raise M3MLabError("Missing or implausible M3M calibration")
        if len(self.vignette) != 6 or any(not math.isfinite(x) or abs(x) > 1000 for x in self.vignette):
            raise M3MLabError("Invalid vignette coefficients")


def process_band(pixels: Sequence[int], width: int, height: int,
                 calibration: BandCalibration) -> dict:
    if not (type(width) is int and type(height) is int and width > 0 and height > 0
            and width * height <= MAX_PIXELS and len(pixels) == width * height):
        raise M3MLabError("Unexpected raster dimensions")
    calibration.validate(width, height)
    output: list[float | None] = []
    good = 0
    # Fractions resemble relative reflectance after user-supplied corrections,
    # not an independently verified physical reflectance reference.
    for n, raw in enumerate(pixels):
        if type(raw) is not int or raw < 0 or raw > 65535:
            raise M3MLabError("Invalid uint16 pixel")
        if raw <= calibration.black_level or raw >= 65535:
            output.append(None)
            continue
        x = n % width - calibration.optical_center_x
        y = n // width - calibration.optical_center_y
        radius = math.hypot(x, y) / max(width, height)
        factor = 1.0 + sum(k * radius ** (i + 1) for i, k in enumerate(calibration.vignette))
        if not math.isfinite(factor) or factor <= 0:
            raise M3MLabError("Invalid vignetting correction")
        signal = ((raw - calibration.black_level) / (2 ** calibration.bits))
        value = (signal / (calibration.sensor_gain * calibration.exposure_us / 1_000_000.0)
                 * factor * calibration.gain_adjustment / calibration.irradiance)
        if not math.isfinite(value) or value <= 0:
            output.append(None)
            continue
        output.append(value)
        good += 1
    return {
        "schema": "skyhub-aeronexus-m3m-p4-offline-v1",
        "classification": "operator-supplied-calibration-relative-signal",
        "width": width, "height": height, "valid_pixels": good, "values": output,
        "radiometricCalibrationVerified": False,
        "bandCoregistrationVerified": False,
        "reflectanceReady": False,
        "ndviReady": False,
        "flightMissionAllowed": False,
        "prescriptionExportAllowed": False,
    }


def preprocess_capture(bands: dict[str, tuple[Sequence[int], BandCalibration]],
                       width: int, height: int) -> dict:
    if set(bands) != set(BAND_ORDER):
        raise M3MLabError("Exactly four M3M bands required")
    result = {name: process_band(*bands[name][:1], width, height, bands[name][1])
              for name in BAND_ORDER}
    # Values are not co-registered. Indices from these grids would be misleading.
    return {"schema": "skyhub-aeronexus-m3m-capture-p4-v1",
            "bands": result, "bandCoregistrationVerified": False,
            "radiometricCalibrationVerified": False, "ndviReady": False}
