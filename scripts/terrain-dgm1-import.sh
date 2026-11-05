#!/usr/bin/env bash
# DGM1 of the LGL Baden-Württemberg (1 m terrain model, Open Data, Datenlizenz Deutschland – Namensnennung 2.0:
# "Datenquelle: LGL, www.lgl-bw.de, dl-de/by-2-0") as a second dataset for the own terrain service (Open Topo Data).
# Download the 2 km x 2 km tiles in the Open GeoData portal (https://opengeodata.lgl-bw.de, product "DGM1", files
# dgm1_32_<E>_<N>_2_bw.zip), copy the ZIPs to ops/terrain/dgm1-zips/ and run on brix-node:
#   bash scripts/terrain-dgm1-import.sh
# Each ZIP may hold the DGM1 as XYZ text (x y z, ETRS89/UTM 32N, 1 m) or as GeoTIFF (LGL raster delivery since March 2026).
# Heights: NHN (DHHN2016), terrain only (no buildings, trees, masts). Result: ops/terrain/data/dgm1/*.tif (Float32, LZW),
# ops/terrain/data/dgm1vrt/dgm1.vrt and config.yaml with datasets dgm1 + cop30. The backend then asks "dgm1,cop30":
# Open Topo Data answers from DGM1 where tiles exist and falls back to Copernicus elsewhere.
# Nothing leaves the machine: the conversion runs in the Open Topo Data image without network.
set -Eeuo pipefail
cd "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DIR=${SKYHUB_TERRAIN_DIR:-ops/terrain}; IN=$DIR/dgm1-zips
shopt -s nullglob; zips=("$IN"/*.zip); shopt -u nullglob
(( ${#zips[@]} )) || { echo "Keine ZIPs in $IN (DGM1-Kacheln aus https://opengeodata.lgl-bw.de dorthin kopieren)" >&2; exit 2; }
[[ -d "$DIR/data/cop30vrt" ]] || { echo "Copernicus-Datensatz fehlt (zuerst scripts/terrain-dem-fetch.sh)" >&2; exit 2; }
mkdir -p "$DIR/data/dgm1" "$DIR/data/dgm1vrt"
IMAGE=${SKYHUB_TERRAIN_IMAGE:-skyhub-opentopodata:1.10.0}
docker run -i --rm --network none -v "$PWD/$IN:/in:ro" -v "$PWD/$DIR/data:/d" "$IMAGE" python3 - <<'PY'
import glob,io,os,re,zipfile
import numpy as np,rasterio
from rasterio.transform import from_origin
CRS='EPSG:25832'; NODATA=-9999.0
done=skipped=0
for z in sorted(glob.glob('/in/*.zip')):
    name=os.path.basename(z)
    m=re.match(r'dgm1_(\d+)_(\d+)_(\d+)_(\d+)_bw\.zip$',name,re.I)
    if not m: print('übersprungen (Name):',name); skipped+=1; continue
    out='/d/dgm1/dgm1_%s_%s_%s.tif'%(m.group(1),m.group(2),m.group(3))
    if os.path.exists(out): print('vorhanden:',name); done+=1; continue
    with zipfile.ZipFile(z) as zf:
        members=[i for i in zf.infolist() if not i.is_dir()]
        tifs=[i for i in members if i.filename.lower().endswith(('.tif','.tiff'))]
        xyzs=[i for i in members if i.filename.lower().endswith(('.xyz','.txt'))]
        if tifs:
            with rasterio.open(io.BytesIO(zf.read(tifs[0]))) as src:
                data=src.read(1).astype('float32'); transform=src.transform; crs=src.crs or CRS
                if src.nodata is not None: data[data==src.nodata]=NODATA
        elif xyzs:
            arr=np.loadtxt(io.TextIOWrapper(zf.open(xyzs[0]),encoding='latin-1'),dtype='float64')
            if arr.ndim!=2 or arr.shape[1]<3: raise SystemExit('XYZ unlesbar: '+name)
            xs=np.unique(arr[:,0]); ys=np.unique(arr[:,1])
            step=float(np.median(np.diff(xs)))
            if abs(step-1.0)>1e-6: raise SystemExit('Rasterweite %.3f m statt 1 m: %s'%(step,name))
            # XYZ = heights at pixel centres → raster with origin half a pixel up/left
            x0=xs.min()-0.5; y1=ys.max()+0.5
            W=int(round(xs.max()-xs.min()))+1; H=int(round(ys.max()-ys.min()))+1
            data=np.full((H,W),NODATA,dtype='float32')
            col=np.rint(arr[:,0]-xs.min()).astype(int); row=np.rint(ys.max()-arr[:,1]).astype(int)
            data[row,col]=arr[:,2].astype('float32')
            transform=from_origin(x0,y1,1.0,1.0); crs=CRS
        else:
            print('übersprungen (kein XYZ/GeoTIFF):',name); skipped+=1; continue
    valid=data[data!=NODATA]
    if valid.size==0 or valid.min()<-100 or valid.max()>5000: raise SystemExit('unplausible Höhen in '+name)
    with rasterio.open(out+'.part','w',driver='GTiff',width=data.shape[1],height=data.shape[0],count=1,dtype='float32',
                       crs=crs,transform=transform,nodata=NODATA,compress='lzw',tiled=True,blockxsize=256,blockysize=256) as dst:
        dst.write(data,1)
    os.replace(out+'.part',out); done+=1
    print('umgewandelt: %s (%dx%d, %.1f..%.1f m NHN)'%(name,data.shape[1],data.shape[0],valid.min(),valid.max()))
files=sorted(glob.glob('/d/dgm1/*.tif'))
if not files: raise SystemExit('keine DGM1-Kacheln')
srcs=[rasterio.open(f) for f in files]
left=min(s.bounds.left for s in srcs);right=max(s.bounds.right for s in srcs)
bottom=min(s.bounds.bottom for s in srcs);top=max(s.bounds.top for s in srcs)
W=int(round(right-left));H=int(round(top-bottom))
out=['<VRTDataset rasterXSize="%d" rasterYSize="%d">'%(W,H),'<SRS>EPSG:25832</SRS>',
     '<GeoTransform>%.3f, 1, 0, %.3f, 0, -1</GeoTransform>'%(left,top),
     '<VRTRasterBand dataType="Float32" band="1"><NoDataValue>%g</NoDataValue>'%NODATA]
for f,s in zip(files,srcs):
    if abs(s.res[0]-1)>1e-9 or abs(s.res[1]-1)>1e-9: raise SystemExit('Rasterweite nicht 1 m: '+f)
    out.append('<SimpleSource><SourceFilename relativeToVRT="1">../dgm1/%s</SourceFilename><SourceBand>1</SourceBand>'
      '<SrcRect xOff="0" yOff="0" xSize="%d" ySize="%d"/><DstRect xOff="%d" yOff="%d" xSize="%d" ySize="%d"/></SimpleSource>'
      %(os.path.basename(f),s.width,s.height,int(round(s.bounds.left-left)),int(round(top-s.bounds.top)),s.width,s.height))
out+=['</VRTRasterBand>','</VRTDataset>']
open('/d/dgm1vrt/dgm1.vrt','w').write('\n'.join(out)+'\n')
print('DGM1: %d Kacheln (%d übersprungen), Mosaik %d x %d m'%(len(files),skipped,W,H))
PY
[[ -s "$DIR/data/dgm1vrt/dgm1.vrt" ]] || { echo "DGM1-Mosaik fehlt" >&2; exit 4; }
cat > "$DIR/config.yaml" <<'YAML'
# Written by scripts/terrain-dgm1-import.sh. Open Topo Data configuration for SkyHub (terrain check, profiles).
# Query "dgm1,cop30": DGM1 (LGL, 1 m, terrain) where tiles exist, otherwise Copernicus GLO-30 (30 m, surface).
max_locations_per_request: 100
access_control_allow_origin: null
datasets:
- name: dgm1
  path: data/dgm1vrt/
- name: cop30
  path: data/cop30vrt/
YAML
echo "Fertig. In .env: SKYHUB_TERRAIN_DATASET=dgm1,cop30 – danach: bash scripts/brix-compose.sh up -d --no-deps opentopodata backend"
