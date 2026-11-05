'use strict';
// NDVI from one Mavic 3M multispectral capture (DJI_<time>_<seq>_MS_R.TIF + _MS_NIR.TIF, 16-bit TIFF with DJI XMP).
// Calibration per DJI's Mavic 3M multispectral image processing guide, each band:
//   1. DN − BlackLevel (XMP drone-dji:BlackLevel, 16-bit scale)
//   2. × vignetting factor 1 + k0·r + k1·r² + … + k5·r⁶ (VignettingData k0..k5, r = pixel distance to CalibratedOpticalCenter)
//   3. ÷ (SensorGain · ExposureTime[µs]·1e-6)
//   4. × SensorGainAdjustment ÷ Irradiance (sunlight sensor) → comparable between bands ("calibrated")
//   Missing or implausible sunlight data → status "relative" (index from steps 1–3 only, not comparable between flights).
// Alignment: each band is warped onto the common reference with its CalibratedHMatrix (band pixel → reference pixel, as
// cv2.warpPerspective in DJI's sample), then a residual shift is searched on gradient images (normalised cross-correlation).
// NDVI = (NIR − R)/(NIR + R); NaN where a band is saturated, at or below black level, or outside the overlap.
// Own implementation (decision 05.11.2026: Node instead of the planned Python worker; inputs are uncompressed 16-bit TIFFs).
const zlib=require('node:zlib');
const {writeTemperatureTiff,crc32}=require('./thermal-export');

// --- TIFF (classic, uncompressed, 16-bit single band) ---------------------------------------------------------------
function readMsTiff(buf){
  if(!Buffer.isBuffer(buf)||buf.length<8)throw new Error('kein TIFF');
  const le=buf.toString('latin1',0,2)==='II';
  if(!le&&buf.toString('latin1',0,2)!=='MM')throw new Error('kein TIFF');
  const u16=o=>le?buf.readUInt16LE(o):buf.readUInt16BE(o),u32=o=>le?buf.readUInt32LE(o):buf.readUInt32BE(o);
  if(u16(2)!==42)throw new Error('kein klassisches TIFF');
  const off=u32(4),n=u16(off),tags={};
  for(let i=0;i<n;i++){
    const e=off+2+i*12,tag=u16(e),type=u16(e+2),count=u32(e+4),size={1:1,2:1,3:2,4:4,16:8}[type]||1;
    const at=count*size<=4?e+8:u32(e+8);
    const vals=[];
    if(type===3)for(let k=0;k<Math.min(count,100000);k++)vals.push(u16(at+2*k));
    else if(type===4)for(let k=0;k<Math.min(count,100000);k++)vals.push(u32(at+4*k));
    else if(type===1||type===2||type===7)tags[tag]={raw:buf.subarray(at,at+count)};
    if(vals.length)tags[tag]=vals;
  }
  const W=tags[256]?.[0],H=tags[257]?.[0];
  if(!W||!H)throw new Error('TIFF ohne Größe');
  if((tags[258]?.[0]??16)!==16||(tags[277]?.[0]??1)!==1)throw new Error('kein 16-bit-Einkanal-TIFF');
  if((tags[259]?.[0]??1)!==1)throw new Error('komprimiertes TIFF wird nicht unterstützt');
  const offs=tags[273],counts=tags[279];
  if(!offs||!counts)throw new Error('TIFF ohne Bilddaten');
  const data=new Uint16Array(W*H);let p=0;
  for(let s=0;s<offs.length&&p<data.length;s++)for(let o=offs[s];o<offs[s]+counts[s]&&p<data.length;o+=2)data[p++]=u16(o);
  if(p!==data.length)throw new Error('TIFF-Bilddaten unvollständig');
  const xmp=tags[700]?.raw?tags[700].raw.toString('utf8'):'';
  return {width:W,height:H,data,xmp};
}

