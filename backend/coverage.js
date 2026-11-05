'use strict';
// Photo coverage after a flight (idea: flight gap detection of hotosm/drone-tm, own implementation): ground footprint of
// every photo from DJI XMP (GPS, RelativeAltitude, gimbal yaw/pitch/roll) and EXIF (35 mm equivalent focal length, pixel
// size), projected onto a level ground plane through the four image corners (nadir and oblique). Height: RelativeAltitude,
// i.e. above the TAKE-OFF point – a photo does not say where that was, so terrain is not corrected (stated in the result).
// Counts per grid cell → coverage statistics and gap clusters inside the area flown over (hull of the photo positions).
// A planning aid, not a photogrammetric quality check (no image overlap matching, no blur/exposure assessment).
const RAD=Math.PI/180,R=6371008.8;

// --- EXIF: FocalLengthIn35mmFilm (0xA405), PixelXDimension (0xA002), PixelYDimension (0xA003) --------------------------
function exifInfo(buf){
  let p=2;
  while(p+4<=buf.length&&buf[p]===0xFF){
    const m=buf[p+1],len=buf.readUInt16BE(p+2);
    if(m===0xE1&&buf.toString('latin1',p+4,p+10)==='Exif\0\0')return tiff(buf.subarray(p+10,p+2+len));
    if(m===0xDA)break;
    p+=2+len;
  }
  return {};
}
function tiff(t){
  if(t.length<8)return {};
  const le=t.toString('latin1',0,2)==='II';
  const u16=o=>le?t.readUInt16LE(o):t.readUInt16BE(o),u32=o=>le?t.readUInt32LE(o):t.readUInt32BE(o);
  const ifd=(off,want)=>{
    const out={};
    if(off<8||off+2>t.length)return out;
    const n=u16(off);
    for(let i=0;i<n&&off+2+i*12+12<=t.length;i++){
      const e=off+2+i*12,tag=u16(e),type=u16(e+2);
      if(!want.includes(tag))continue;
      out[tag]=type===3?u16(e+8):type===4?u32(e+8):null;
    }
    return out;
  };
  const ifd0=ifd(u32(4),[0x8769]);
  if(!ifd0[0x8769])return {};
  const ex=ifd(ifd0[0x8769],[0xA405,0xA002,0xA003]);
  return {focal35:ex[0xA405]||null,width:ex[0xA002]||null,height:ex[0xA003]||null};
}

// --- DJI XMP ------------------------------------------------------------------------------------------------------------
function xmpInfo(buf){
  const s=buf.toString('latin1');
  const i=s.indexOf('<x:xmpmeta'),j=s.indexOf('</x:xmpmeta>',i);
  if(i<0||j<0)return null;
  const x=s.slice(i,j);
  const num=name=>{const m=x.match(new RegExp('drone-dji:'+name+'="([-+]?[\\d.]+)"'));return m?Number(m[1]):null;};
  const model=(x.match(/drone-dji:DroneModel="([^"]{1,20})"/)||x.match(/tiff:Model="([^"]{1,20})"/)||[])[1]||null;
  return {lat:num('GpsLatitude'),lon:num('GpsLongitude'),relAlt:num('RelativeAltitude'),
    yaw:num('GimbalYawDegree'),pitch:num('GimbalPitchDegree'),roll:num('GimbalRollDegree')??0,model};
}
function photoInfo(header){
  const x=xmpInfo(header);
  if(!x||![x.lat,x.lon,x.relAlt,x.yaw,x.pitch].every(Number.isFinite))return null;
  const e=exifInfo(header);
  return {...x,focal35:e.focal35,width:e.width,height:e.height};
}

// --- footprint: rays through the image corners onto the ground plane ----------------------------------------------------
// Camera frame: forward = viewing direction, right, up. Gimbal yaw is absolute (0 = north, clockwise), pitch -90 = nadir.
function footprint(info,{aglM,maxRangeFactor=4}={}){
  const h=aglM??info.relAlt;
  if(!(h>1))return null;
  const f35=info.focal35||24;                       // DJI wide cameras of M3E/M3M/M4E/M4T: 24 mm equivalent (fallback)
  const aspect=info.width&&info.height?info.width/info.height:4/3;
  // 35 mm equivalent refers to the diagonal (43.27 mm): half-angles of the image sides
  const diag=Math.hypot(36,24),halfW=diag/2*aspect/Math.hypot(aspect,1)/f35,halfH=diag/2/Math.hypot(aspect,1)/f35;
  const yaw=info.yaw*RAD,pitch=info.pitch*RAD,roll=info.roll*RAD;
  // forward vector (east, north, up)
  const fwd=[Math.cos(pitch)*Math.sin(yaw),Math.cos(pitch)*Math.cos(yaw),Math.sin(pitch)];
  let right=[Math.cos(yaw),-Math.sin(yaw),0];
  // up = right × forward (nadir, heading north: image top points north)
  let up=[right[1]*fwd[2]-right[2]*fwd[1],right[2]*fwd[0]-right[0]*fwd[2],right[0]*fwd[1]-right[1]*fwd[0]];
  if(roll){const c=Math.cos(roll),s=Math.sin(roll);const r2=right.map((v,i)=>c*v+s*up[i]),u2=up.map((v,i)=>-s*right[i]+c*v);right=r2;up=u2;}
  const corners=[];
  for(const [sx,sy] of [[-1,1],[1,1],[1,-1],[-1,-1]]){
    const d=fwd.map((v,i)=>v+sx*halfW*right[i]+sy*halfH*up[i]);
    // ray (0,0,h) + t·d hits z=0 at t=-h/dz; rays at or above the horizon are capped at maxRangeFactor·h
    let t=d[2]<-1e-6?-h/d[2]:Infinity;
    const horiz=Math.hypot(d[0],d[1])*t;
    if(!Number.isFinite(t)||horiz>maxRangeFactor*h)t=maxRangeFactor*h/Math.max(1e-9,Math.hypot(d[0],d[1]));
    corners.push([d[0]*t,d[1]*t]);                  // metres east/north of the photo position
  }
  return corners;
}

