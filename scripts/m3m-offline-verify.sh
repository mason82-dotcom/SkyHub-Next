#!/usr/bin/env bash
# SkyHub M3M synthetic tests in an explicitly opted-in LINKED worktree only.
# Does not install packages, start containers, contact drones or read live media.
set -euo pipefail

if [[ "${SKYHUB_M3M_OFFLINE_LAB:-}" != "1" ]]; then
  echo "M3M LAB REFUSED: explicit SKYHUB_M3M_OFFLINE_LAB=1 required" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
root="$(cd -- "$script_dir/.." && pwd -P)"

# A linked Git worktree has a .git FILE; the primary checkout has a .git
# DIRECTORY. Refuse primary checkouts even with the explicit opt-in variable.
if [[ ! -f "$root/.git" ]] ||
   [[ "$(git -C "$root" rev-parse --show-toplevel 2>/dev/null || :)" != "$root" ]]; then
  echo "M3M LAB REFUSED: a separate linked Git worktree is required" >&2
  exit 2
fi

python_bin="${SKYHUB_M3M_TEST_PYTHON:-python3}"
node_bin="${SKYHUB_M3M_TEST_NODE:-node}"
if ! "$python_bin" -c 'import sys; raise SystemExit(0 if sys.prefix != sys.base_prefix else 2)' >/dev/null 2>&1; then
  echo "M3M LAB REFUSED: Python must run in an isolated virtual environment" >&2
  exit 2
fi
if ! "$python_bin" -c 'import numpy, rasterio, tifffile, defusedxml' >/dev/null 2>&1; then
  echo "M3M LAB REFUSED: optional binary raster dependencies are missing" >&2
  exit 2
fi
if [[ ! -d "$root/backend/node_modules" ]] || [[ -L "$root/backend/node_modules" ]]; then
  echo "M3M LAB REFUSED: own non-symlink backend/node_modules required" >&2
  exit 2
fi
if ! command -v "$node_bin" >/dev/null 2>&1; then
  echo "M3M LAB REFUSED: Node.js unavailable" >&2
  exit 2
fi

cd -- "$root"
"$python_bin" -m compileall -q backend/workers
"$python_bin" -m unittest discover -s tests -p 'test_m3m_*.py' -v
"$node_bin" --check backend/smart-farming-catalog.js
"$node_bin" --check frontend/public/smart-farming-ui.js
"$node_bin" --test \
  backend/test/smart-farming-catalog.test.js \
  backend/test/smart-farming-catalog-http.test.js \
  frontend/test/smart-farming-ui.test.js

# The scientific and operating claims must remain *explicitly* fail-closed.
for flag in operationalUseAllowed prescriptionExportAllowed flightMissionAllowed; do
  grep -Fq "'${flag}': False" backend/workers/m3m_smart_farming_candidate.py
done
printf '%s\n' 'M3M synthetic offline review PASS — not hardware, DEDAL or calibration acceptance'
