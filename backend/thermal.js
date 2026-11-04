'use strict';

// Thermal module: radiometric DJI R-JPEGs (M4T, M30T, M3T, H20T ...).
// The 16-bit raw frame sits in APP3 segments, measurement parameters in APP4 ("iirp"),
// flight/gimbal data in the DJI XMP block. /raw serves the ESTIMATE basis (raw/64 - 273.15).
// Optional: /measure returns DJI Thermal SDK temperatures from the isolated thermal-sdk service.
const express=require('express');
const {createHash}=require('node:crypto');
const {createLru}=require('./media-preview');
const {sdkParameters}=require('./thermal-sdk');
const {createThermalExport,MAX_ITEMS}=require('./thermal-export');

const FRAMES=Object.freeze([[640,512],[320,256],[1280,1024]]);
const MAX_OBJECT_BYTES=20*1024*1024;
const HIST_BINS=64;
const ESTIMATE='raw/64-273.15 (Schätzung ohne DJI Thermal SDK)';

// Walk bounded JPEG markers through the scan to a real EOI. Opaque bytes after
// EOI are permitted, included in the source hash/20 MiB limit and never decoded.
// This validates marker boundaries, not the compressed image or calibration.
function segments(buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length<4||buffer.length>MAX_OBJECT_BYTES||
     buffer[0]!==0xFF||buffer[1]!==0xD8)return null;
  const out=[];let pos=2,inScan=false,sawScan=false;
  while(pos<buffer.length){
    if(inScan){
      pos=buffer.indexOf(0xFF,pos);
      if(pos<0)return null;
    }else if(buffer[pos]!==0xFF)return null;
    while(buffer[pos+1]===0xFF)pos++;
    if(pos+2>buffer.length)return null;
    const marker=buffer[pos+1];
    // Stuffed FF and restart markers belong to entropy data, not APP payloads.
    if(inScan&&(marker===0x00||(marker>=0xD0&&marker<=0xD7))){pos+=2;continue;}
    if(marker===0xD9)return sawScan?out:null;
    if(marker===0x00||marker===0xD8||marker===0x01||
       (marker>=0xD0&&marker<=0xD7)||pos+4>buffer.length)return null;
    const length=buffer.readUInt16BE(pos+2);
    if(length<2||pos+2+length>buffer.length)return null;
    // Preserve the original contract: thermal APP data precedes the first scan.
    if(!sawScan&&marker!==0xDA)out.push({marker,data:buffer.subarray(pos+4,pos+2+length)});
    inScan=marker===0xDA||(inScan&&marker===0xDC);
    if(marker===0xDA)sawScan=true;
    pos+=2+length;
  }
  return null;
}
function xmpValues(buffer){
  const text=buffer.toString('latin1',0,Math.min(buffer.length,200000));
  const start=text.indexOf('<x:xmpmeta');
  const end=text.indexOf('</x:xmpmeta>',start);
  if(start<0||end<0)return {};
  const xmp=text.slice(start,end);
  const out={};
  const re=/drone-dji:(\w{1,40})(?:="([^"]{0,200})"|>([^<]{0,200})<)/g;
  let m;
  while((m=re.exec(xmp)))out[m[1]]=(m[2]??m[3]??'').trim();
  return out;
}
const num=value=>{const n=Number(value);return value!==undefined&&value!==''&&Number.isFinite(n)?n:null;};