// --- DJI XMP ---------------------------------------------------------------------------------------------------------
function msXmp(xmp){
  const get=n=>{const m=xmp.match(new RegExp('drone-dji:'+n+'="([^"]*)"'));return m?m[1]:null;};
  const num=n=>{const v=get(n);return v!==null&&v!==''&&Number.isFinite(Number(v))?Number(v):null;};
  const list=n=>{const v=get(n);if(!v)return null;const a=v.split(/[ ,]+/).filter(Boolean).map(Number);return a.every(Number.isFinite)?a:null;};
  return {band:get('BandName'),source:get('ImageSource'),model:get('DroneModel'),black:num('BlackLevel'),gain:num('SensorGain'),
    exposureUs:num('ExposureTime'),gainAdj:num('SensorGainAdjustment'),irradiance:num('Irradiance'),vignetting:list('VignettingData'),
    cx:num('CalibratedOpticalCenterX'),cy:num('CalibratedOpticalCenterY'),hMatrix:list('CalibratedHMatrix'),
    lat:num('GpsLatitude'),lon:num('GpsLongitude'),relAlt:num('RelativeAltitude'),pitch:num('GimbalPitchDegree'),utc:get('UTCAtExposure')};
}

// Steps 1–4; returns per-pixel values and the list of missing/implausible calibration terms.
function calibrateBand(img,x){
  const notes=[];
  if(x.black===null)notes.push('BlackLevel fehlt');
  if(!(x.gain>0)||!(x.exposureUs>0))notes.push('Gain/Belichtung fehlt');
  const vig=Array.isArray(x.vignetting)&&x.vignetting.length===6&&Number.isFinite(x.cx)&&Number.isFinite(x.cy)?x.vignetting:null;
  if(!vig)notes.push('Vignettierung fehlt');
  // Irradiance exactly 1.000 is what DJI writes without a valid sunlight-sensor reading (seen on an indoor test capture).
  const sun=x.gainAdj>0&&x.irradiance>0&&Math.abs(x.irradiance-1)>1e-6;
  if(!sun)notes.push('Sonnenlichtsensor ohne Messwert (Irradiance '+(x.irradiance??'–')+')');
  const {width:W,height:H,data}=img,out=new Float32Array(W*H),black=x.black??0;
  const scale=(x.gain>0&&x.exposureUs>0?1/(x.gain*x.exposureUs*1e-6):1)*(sun?x.gainAdj/x.irradiance:1);
  for(let j=0;j<H;j++){
    const dy=j-(x.cy??H/2);
    for(let i=0;i<W;i++){
      const k=j*W+i,dn=data[k];
      if(dn>=65535||dn<=black){out[k]=NaN;continue;}
      let f=1;
      if(vig){const r=Math.hypot(i-x.cx,dy);let rp=r;for(let c=0;c<6;c++){f+=vig[c]*rp;rp*=r;}}
      out[k]=(dn-black)*f*scale;
    }
  }
  return {values:out,notes,calibrated:sun&&notes.length===0};
}

