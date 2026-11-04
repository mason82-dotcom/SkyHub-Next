#!/usr/bin/env bash
# Elevation model for the own terrain service (compose profile "terrain", Open Topo Data).
# Downloads Copernicus DEM GLO-30 tiles (1°x1°, ~30 m, public AWS bucket, no login) for a lat/lon box into
# ops/terrain/data/cop30/ as N49E008.tif etc. and writes ops/terrain/config.yaml.
#   bash scripts/terrain-dem-fetch.sh 48 49 7 9        # latitude 48..49, longitude 7..9 (integer degrees, inclusive)
# Licence: Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under
# COPERNICUS by the European Union and ESA; all rights reserved. Free use with this attribution.
# Note: Copernicus GLO-30 is a SURFACE model (DSM): forests and large buildings are partly included.
# Only the tile names (= the region) are visible to the download server; no route data is sent.
set -Eeuo pipefail
cd "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
LAT0="${1:?Breite von}"; LAT1="${2:?Breite bis}"; LON0="${3:?Länge von}"; LON1="${4:?Länge bis}"
for v in "$LAT0" "$LAT1" "$LON0" "$LON1"; do [[ "$v" =~ ^-?[0-9]{1,3}$ ]] || { echo "ganze Grad erwartet: $v" >&2; exit 2; }; done
(( LAT0<=LAT1 && LON0<=LON1 && LAT1-LAT0<=4 && LON1-LON0<=4 )) || { echo "höchstens 5x5 Kacheln, von <= bis" >&2; exit 2; }
DIR=ops/terrain; OUT=$DIR/data/cop30; mkdir -p "$OUT"
BASE=https://copernicus-dem-30m.s3.amazonaws.com
tag(){ local v=$1 p=$2 n=$3; if (( v<0 )); then printf '%s%0*d' "$n" "$4" $(( -v )); else printf '%s%0*d' "$p" "$4" "$v"; fi; }
count=0
for (( la=LAT0; la<=LAT1; la++ )); do for (( lo=LON0; lo<=LON1; lo++ )); do
  ns=$(tag $la N S 2); ew=$(tag $lo E W 3)
  name="Copernicus_DSM_COG_10_${ns}_00_${ew}_00_DEM"; target="$OUT/${ns}${ew}.tif"
  if [[ -s "$target" ]]; then echo "vorhanden: ${ns}${ew}"; count=$((count+1)); continue; fi
  tmp="$target.part"
  if ! curl -fsS --retry 3 --max-time 600 -o "$tmp" "$BASE/$name/$name.tif"; then
    rm -f "$tmp"; echo "keine Kachel (Meer oder außerhalb): ${ns}${ew}"; continue
  fi
  # GeoTIFF magic (II*\0 or MM\0*) and a plausible size.
  magic=$(head -c 4 "$tmp" | od -An -tx1 | tr -d ' \n')
  size=$(stat -c %s "$tmp")
  if [[ "$magic" != "49492a00" && "$magic" != "4d4d002a" ]] || (( size < 100000 )); then
    rm -f "$tmp"; echo "ungültige Datei verworfen: ${ns}${ew}" >&2; exit 3
  fi
  mv "$tmp" "$target"; count=$((count+1)); echo "geladen: ${ns}${ew} ($((size/1048576)) MiB)"
done; done
(( count>0 )) || { echo "keine Kacheln geladen" >&2; exit 3; }
cat > "$DIR/config.yaml" <<'YAML'
# Written by scripts/terrain-dem-fetch.sh. Open Topo Data configuration for SkyHub (terrain check of the release).
max_locations_per_request: 100
access_control_allow_origin: null
datasets:
- name: cop30
  path: data/cop30/
  filename_epsg: 4326
  filename_tile_size: 1
YAML
echo "Fertig: $count Kachel(n) in $OUT, Konfiguration $DIR/config.yaml (Datensatz cop30)."
echo "Backend: SKYHUB_TERRAIN_URL=http://opentopodata:5000  SKYHUB_TERRAIN_DATASET=cop30"
