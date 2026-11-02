# AeroNexus P4 – Isoliertes Mavic-3M-Rohsignal-Labor

Unabhängige reine Python-Funktionen; Quelle des Algorithmuskonzepts:
`AeroNexusAdvanced/src/aeronexus/multispectral.py`.

Erfordert vier 16-Bit-Bandraster und vom Operator bereitgestellte, überprüfbare Kalibrierparameter.
Berechnet begrenzte, ungültigkeitsmarkierte numerische relative Signale mit Black-Level,
Gain, Belichtung, Vignettierungskoeffizienten und Bestrahlungswert. Keine DJI-Metadatenextraktion,
keine TIFF-Dekodierung, keine geometrische Bandregistrierung und **keine wissenschaftliche
Reflektanz-Abnahme**. Alle Produktivfreigaben sind false. Kein aktiver CLI-/S3-/Webdienst.
Ein produktiver Roh-TIFF-zu-Index-Workflow braucht zusätzliche unabhängige
DJI-XMP-/DLS-/Panelreferenzen, Bandausrichtung, Quellhashes und Feldvalidierung.

Test: `python3 -m unittest tests/test_aeronexus_p4_m3m.py`.