// --- alignment -------------------------------------------------------------------------------------------------------
function invert3(m){
  const [a,b,c,d,e,f,g,h,i]=m,A=e*i-f*h,B=-(d*i-f*g),C=d*h-e*g,det=a*A+b*B+c*C;
  if(!Number.isFinite(det)||Math.abs(det)<1e-12)return null;
  return [A/det,-(b*i-c*h)/det,(b*f-c*e)/det,B/det,(a*i-c*g)/det,-(a*f-c*d)/det,C/det,-(a*h-b*g)/det,(a*e-b*d)/det];
}
// Output pixel (reference grid) ← band pixel via inverse homography, bilinear; dx/dy: extra shift in output pixels.
function warp(values,W,H,hMatrix,dx=0,dy=0){
  const inv=hMatrix?invert3(hMatrix):[1,0,0,0,1,0,0,0,1];
  if(!inv)throw new Error('CalibratedHMatrix nicht invertierbar');
  const out=new Float32Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const X=x-dx,Y=y-dy,w=inv[6]*X+inv[7]*Y+inv[8],sx=(inv[0]*X+inv[1]*Y+inv[2])/w,sy=(inv[3]*X+inv[4]*Y+inv[5])/w;
    const x0=Math.floor(sx),y0=Math.floor(sy);
    if(x0<0||y0<0||x0>=W-1||y0>=H-1){out[y*W+x]=NaN;continue;}
    const fx=sx-x0,fy=sy-y0,p=y0*W+x0;
    out[y*W+x]=values[p]*(1-fx)*(1-fy)+values[p+1]*fx*(1-fy)+values[p+W]*(1-fx)*fy+values[p+W+1]*fx*fy;
  }
  return out;
}
function gradients(v,W,H,step){
  const w=Math.floor(W/step),h=Math.floor(H/step),g=new Float32Array(w*h);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const at=(xx,yy)=>v[yy*step*W+xx*step];
    const gx=at(x+1,y)-at(x-1,y),gy=at(x,y+1)-at(x,y-1);
    g[y*w+x]=Number.isFinite(gx)&&Number.isFinite(gy)?Math.hypot(gx,gy):NaN;
  }
  return {g,w,h};
}
function ncc(a,b,w,h,sx,sy,m){
  let n=0,sa=0,sb=0,saa=0,sbb=0,sab=0;
  for(let y=m;y<h-m;y+=2)for(let x=m;x<w-m;x+=2){
    const va=a[y*w+x],vb=b[(y+sy)*w+x+sx];
    if(!Number.isFinite(va)||!Number.isFinite(vb))continue;
    n++;sa+=va;sb+=vb;saa+=va*va;sbb+=vb*vb;sab+=va*vb;
  }
  if(n<100)return -1;
  const cov=sab-sa*sb/n,da=saa-sa*sa/n,db=sbb-sb*sb/n;
  return da>0&&db>0?cov/Math.sqrt(da*db):-1;
}
// Residual shift of b against a (both on the reference grid): coarse search on 4× reduced gradients, then 1× around it.
function residualShift(a,b,W,H){
  const A4=gradients(a,W,H,4),B4=gradients(b,W,H,4);
  let best={c:-2,x:0,y:0};
  for(let sy=-6;sy<=6;sy++)for(let sx=-6;sx<=6;sx++){const c=ncc(A4.g,B4.g,A4.w,A4.h,sx,sy,8);if(c>best.c)best={c,x:sx,y:sy};}
  const A1=gradients(a,W,H,1),B1=gradients(b,W,H,1);
  let fine={c:-2,x:best.x*4,y:best.y*4};
  for(let sy=best.y*4-3;sy<=best.y*4+3;sy++)for(let sx=best.x*4-3;sx<=best.x*4+3;sx++){
    const c=ncc(A1.g,B1.g,A1.w,A1.h,sx,sy,32);if(c>fine.c)fine={c,x:sx,y:sy};
  }
  return {dx:fine.x,dy:fine.y,correlation:Math.round(fine.c*1000)/1000};
}

// --- NDVI ------------------------------------------------------------------------------------------------------------
function computeNdvi(rBuf,nirBuf,{minCorrelation=0.3}={}){
  const R=readMsTiff(rBuf),N=readMsTiff(nirBuf);
  if(R.width!==N.width||R.height!==N.height)throw new Error('Bänder unterschiedlich groß');
  const xr=msXmp(R.xmp),xn=msXmp(N.xmp);
  // M3M writes BandName "Red" / "NIR" (ImageSource MS_R_CAMERA / MS_NIR_CAMERA).
  const isRed=x=>x.band==='Red'||x.band==='R'||x.source==='MS_R_CAMERA',isNir=x=>x.band==='NIR'||x.source==='MS_NIR_CAMERA';
  if(!isRed(xr)||!isNir(xn))throw new Error('Bänder vertauscht oder falsch (Rot und NIR erwartet)');
  const W=R.width,H=R.height;
  const cr=calibrateBand(R,xr),cn=calibrateBand(N,xn);
  const wr=warp(cr.values,W,H,xr.hMatrix),wn0=warp(cn.values,W,H,xn.hMatrix);
  const shift=residualShift(wr,wn0,W,H);
  const wn=shift.dx||shift.dy?warp(cn.values,W,H,xn.hMatrix,-shift.dx,-shift.dy):wn0;
  const ndvi=new Float32Array(W*H);let valid=0;const hist=new Uint32Array(200);
  for(let k=0;k<ndvi.length;k++){
    const a=wn[k],b=wr[k],s=a+b;
    if(!Number.isFinite(a)||!Number.isFinite(b)||!(s>0)){ndvi[k]=NaN;continue;}
    const v=Math.max(-1,Math.min(1,(a-b)/s));ndvi[k]=v;valid++;hist[Math.min(199,Math.floor((v+1)*100))]++;
  }
  const pct=q=>{let acc=0;const t=valid*q;for(let i=0;i<200;i++){acc+=hist[i];if(acc>=t)return Math.round((i/100-1+0.005)*1000)/1000;}return null;};
  const notes=[...new Set([...cr.notes.map(n=>'R: '+n),...cn.notes.map(n=>'NIR: '+n)])];
  if(!xr.hMatrix||!xn.hMatrix)notes.push('CalibratedHMatrix fehlt: nur Restversatz-Ausrichtung');
  if(shift.correlation<minCorrelation)notes.push('Bandausrichtung unsicher (Korrelation '+shift.correlation+')');
  if(xn.pitch!==null&&xn.pitch>-60)notes.push('Kamera nicht senkrecht (Gimbal '+xn.pitch+'°): NDVI eines Schrägbilds');
  return {width:W,height:H,ndvi,
    summary:{status:cr.calibrated&&cn.calibrated&&shift.correlation>=minCorrelation?'calibrated':'relative',notes,
      validPct:Math.round(valid/ndvi.length*1000)/10,p5:pct(0.05),median:pct(0.5),p95:pct(0.95),
      alignment:shift,model:xn.model,position:Number.isFinite(xn.lat)&&Number.isFinite(xn.lon)&&(Math.abs(xn.lat)>0.01||Math.abs(xn.lon)>0.01)?{lat:xn.lat,lon:xn.lon}:null,
      relAlt:xn.relAlt,utc:xn.utc}};
}

