# AeroNexus P5 – Isolated Metashape/GeoTIFF groundwork

Based on bounded-export concepts in AeroNexusAdvanced `metashape_bridge.py`, and raster visualisation in `raster_results.py`.
Pure offline helpers: hash-pinned ZIP handoff of whitelisted **flat local files**, plus a
256×256 grayscale/alpha PNG numerical-raster preview function. No Metashape licence/binary,
no COG reader, no CRS mapping, no API, no S3 access and no package upload.
All generated reports are **unverified**. This PR is groundwork, not a complete GeoTIFF/COG
viewer or automatic Metashape processing system.

Run: `python3 -m unittest tests/test_aeronexus_p5_geo.py`.
Only private (0700) operator input/output directories; writes new ZIP into output, never originals.
More work required before import/export into SkyHub: validated capture grouping,
remote worker authentication, checksum recheck, CRS/COG QA, resource quotas and UI/RBAC.