// --- grid ---------------------------------------------------------------------------------------------------------------
function inPoly(x,y,poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const [xi,yi]=poly[i],[xj,yj]=poly[j];
    if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))inside=!inside;
  }
  return inside;
}
function hull(points){
  const p=[...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  if(p.length<3)return p;
  const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lo=[],hi=[];
  for(const q of p){while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],q)<=0)lo.pop();lo.push(q);}
  for(const q of p.slice().reverse()){while(hi.length>=2&&cross(hi[hi.length-2],hi[hi.length-1],q)<=0)hi.pop();hi.push(q);}
  return lo.slice(0,-1).concat(hi.slice(0,-1));
}

// photos: [{name, info, groundM?}] (groundM: ground height difference to the take-off point, + = ground higher)
function computeCoverage(photos,{cellM=2,maxCells=2_000_000,minOverlap=5}={}){
  const usable=photos.filter(p=>p.info);
  if(usable.length<2)return {status:'skipped',reason:'fewer than two photos with position'};
  const lat0=usable.reduce((s,p)=>s+p.info.lat,0)/usable.length,lon0=usable.reduce((s,p)=>s+p.info.lon,0)/usable.length;
  const kx=Math.cos(lat0*RAD)*RAD*R,ky=RAD*R;
  const toXY=(lat,lon)=>[(lon-lon0)*kx,(lat-lat0)*ky],toLL=(x,y)=>[lat0+y/ky,lon0+x/kx];
  const prints=[],skipped=[],level=[];
  for(const p of usable){
    // Photos less than 30° below the horizon (e.g. a level test shot) are not survey photos: not counted.
    if(p.info.pitch>-30){level.push(p.name);continue;}
    const c=toXY(p.info.lat,p.info.lon),agl=p.info.relAlt-(p.groundM||0);
    const fp=footprint(p.info,{aglM:agl});
    if(!fp){skipped.push(p.name);continue;}
    prints.push({name:p.name,center:c,poly:fp.map(([x,y])=>[x+c[0],y+c[1]]),agl,oblique:p.info.pitch>-80});
  }
  if(!prints.length)return {status:'skipped',reason:'no usable footprints'};
  // grid over all footprints
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const f of prints)for(const [x,y] of f.poly){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  let cell=cellM,W=Math.ceil((maxX-minX)/cell),H=Math.ceil((maxY-minY)/cell);
  while(W*H>maxCells){cell*=1.5;W=Math.ceil((maxX-minX)/cell);H=Math.ceil((maxY-minY)/cell);}
  const counts=new Uint16Array(W*H);
  for(const f of prints){
    let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;
    for(const [x,y] of f.poly){a=Math.min(a,x);b=Math.min(b,y);c=Math.max(c,x);d=Math.max(d,y);}
    const i0=Math.max(0,Math.floor((a-minX)/cell)),i1=Math.min(W-1,Math.floor((c-minX)/cell));
    const j0=Math.max(0,Math.floor((b-minY)/cell)),j1=Math.min(H-1,Math.floor((d-minY)/cell));
    for(let j=j0;j<=j1;j++){const y=minY+(j+0.5)*cell;for(let i=i0;i<=i1;i++){if(inPoly(minX+(i+0.5)*cell,y,f.poly)&&counts[j*W+i]<65535)counts[j*W+i]++;}}
  }
  // Area of interest: convex hull of the photo positions (so a missing flight line between two strips IS a gap), without
  // isolated positions – e.g. a test shot at the take-off point – which would add a sliver as a false gap.
  const nn=prints.map((f,i)=>{let m=Infinity;for(let k=0;k<prints.length;k++)if(k!==i)m=Math.min(m,Math.hypot(f.center[0]-prints[k].center[0],f.center[1]-prints[k].center[1]));return m;});
  const nnMed=[...nn].sort((a,b)=>a-b)[Math.floor(nn.length/2)];
  const core=prints.filter((f,i)=>nn[i]<=Math.max(10*nnMed,30));
  const aoi=hull((core.length>=3?core:prints).map(f=>f.center));
  const inside=new Uint8Array(W*H);let aoiCells=0;
  for(let j=0;j<H;j++)for(let i=0;i<W;i++){if(aoi.length>=3&&inPoly(minX+(i+0.5)*cell,minY+(j+0.5)*cell,aoi)){inside[j*W+i]=1;aoiCells++;}}
  const hist={zero:0,low:0,ok:0};
  for(let k=0;k<W*H;k++)if(inside[k]){const n=counts[k];if(n===0)hist.zero++;else if(n<minOverlap)hist.low++;else hist.ok++;}
  // gap clusters: 4-connected zero cells inside the AOI
  const seen=new Uint8Array(W*H),gaps=[];
  for(let k=0;k<W*H;k++){
    if(!inside[k]||counts[k]!==0||seen[k])continue;
    const stack=[k];seen[k]=1;let n=0,sx=0,sy=0;
    while(stack.length){const q=stack.pop();n++;const i=q%W,j=(q-i)/W;sx+=i;sy+=j;
      for(const r of [i>0?q-1:-1,i<W-1?q+1:-1,j>0?q-W:-1,j<H-1?q+W:-1])if(r>=0&&inside[r]&&counts[r]===0&&!seen[r]){seen[r]=1;stack.push(r);}}
    const areaM2=n*cell*cell;
    if(areaM2>=25){const [la,lo]=toLL(minX+(sx/n+0.5)*cell,minY+(sy/n+0.5)*cell);gaps.push({areaM2:Math.round(areaM2),lat:+la.toFixed(6),lon:+lo.toFixed(6)});}
  }
  gaps.sort((a,b)=>b.areaM2-a.areaM2);
  const pct=v=>aoiCells?Math.round(v/aoiCells*1000)/10:0;
  const [south,west]=toLL(minX,minY),[north,east]=toLL(maxX,maxY);
  return {status:'ok',photos:photos.length,used:prints.length,oblique:prints.filter(f=>f.oblique).length,skipped:skipped.length,
    level:level.length,isolated:prints.length-core.length,cellM:Math.round(cell*100)/100,minOverlap,bounds:{south,west,north,east},width:W,height:H,
    counts:Buffer.from(counts.buffer).toString('base64'),
    aoi:aoi.map(([x,y])=>toLL(x,y).map(v=>+v.toFixed(6))),
    stats:{aoiM2:Math.round(aoiCells*cell*cell),uncoveredPct:pct(hist.zero),belowPct:pct(hist.low),okPct:pct(hist.ok)},
    gaps:gaps.slice(0,50),aglM:{min:Math.round(Math.min(...prints.map(f=>f.agl))),max:Math.round(Math.max(...prints.map(f=>f.agl)))}};
}