// Colour preview (fixed scale −0.2 … 0.9: brown → yellow → green; NaN transparent), max 1024 px wide, PNG.
function previewPng(ndvi,W,H,maxW=1024){
  const s=Math.max(1,Math.ceil(W/maxW)),w=Math.floor(W/s),h=Math.floor(H/s);
  const stops=[[-0.2,[140,81,10]],[0.1,[216,179,101]],[0.3,[246,232,195]],[0.5,[166,219,160]],[0.7,[90,174,97]],[0.9,[27,120,55]]];
  const color=v=>{if(v<=stops[0][0])return stops[0][1];for(let i=1;i<stops.length;i++)if(v<=stops[i][0]){const [a,ca]=stops[i-1],[b,cb]=stops[i],t=(v-a)/(b-a);return ca.map((c,k)=>Math.round(c+(cb[k]-c)*t));}return stops[stops.length-1][1];};
  const raw=Buffer.alloc(h*(1+w*4));
  for(let y=0;y<h;y++){raw[y*(1+w*4)]=0;for(let x=0;x<w;x++){const v=ndvi[(y*s)*W+x*s],o=y*(1+w*4)+1+x*4;
    if(!Number.isFinite(v)){raw[o+3]=0;continue;}const c=color(v);raw[o]=c[0];raw[o+1]=c[1];raw[o+2]=c[2];raw[o+3]=255;}}
  const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type,'latin1'),data]);
    const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td)>>>0);return Buffer.concat([len,td,crc]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}

function ndviTiff(result){
  const p=result.summary.position;
  return writeTemperatureTiff({width:result.width,height:result.height,temps:result.ndvi,
    meta:{model:result.summary.model,latitude:p?p.lat:null,longitude:p?p.lon:null,datetime:null}});
}

module.exports={readMsTiff,msXmp,calibrateBand,invert3,warp,residualShift,computeNdvi,previewPng,ndviTiff};

