# AeroNexus P2 – Thermal/PV lab

Independent implementation, deliberately unmounted and without DJI Thermal SDK dependency.
Source concepts: `AeroNexusAdvanced/src/aeronexus/pv_inspection.py`.
Expects an explicitly supplied finite temperature raster, ROI, checksum, and thresholds.
Connected candidate clusters use 4-neighbor adjacency; the ROI median is a heuristic, **not** IEC TS 62446-3 defect classification.
A string naming the SDK cannot establish that the source has been calibrated: all verification flags stay false.
No HTTP endpoint, MinIO write, MQTT action or changes to the existing Thermal SDK PR #265.
Future runtime work requires a verified SDK measurement/ETag binding, environmental gate and real reference-image QA.
Test: `node --test backend/test/aeronexus-pv-lab.test.js`.