// Parse a DJI radiometric JPEG. Returns null when the file carries no raw thermal frame.
function parseRJpeg(buffer){
  const parts=segments(buffer);
  if(!parts)return null;
  const raw=Buffer.concat(parts.filter(s=>s.marker===0xE3).map(s=>s.data));
  const frame=FRAMES.find(([w,h])=>raw.length===w*h*2);
  if(!frame)return null;
  const [width,height]=frame;
  const values=new Uint16Array(width*height);
  for(let i=0;i<values.length;i++)values[i]=raw.readUInt16LE(i*2);
  // APP4 "iirp" measurement block: emissivity observed as float32 at offset 40 (M4T).
  let emissivity=null;
  const app4=parts.find(s=>s.marker===0xE4&&s.data.length>=48&&s.data.toString('latin1',4,8)==='iirp');
  if(app4){
    const e=app4.data.readFloatLE(40);
    if(Number.isFinite(e)&&e>=0.1&&e<=1)emissivity=Math.round(e*1000)/1000;
  }
  const x=xmpValues(buffer);
  // A matching length alone is not evidence of a DJI thermal layout.
  if(!app4&&x.ImageSource!=='InfraredCamera')return null;
  return {
    formatVerified:false,
    width,height,values,emissivity,
    meta:{
      model:x.DroneModel||null,imageSource:x.ImageSource||null,
      utcAtExposure:x.UTCAtExposure||null,
      lrfDistance:num(x.LRFTargetDistance),lrfStatus:x.LRFStatus||null,
      gimbalPitch:num(x.GimbalPitchDegree),gimbalYaw:num(x.GimbalYawDegree),
      relativeAltitude:num(x.RelativeAltitude),absoluteAltitude:num(x.AbsoluteAltitude),
      // DJI XMP position (older firmware writes "GpsLongtitude"); used for the GPS tags of the TIFF export.
      latitude:num(x.GpsLatitude),longitude:num(x.GpsLongitude??x.GpsLongtitude)
    }
  };
}
const celsius=raw=>raw/64-273.15;
function frameStats({width,height,values}){
  const sorted=Uint16Array.from(values).sort();
  const n=sorted.length,q=p=>celsius(sorted[Math.min(n-1,Math.floor(p*n))]);
  let sum=0,hot=0,cold=0;
  for(let i=0;i<n;i++){
    sum+=values[i];
    if(values[i]>values[hot])hot=i;
    if(values[i]<values[cold])cold=i;
  }
  const min=celsius(sorted[0]),max=celsius(sorted[n-1]);
  const histogram=new Array(HIST_BINS).fill(0);
  const span=Math.max(1,sorted[n-1]-sorted[0]);
  for(let i=0;i<n;i++)histogram[Math.min(HIST_BINS-1,Math.floor((values[i]-sorted[0])/span*HIST_BINS))]++;
  const round=v=>Math.round(v*100)/100;
  return {
    min:round(min),max:round(max),mean:round(celsius(sum/n)),median:round(q(0.5)),
    p1:round(q(0.01)),p99:round(q(0.99)),
    hotspot:{x:hot%width,y:Math.floor(hot/width),t:round(max)},
    coldspot:{x:cold%width,y:Math.floor(cold/width),t:round(min)},
    histogram
  };
}

// DJI_YYYYMMDDHHMMSS_NNNN_L.JPG -> {day, index, lens}
function djiParts(name){
  const m=/^DJI_(\d{8})(\d{6})_(\d{4})_([A-Z])\.(jpe?g)$/i.exec(name||'');
  return m?{day:m[1],time:m[2],index:m[3],lens:m[4].toUpperCase()}:null;
}
function isThermalName(name){return /_T\.jpe?g$/i.test(name||'');}
// SD imports store every file in its own content hash folder (64 hex); group by the import folder.
function groupFolder(key){
  const parts=key.split('/');parts.pop();
  if(parts.length&&/^[0-9a-f]{64}$/.test(parts[parts.length-1]))parts.pop();
  return parts.length?parts.join('/')+'/':'';
}
const seconds=t=>Number(t.slice(0,2))*3600+Number(t.slice(2,4))*60+Number(t.slice(4,6));

