'use strict';

// Smart Farming: DJI Mavic 3M multispectral captures in MinIO, prepared for the module.
// A capture is one shutter release with four 16-bit band TIFFs (G, R, RE, NIR) sharing a CaptureUUID.
// The bands may come from different sources (SD import with DJI names, Pilot 2 uploads named
// org_<fingerprint>_<ms>.tiff), so every TIFF is identified by its XMP header (first 64 KB),
// never by its file name. Read-only; previews from farming/ms-preview are attached when present.
const express=require('express');
const {createLru}=require('./media-preview');

const BANDS=Object.freeze({Green:'G',Red:'R',RedEdge:'RE',NIR:'NIR'});
const ORDER=Object.freeze(['G','R','RE','NIR']);
const HEADER_BYTES=65536;
const MIN_DAYLIGHT_IRRADIANCE=10; // sunlight sensor; night shots read ~1
const PREVIEW_BUCKET='farming';
const SOURCE_BUCKET='dji-cloud';
const SCHEMA='skyhub-m3m-capture-manifest-v1';

function xmpField(xmp,name){
  const m=new RegExp('[\\w-]+:'+name+'(?:="([^"]{0,200})"|>([^<]{0,200})<)').exec(xmp);
  return m?(m[1]??m[2]??'').trim():null;
}
const number=v=>{const n=Number(v);return v!==null&&v!==''&&Number.isFinite(n)?n:null;};

// Returns {captureUUID, band, ...} for an M3M multispectral TIFF header, otherwise null.
function parseBandHeader(buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length<8)return null;
  const magic=buffer.toString('latin1',0,4);
  if(magic!=='II*\0'&&magic!=='MM\0*')return null;
  const text=buffer.toString('latin1');
  const start=text.indexOf('<x:xmpmeta'),end=text.indexOf('</x:xmpmeta>',start);
  if(start<0||end<0)return null;
  const xmp=text.slice(start,end);
  const band=BANDS[xmpField(xmp,'BandName')];
  const uuid=xmpField(xmp,'CaptureUUID');
  if(!band||!/^[0-9a-f]{32}$/i.test(uuid||''))return null;
  return {
    captureUUID:uuid.toLowerCase(),band,
    model:xmpField(xmp,'Model'),
    createdAt:xmpField(xmp,'CreateDate'),
    wavelength:number(xmpField(xmp,'CentralWavelength')),
    irradiance:number(xmpField(xmp,'Irradiance')),
    lat:number(xmpField(xmp,'GpsLatitude')),
    lon:number(xmpField(xmp,'GpsLongitude')),
    relativeAltitude:number(xmpField(xmp,'RelativeAltitude')),
    absoluteAltitude:number(xmpField(xmp,'AbsoluteAltitude'))
  };
}

function assess(capture){
  const issues=[];
  const missing=ORDER.filter(b=>!capture.bands[b]);
  if(missing.length)issues.push('Bänder fehlen: '+missing.join(', '));
  const irr=ORDER.map(b=>capture.bands[b]?.irradiance).filter(v=>v!==null&&v!==undefined);
  const minIrr=irr.length?Math.min(...irr):null;
  if(minIrr!==null&&minIrr<MIN_DAYLIGHT_IRRADIANCE)
    issues.push('Kein Tageslicht (Sonnensensor '+minIrr+'): nicht auswertbar');
  if(capture.gps===null)issues.push('Keine GPS-Position');
  if(capture.relativeAltitude!==null&&Math.abs(capture.relativeAltitude)<1)
    issues.push('Aufnahme am Boden (0 m über Start), kein Flugbild');
  const complete=!missing.length;
  return {complete,minIrradiance:minIrr,
    usable:complete&&minIrr!==null&&minIrr>=MIN_DAYLIGHT_IRRADIANCE,issues};
}

