#!/usr/bin/env bash
# DGM1 (LGL Baden-Württemberg, 1 m terrain) for a lat/lon box from the LGL INSPIRE WCS, then the mosaic of
# scripts/terrain-dgm1-import.sh (dataset "dgm1", query "dgm1,cop30" with Copernicus fallback).
#   bash scripts/terrain-dgm1-wcs.sh 49.10 49.20 8.50 8.65      # lat from/to, lon from/to (decimal degrees)
# Service (GDI-BW metadata e54f2396-1ce0-4f73-b47a-56d2b3c55c27): https://owsproxy.lgl-bw.de/owsproxy/wcs/
#   WCS_INSP_BW_Hoehe_Coverage_DGM1, coverage EL.ElevationGridCoverage, EPSG:25832, no login.
# Licence: Datenlizenz Deutschland – Namensnennung 2.0 (dl-de/by-2-0), credit e.g. "LGL-BW (2026) Datenlizenz Deutschland –
# Namensnennung – Version 2.0, www.lgl-bw.de". The WCS delivers whole metres (uint16) and 999 px per 1000 m; heights NHN.
# Only the tile boxes (= the region) are sent to the LGL; no route data. At most 400 km² per run; existing tiles are kept.
set -Eeuo pipefail
cd "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
LAT0="${1:?Breite von}"; LAT1="${2:?Breite bis}"; LON0="${3:?Länge von}"; LON1="${4:?Länge bis}"
for v in "$LAT0" "$LAT1" "$LON0" "$LON1"; do [[ "$v" =~ ^[0-9]{1,2}(\.[0-9]+)?$ ]] || { echo "Dezimalgrad erwartet: $v" >&2; exit 2; }; done
DIR=${SKYHUB_TERRAIN_DIR:-ops/terrain}; RAW=$DIR/data/dgm1-wcs-raw
IMAGE=${SKYHUB_TERRAIN_IMAGE:-skyhub-opentopodata:1.10.0}
WCS='https://owsproxy.lgl-bw.de/owsproxy/wcs/WCS_INSP_BW_Hoehe_Coverage_DGM1'
mkdir -p "$RAW" "$DIR/data/dgm1"
DIRABS=$(cd "$DIR" && pwd)   # absolute: docker bind mounts need it (SKYHUB_TERRAIN_DIR may be absolute)
# 1 km tiles (UTM 32N) covering the box, computed offline in the Open Topo Data image (pyproj).
tiles=$(docker run -i --rm --network none "$IMAGE" python3 - "$LAT0" "$LAT1" "$LON0" "$LON1" <<'PY'
import sys,math
from pyproj import Transformer
la0,la1,lo0,lo1=map(float,sys.argv[1:5])
if not (47.4<=la0<la1<=49.9 and 7.4<=lo0<lo1<=10.6): raise SystemExit('Box außerhalb Baden-Württembergs oder leer')
t=Transformer.from_crs('EPSG:4326','EPSG:25832',always_xy=True)
xs,ys=zip(*[t.transform(lo,la) for la in (la0,la1) for lo in (lo0,lo1)])
e0,e1=int(math.floor(min(xs)/1000)),int(math.ceil(max(xs)/1000)); n0,n1=int(math.floor(min(ys)/1000)),int(math.ceil(max(ys)/1000))
if (e1-e0)*(n1-n0)>400: raise SystemExit('mehr als 400 km² – kleinere Box wählen (%d Kacheln)'%((e1-e0)*(n1-n0)))
for e in range(e0,e1):
    for n in range(n0,n1): print(e,n)
PY
)
count=0; got=0
while read -r e n; do
  count=$((count+1)); out="$RAW/${e}_${n}.tif"
  [[ -s "$out" ]] && continue
  E0=$((e*1000)); N0=$((n*1000))
  url="$WCS?request=GetCoverage&service=WCS&version=2.0.1&coverageId=EL.ElevationGridCoverage&FORMAT=image/tiff"
  url+="&subset=E,http://www.opengis.net/def/crs/EPSG/0/25832($E0,$((E0+1000)))&subset=N,http://www.opengis.net/def/crs/EPSG/0/25832($N0,$((N0+1000)))"
  if curl -fsS --retry 3 --max-time 120 -o "$out.part" "$url" && [[ "$(head -c 2 "$out.part")" == "MM" || "$(head -c 2 "$out.part")" == "II" ]]; then
    mv "$out.part" "$out"; got=$((got+1))
  else rm -f "$out.part"; echo "keine Daten: Kachel ${e}_${n}" >&2; fi
  sleep 0.2   # gentle on the public service
done <<< "$tiles"
echo "WCS: $count Kachel(n) im Bereich, $got neu geladen."
# uint16 metres (0 = no data) → Float32 GeoTIFF, LZW, nodata -9999, named for the mosaic step.
docker run -i --rm --network none -v "$DIRABS/data:/d" "$IMAGE" python3 - <<'PY'
import glob,os,numpy as np,rasterio
for f in sorted(glob.glob('/d/dgm1-wcs-raw/*.tif')):
    out='/d/dgm1/dgm1_wcs_'+os.path.basename(f)
    if os.path.exists(out): continue
    with rasterio.open(f) as s:
        a=s.read(1).astype('float32'); a[a==0]=-9999.0
        prof=dict(driver='GTiff',width=s.width,height=s.height,count=1,dtype='float32',crs=s.crs or 'EPSG:25832',transform=s.transform,
                  nodata=-9999.0,compress='lzw',tiled=True,blockxsize=256,blockysize=256)
    with rasterio.open(out+'.part','w',**prof) as d: d.write(a,1)
    os.replace(out+'.part',out)
print('umgewandelt')
PY
bash scripts/terrain-dgm1-import.sh