function createThermalRouter({storage,bucketIndex,buckets,sdk=null}={}){
  if(!storage||typeof storage.getObject!=='function'||typeof bucketIndex!=='function'||
     typeof buckets!=='function')throw new TypeError('Thermal module needs the media storage');
  const router=express.Router();
  // One cache entry owns both metadata and raw data for an immutable JPEG hash.
  // /meta re-reads the source; /raw?version=... only serves that exact snapshot.
  const snapshots=createLru(24);
  const pending=new Map();
  const objectId=(bucket,key)=>JSON.stringify([bucket,key]);
  const snapshotId=(bucket,key,version)=>JSON.stringify([bucket,key,version]);
  async function fetchSource(bucket,key){
    const object=await storage.getObject(bucket,key);
    if(Number.isSafeInteger(object.contentLength)&&object.contentLength>MAX_OBJECT_BYTES){
      object.body?.destroy?.();
      const err=new Error('Too large');err.status=413;throw err;
    }
    const chunks=[];let size=0;
    for await(const chunk of object.body){
      size+=chunk.length;
      if(size>MAX_OBJECT_BYTES){object.body.destroy?.();const err=new Error('Too large');err.status=413;throw err;}
      chunks.push(chunk);
    }
    const buffer=Buffer.concat(chunks);
    return {buffer,size,version:createHash('sha256').update(buffer).digest('hex')};
  }
  async function load(bucket,key){
    const id=objectId(bucket,key);
    if(pending.has(id))return pending.get(id);
    if(pending.size>=8){const err=new Error('Busy');err.status=503;throw err;}
    const promise=(async()=>{
      const {buffer,size,version}=await fetchSource(bucket,key);
      const cacheKey=snapshotId(bucket,key,version);
      let frame=snapshots.get(cacheKey);
      if(frame)return frame;
      frame=parseRJpeg(buffer);
      if(!frame){const err=new Error('No thermal data');err.status=422;throw err;}
      frame.version=version;
      frame.sourceBytes=size;
      frame.stats=frameStats(frame);
      snapshots.set(cacheKey,frame);
      return frame;
    })();
    pending.set(id,promise);
    try{return await promise;}finally{pending.delete(id);}
  }
  function fail(res,err){
    const status=[400,404,409,413,422,502,504].includes(err.status)?err.status:503;
    res.status(status).json({error:{400:'Invalid query',404:'Not found',409:'Thermal snapshot expired; reload metadata',413:'File too large',
      422:'No radiometric thermal data in this file',502:'Invalid DJI Thermal SDK result',
      504:'DJI Thermal SDK deadline exceeded'}[status]||'Storage unavailable'});
  }
  function query(req,res){
    const {bucket,key}=req.query;
    if(typeof bucket!=='string'||typeof key!=='string'||!key||key.length>1024||/[\x00-\x1f\x7f]/.test(key)){
      res.status(400).json({error:'Invalid query'});return null;
    }
    return {bucket,key};
  }

  // All thermal images of every bucket, with the matching visual photo of the same shot.
  router.get('/list',async(_req,res)=>{
    try{
      const items=[];
      for(const bucket of await buckets()){
        const index=await bucketIndex(bucket);
        // Visual frames of the same shot: same import folder, day and image number, time within 3 s.
        const visual=new Map();
        for(const o of index.objects){
          const name=o.displayName||o.key.split('/').pop();
          const parts=djiParts(name);
          if(!parts||!['V','W','Z'].includes(parts.lens))continue;
          const id=groupFolder(o.key)+parts.day+'_'+parts.index;
          if(!visual.has(id))visual.set(id,[]);
          visual.get(id).push({key:o.key,lens:parts.lens,time:parts.time});
        }
        const match=(folder,parts)=>{
          const candidates=(visual.get(folder+parts.day+'_'+parts.index)||[])
            .filter(v=>Math.abs(seconds(v.time)-seconds(parts.time))<=3);
          // Prefer the wide/visual frame (V, W) over zoom (Z).
          candidates.sort((a,b)=>(a.lens==='Z')-(b.lens==='Z')||
            Math.abs(seconds(a.time)-seconds(parts.time))-Math.abs(seconds(b.time)-seconds(parts.time)));
          if(!candidates.length)return {visualKey:null,visualMatch:'none'};
          const best=candidates[0];
          const tied=candidates.filter(c=>(c.lens==='Z')===(best.lens==='Z')&&
            Math.abs(seconds(c.time)-seconds(parts.time))===Math.abs(seconds(best.time)-seconds(parts.time)));
          return tied.length>1?{visualKey:null,visualMatch:'ambiguous'}:
            {visualKey:best.key,visualMatch:'filename-heuristic'};
        };
        for(const o of index.objects){
          const name=o.displayName||o.key.split('/').pop();
          if(!isThermalName(name))continue;
          const parts=djiParts(name);
          const folder=groupFolder(o.key);
          items.push({bucket,key:o.key,name,size:o.size,folder,
            captured:o.capturedAt||null,lastModified:o.lastModified||null,
            day:parts?parts.day:null,time:parts?parts.time:null,
            ...(parts?match(folder,parts):{visualKey:null,visualMatch:'none'})});
        }
      }
      items.sort((a,b)=>String(b.day||'')+(b.time||'')>String(a.day||'')+(a.time||'')?1:-1);
      res.json({count:items.length,estimate:ESTIMATE,items});
    }catch(err){fail(res,err);}
  });

  router.get('/meta',async(req,res)=>{
    const q=query(req,res);if(!q)return;
    try{
      const frame=await load(q.bucket,q.key);
      const result={width:frame.width,height:frame.height,emissivity:frame.emissivity,
        meta:frame.meta,stats:frame.stats,estimate:ESTIMATE,version:frame.version,
        sourceBytes:frame.sourceBytes,formatVerified:false,
        sdk:sdk?{available:await sdk.available(),calibration:'dji-tsdk',ranges:sdk.ranges}:{available:false}};
      res.set('Cache-Control','no-store');
      res.json(result);
    }catch(err){fail(res,err);}
  });

  // 16-bit raw frame (little endian) for rendering and measuring in the browser.
  router.get('/raw',async(req,res)=>{
    const q=query(req,res);if(!q)return;
    try{
      const {version}=req.query;
      if(version!==undefined&&(typeof version!=='string'||!/^[0-9a-f]{64}$/.test(version))){
        return res.status(400).json({error:'Invalid version'});
      }
      const frame=version?snapshots.get(snapshotId(q.bucket,q.key,version)):await load(q.bucket,q.key);
      if(!frame){const err=new Error('Snapshot expired');err.status=409;throw err;}
      const body=Buffer.alloc(frame.values.length*2);
      for(let i=0;i<frame.values.length;i++)body.writeUInt16LE(frame.values[i],i*2);
      res.set({'Content-Type':'application/octet-stream','Cache-Control':'no-store',
        'X-Thermal-Width':String(frame.width),'X-Thermal-Height':String(frame.height),
        'X-Thermal-Version':frame.version,'X-Thermal-Estimate':'raw/64-273.15; uncalibrated estimate',
        'X-Thermal-Emissivity':frame.emissivity===null?'':String(frame.emissivity),
        'Content-Length':String(body.length)});
      res.end(body);
    }catch(err){fail(res,err);}
  });
  // DJI Thermal SDK temperatures (float32 LE, °C) for exactly the displayed source version.
  // The JPEG is re-read and its SHA-256 compared, so a changed object can never be measured
  // under an old version. Results are cached per version and parameter set.
  const measured=createLru(6);
  const measuring=new Map();
  router.get('/measure',async(req,res)=>{
    const q=query(req,res);if(!q)return;
    try{
      if(!sdk){const err=new Error('SDK disabled');err.status=404;throw err;}
      const {version}=req.query;
      if(typeof version!=='string'||!/^[0-9a-f]{64}$/.test(version))return res.status(400).json({error:'Invalid version'});
      const allowed=new Set(['bucket','key','version','emissivity','distance','humidity','ambient','reflection']);
      if(Object.keys(req.query).some(k=>!allowed.has(k))||
         Object.values(req.query).some(v=>typeof v!=='string'))return res.status(400).json({error:'Invalid query'});
      let params;
      try{params=sdkParameters(req.query);}catch(err){return res.status(400).json({error:err.message});}
      const id=JSON.stringify([q.bucket,q.key,version,params]);
      let result=measured.get(id);
      if(!result){
        if(!measuring.has(id)){
          if(measuring.size>=2){const err=new Error('Busy');err.status=503;throw err;}
          measuring.set(id,(async()=>{
            const source=await fetchSource(q.bucket,q.key);
            if(source.version!==version){const err=new Error('Changed');err.status=409;throw err;}
            const out=await sdk.measure(source.buffer,params);
            const snapshot=snapshots.get(snapshotId(q.bucket,q.key,version));
            if(snapshot&&(snapshot.width!==out.width||snapshot.height!==out.height)){
              const err=new Error('Size mismatch');err.status=502;throw err;
            }
            return out;
          })().finally(()=>measuring.delete(id)));
        }
        result=await measuring.get(id);
        measured.set(id,result);
      }
      const body=Buffer.from(result.temps.buffer,result.temps.byteOffset,result.temps.byteLength);
      res.set({'Content-Type':'application/octet-stream','Cache-Control':'no-store',
        'X-Thermal-Width':String(result.width),'X-Thermal-Height':String(result.height),
        'X-Thermal-Version':version,'X-Thermal-Calibration':'dji-tsdk',
        'X-Thermal-Parameters':JSON.stringify(result.parameters),'Content-Length':String(body.length)});
      res.end(body);
    }catch(err){fail(res,err);}
  });
  // Batch export as calibrated temperature TIFFs for photogrammetry (thermal-export.js). Needs the Thermal SDK.
  const exporter=sdk?createThermalExport({fetchSource,parse:parseRJpeg,sdk,log:m=>console.log(m)}):null;
  router.post('/export',express.json({limit:'256kb'}),async(req,res)=>{
    try{
      if(!exporter)return res.status(404).json({error:'DJI Thermal SDK nicht eingerichtet'});
      const b=req.body&&typeof req.body==='object'?req.body:{};
      if(!Array.isArray(b.items)||!b.items.length||b.items.length>MAX_ITEMS)return res.status(400).json({error:'1 bis '+MAX_ITEMS+' Bilder auswählen'});
      const allowed=new Set(await buckets());
      const items=[];
      for(const it of b.items){
        if(!it||typeof it.bucket!=='string'||!allowed.has(it.bucket)||typeof it.key!=='string'||!it.key||it.key.length>1024||
           /[\x00-\x1f\x7f]/.test(it.key)||!isThermalName(it.key.split('/').pop()))return res.status(400).json({error:'Ungültige Bildauswahl'});
        items.push({bucket:it.bucket,key:it.key});
      }
      let params;
      try{params=sdkParameters(b.parameters||{});}catch(err){return res.status(400).json({error:err.message});}
      res.status(202).json(exporter.start(items,params));
    }catch(err){res.status(err.status&&err.status<500?err.status:503).json({error:err.status?err.message:'Export nicht möglich'});}
  });
  const jobId=id=>typeof id==='string'&&/^[0-9a-f]{24}$/.test(id);
  router.get('/export/:id',(req,res)=>{
    const s=exporter&&jobId(req.params.id)?exporter.status(req.params.id):null;
    res.set('Cache-Control','no-store');
    return s?res.json(s):res.status(404).json({error:'Export nicht gefunden'});
  });
  router.get('/export/:id/zip',(req,res)=>{
    const file=exporter&&jobId(req.params.id)?exporter.file(req.params.id):null;
    if(!file)return res.status(404).json({error:'Export nicht fertig oder abgelaufen'});
    res.download(file,'skyhub-waermebilder-'+req.params.id.slice(0,8)+'.zip');
  });
  router.delete('/export/:id',(req,res)=>res.json({ok:Boolean(exporter&&jobId(req.params.id)&&exporter.cancel(req.params.id))}));
  return router;
}

module.exports={createThermalRouter,parseRJpeg,frameStats,djiParts,isThermalName,groupFolder,celsius,ESTIMATE};