function createSmartFarmingCaptures({storage,bucketIndex,clock=()=>Date.now()}={}){
  if(!storage||typeof storage.getObject!=='function'||typeof bucketIndex!=='function')
    throw new TypeError('Smart Farming captures need the media storage');
  const headers=createLru(5000);
  const previews=createLru(200);

  async function header(item){
    const id=item.key+'\n'+item.size+'\n'+(item.lastModified||'');
    const known=headers.get(id);
    if(known!==undefined)return known;
    let parsed=null;
    try{
      const object=await storage.getObject(SOURCE_BUCKET,item.key,{range:'bytes=0-'+(HEADER_BYTES-1)});
      const chunks=[];let size=0;
      for await(const chunk of object.body){chunks.push(chunk);size+=chunk.length;if(size>=HEADER_BYTES)break;}
      object.body.destroy?.();
      parsed=parseBandHeader(Buffer.concat(chunks));
    }catch(err){if(err.status!==404)throw err;}
    headers.set(id,parsed);
    return parsed;
  }
  async function previewFor(uuid,farmingKeys){
    const jsonKey='ms-preview/'+uuid+'.json',pngKey='ms-preview/'+uuid+'.png';
    if(!farmingKeys.has(jsonKey))return null;
    let data=previews.get(jsonKey);
    if(data===undefined){
      data=null;
      try{
        const object=await storage.getObject(PREVIEW_BUCKET,jsonKey);
        const chunks=[];for await(const c of object.body)chunks.push(c);
        const raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const indices={};
        for(const [name,s] of Object.entries(raw.indices||{})){
          if(!/^[A-Z]{3,6}$/.test(name)||typeof s!=='object'||!s)continue;
          indices[name]={};
          for(const k of ['median','mean','p05','p95','valid_fraction'])if(Number.isFinite(s[k]))indices[name][k]=s[k];
        }
        data={indices,calibration:typeof raw.calibration==='string'?raw.calibration.slice(0,300):null,
          gridScale:Number.isFinite(raw.grid_scale)?raw.grid_scale:null};
      }catch(_err){data=null;}
      previews.set(jsonKey,data);
    }
    if(!data)return null;
    return {...data,image:farmingKeys.has(pngKey)?{bucket:PREVIEW_BUCKET,key:pngKey}:null,
      source:{bucket:PREVIEW_BUCKET,key:jsonKey},
      note:'Vorschau einer früheren Pipeline (15.10.2026): Einzelbild, kein Orthomosaik, keine kalibrierte Reflexion'};
  }

  async function captures(){
    const index=await bucketIndex(SOURCE_BUCKET);
    let farmingKeys=new Set();
    try{farmingKeys=new Set((await bucketIndex(PREVIEW_BUCKET)).objects.map(o=>o.key));}catch(_err){}
    const groups=new Map();
    const tiffs=index.objects.filter(o=>/\.tiff?$/i.test(o.key)&&o.size>1e6&&o.size<64e6);
    for(const item of tiffs){
      const h=await header(item);
      if(!h)continue;
      if(!groups.has(h.captureUUID))groups.set(h.captureUUID,{captureUUID:h.captureUUID,bands:{},sources:[]});
      const g=groups.get(h.captureUUID);
      g.bands[h.band]={bucket:SOURCE_BUCKET,key:item.key,name:item.displayName||item.key.split('/').pop(),
        size:item.size,etag:item.etag||null,wavelength:h.wavelength,irradiance:h.irradiance};
      g.model=g.model||h.model;
      g.createdAt=g.createdAt||h.createdAt;
      if(h.lat!==null&&h.lon!==null&&!(Math.abs(h.lat)<1e-4&&Math.abs(h.lon)<1e-4))g.gps={lat:h.lat,lon:h.lon};
      if(g.relativeAltitude===undefined||g.relativeAltitude===null)g.relativeAltitude=h.relativeAltitude;
      if(g.absoluteAltitude===undefined||g.absoluteAltitude===null)g.absoluteAltitude=h.absoluteAltitude;
      const top=item.key.split('/').slice(0,2).join('/').replace(/\/[^/]*\.tiff?$/i,'/');
      if(!g.sources.includes(top))g.sources.push(top);
    }
    const out=[];
    for(const g of groups.values()){
      g.gps=g.gps||null;
      g.relativeAltitude=g.relativeAltitude??null;
      g.absoluteAltitude=g.absoluteAltitude??null;
      Object.assign(g,assess(g));
      g.preview=await previewFor(g.captureUUID,farmingKeys);
      out.push(g);
    }
    out.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    return out;
  }

  const router=express.Router();
  router.get('/',async(_req,res)=>{
    try{
      const list=await captures();
      res.json({count:list.length,usable:list.filter(c=>c.usable).length,bandOrder:ORDER,captures:list,
        notice:'Einzelaufnahmen der Mavic 3M. Für Karten und Katalog-Kandidaten ist ein orthorektifiziertes Mosaik (DEDAL/ODM) nötig.'});
    }catch(_err){res.status(503).json({error:'Storage unavailable'});}
  });
  // Manifest for the offline orthomosaic / candidate pipeline: object references only, no pixels.
  router.get('/manifest',async(_req,res)=>{
    try{
      const list=await captures();
      res.set('Content-Disposition','attachment; filename="m3m-captures-manifest.json"');
      res.json({schema:SCHEMA,generatedAt:new Date(clock()).toISOString(),bandOrder:ORDER,
        captures:list.map(c=>({captureUUID:c.captureUUID,createdAt:c.createdAt,model:c.model,usable:c.usable,
          complete:c.complete,issues:c.issues,gps:c.gps,relativeAltitude:c.relativeAltitude,
          absoluteAltitude:c.absoluteAltitude,
          bands:Object.fromEntries(ORDER.filter(b=>c.bands[b]).map(b=>[b,{bucket:c.bands[b].bucket,
            key:c.bands[b].key,size:c.bands[b].size,etag:c.bands[b].etag,
            wavelength:c.bands[b].wavelength,irradiance:c.bands[b].irradiance}]))}))});
    }catch(_err){res.status(503).json({error:'Storage unavailable'});}
  });
  return {router,captures};
}

module.exports={createSmartFarmingCaptures,parseBandHeader,assess,ORDER,SCHEMA};