// HTTP: GET /api/coverage/flights (flights in MinIO, ppk-storage.js), POST /api/coverage/run {flight}. Read-only on storage.
function createCoverageRouter({express,flights,log=console,now=()=>Date.now()}){
  const router=express.Router();
  const cache=new Map();
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.get('/flights',async(_req,res)=>{
    try{res.json({flights:(await flights.list()).filter(f=>f.photos>1).map(f=>({id:f.id,name:f.name,photos:f.photos,startUtc:f.startUtc,position:f.position}))});}
    catch(err){log.error('[coverage]',err.message);res.status(502).json({error:'Speicher nicht lesbar'});}
  });
  router.post('/run',async(req,res)=>{
    const id=req.body&&req.body.flight;
    if(typeof id!=='string'||!/^[0-9a-f]{16}$/.test(id))return res.status(400).json({error:'Flug fehlt'});
    const minOverlap=Number.isInteger(req.body.minOverlap)&&req.body.minOverlap>=1&&req.body.minOverlap<=20?req.body.minOverlap:5;
    const key=id+':'+minOverlap,hit=cache.get(key);
    if(hit&&now()-hit.at<600000)return res.json(hit.result);
    try{
      const {flight,photos}=await flights.photoHeaders(id);
      const result={flight,...computeCoverage(photos.map(p=>({name:p.name,info:p.header?photoInfo(p.header):null})),{minOverlap})};
      cache.set(key,{at:now(),result});if(cache.size>20)cache.delete(cache.keys().next().value);
      res.json(result);
    }catch(err){
      if(err.status)return res.status(err.status).json({error:err.message});
      log.error('[coverage]',err.message);res.status(502).json({error:'Auswertung fehlgeschlagen'});
    }
  });
  return router;
}

module.exports={exifInfo,xmpInfo,photoInfo,footprint,computeCoverage,hull,createCoverageRouter};