// --- HTTP: captures in the media storage (read-only), one NDVI run per request, last 5 results in memory --------------
function createNdviRouter({express,storage,bucket='dji-cloud',log=console}){
  const crypto=require('node:crypto');
  const router=express.Router(),results=new Map();
  let busy=false;
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
  async function listAll(prefix){
    const out=[];let cursor;
    for(let i=0;i<200;i++){const r=await storage.objects(bucket,{prefix,limit:200,...(cursor?{cursor}:{})});out.push(...r.objects);if(!r.truncated)return out;cursor=r.nextCursor;}
    return out;
  }
  // Bands of one capture share drone-dji:CaptureUUID (also when Pilot 2 renamed the upload to org_<fingerprint>_<ms>.tiff).
  // XMP heads of all TIFFs are read once (ranged, 96 KiB) and cached by key + ETag.
  const heads=new Map();
  async function captures(){
    const all=(await listAll('')).filter(o=>/\.tiff?$/i.test(o.key)&&o.size>100000&&o.size<=40*1024*1024);
    const by=new Map();
    for(const o of all){
      const ck=o.key+'|'+(o.etag||o.size);
      let h=heads.get(ck);
      if(!h){
        const b=await read(o.key,'bytes=0-98303');
        const t=b.toString('latin1'),g=n=>{const m=t.match(new RegExp('drone-dji:'+n+'="([^"]*)"'));return m?m[1]:null;};
        h={uuid:g('CaptureUUID'),band:g('BandName'),source:g('ImageSource'),model:g('DroneModel'),utc:g('UTCAtExposure'),irr:Number(g('Irradiance'))};
        heads.set(ck,h);
      }
      if(!h.uuid||!/^[0-9a-f]{32}$/i.test(h.uuid))continue;
      const band=h.band==='Red'||h.source==='MS_R_CAMERA'?'r':h.band==='NIR'||h.source==='MS_NIR_CAMERA'?'nir':
        h.band==='Green'||h.source==='MS_G_CAMERA'?'g':h.band==='RedEdge'||h.source==='MS_RE_CAMERA'?'re':null;
      if(!band)continue;
      if(!by.has(h.uuid))by.set(h.uuid,{bands:{},utc:h.utc,model:h.model,sun:false});
      const c=by.get(h.uuid);c.bands[band]=o;
      if(Number.isFinite(h.irr)&&Math.abs(h.irr-1)>1e-6&&h.irr>0)c.sun=true;
    }
    if(heads.size>2000)heads.clear();
    return [...by].filter(([,c])=>c.bands.r&&c.bands.nir).map(([uuid,c])=>({id:uuid.slice(0,16).toLowerCase(),
      name:(c.utc&&!c.utc.startsWith('1980')?c.utc.slice(0,19).replace('T',' ')+' UTC':'ohne Zeit')+' · '+(c.model||'?'),
      utc:c.utc,sun:c.sun,bandsPresent:Object.keys(c.bands).sort(),r:c.bands.r,nir:c.bands.nir}))
      .sort((a,b)=>String(b.utc).localeCompare(String(a.utc)));
  }
  const read=async(key,range)=>{const o=await storage.getObject(bucket,key,range?{range}:{});const c=[];for await(const x of o.body)c.push(Buffer.from(x));return Buffer.concat(c);};
  router.get('/captures',async(_req,res)=>{
    try{res.json({captures:(await captures()).map(c=>({id:c.id,name:c.name,sun:c.sun,bands:c.bandsPresent,bytes:c.r.size+c.nir.size}))});}
    catch(err){log.error('[ndvi]',err.message);res.status(502).json({error:'Speicher nicht lesbar'});}
  });
  router.post('/run',async(req,res)=>{
    const id=req.body&&req.body.capture;
    if(typeof id!=='string'||!/^[0-9a-f]{16}$/.test(id))return res.status(400).json({error:'Aufnahme fehlt'});
    if(busy)return res.status(429).json({error:'Eine Berechnung läuft schon'});
    busy=true;
    try{
      const c=(await captures()).find(x=>x.id===id);
      if(!c)return res.status(404).json({error:'Aufnahme nicht gefunden'});
      if(c.r.size>40*1024*1024||c.nir.size>40*1024*1024)return res.status(413).json({error:'Band zu groß'});
      const result=computeNdvi(await read(c.r.key),await read(c.nir.key));
      const rid=crypto.randomBytes(8).toString('hex');
      results.set(rid,{name:c.name,summary:result.summary,png:previewPng(result.ndvi,result.width,result.height),tif:ndviTiff(result)});
      while(results.size>5)results.delete(results.keys().next().value);
      res.json({id:rid,name:c.name,width:result.width,height:result.height,...result.summary});
    }catch(err){
      log.error('[ndvi]',err.message);res.status(422).json({error:String(err.message||'Berechnung fehlgeschlagen').slice(0,160)});
    }finally{busy=false;}
  });
  router.get('/results/:file',(req,res)=>{
    const m=/^([0-9a-f]{16})\.(png|tif)$/.exec(req.params.file||'');
    const r=m?results.get(m[1]):null;
    if(!r)return res.status(404).json({error:'nicht (mehr) vorhanden'});
    if(m[2]==='png')return res.type('image/png').send(r.png);
    res.set('Content-Disposition','attachment; filename="'+r.name.replace(/[^\w.-]/g,'_')+'_NDVI.tif"').type('image/tiff').send(r.tif);
  });
  return router;
}
module.exports.createNdviRouter=createNdviRouter;
