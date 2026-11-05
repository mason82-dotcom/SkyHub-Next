'use strict';
// PPK from storage: flights whose GNSS raw data were imported into MinIO (dji-cloud/ppk/<source>/<DJI folder>/…)
// are paired with their photos (dji-cloud/wayline/…/DJI_<local time>_<seq>_<lens>.JPG) and packed as the flights/ part
// of a PPK job, so only the SAPOS base files travel from the browser.
// Photos are reduced to their JPEG header (EXIF/XMP); dji-geotagger pairs MRK and photo by the DJI exposure number.
const crypto=require('node:crypto');

const BUCKET='dji-cloud';
const PPK_PREFIX='ppk/';
const PHOTO_PREFIX='wayline/';
const CACHE_MS=5*60*1000;
const MAX_FLIGHTS=10;

// --- MRK ------------------------------------------------------------------------------------------------------------
// DJI MRK line: seq  SOW  [week]  N  E  V  lat,Lat  lon,Lon  h,Ellh  sd  Q,Q (tab separated). Aborted recordings leave
// a last line with a negative week; those are dropped (dji-geotagger would otherwise read a time far in the past).
function parseMrk(text){
  const rows=[],dropped=[];
  for(const line of String(text).split(/\r?\n/)){
    if(!line.trim())continue;
    const m=line.match(/^\s*(\d+)\s+(-?\d+(?:\.\d+)?)\s+\[(-?\d+)\]/);
    const lat=line.match(/(-?\d+(?:\.\d+)?),Lat/),lon=line.match(/(-?\d+(?:\.\d+)?),Lon/),q=line.match(/(\d+),Q\s*$/);
    if(!m||Number(m[3])<=0||Number(m[2])<0||Number(m[2])>=604800){dropped.push(line);continue;}
    rows.push({line,seq:Number(m[1]),sow:Number(m[2]),week:Number(m[3]),lat:lat?Number(lat[1]):null,lon:lon?Number(lon[1]):null,
      quality:q?Number(q[1]):null});
  }
  return {rows,dropped};
}
const gpsSeconds=r=>r.week*604800+r.sow;
// Quality flag of DJI MRK: 50 fixed, 34 float, 16 single, 0/1 none.
const QUALITY={50:'RTK fix',34:'RTK float',16:'Einzelpunkt',1:'keine Position',0:'keine Position'};

function mrkSummary(rows){
  if(!rows.length)return {photos:0};
  const count={};for(const r of rows)count[r.quality]=(count[r.quality]||0)+1;
  const main=Object.entries(count).sort((a,b)=>b[1]-a[1])[0][0];
  const pos=rows.filter(r=>Number.isFinite(r.lat)&&Number.isFinite(r.lon)&&(Math.abs(r.lat)>0.01||Math.abs(r.lon)>0.01));
  const gps0=gpsSeconds(rows[0]),gps1=gpsSeconds(rows[rows.length-1]);
  // GPS -> UTC: 18 leap seconds since 2017.
  const utc=s=>new Date(Date.UTC(1980,0,6)+(s-18)*1000).toISOString();
  return {photos:rows.length,quality:QUALITY[main]||('Q'+main),qualityCode:Number(main),
    position:pos.length?{lat:+(pos.reduce((a,r)=>a+r.lat,0)/pos.length).toFixed(5),lon:+(pos.reduce((a,r)=>a+r.lon,0)/pos.length).toFixed(5)}:null,
    startUtc:utc(gps0),endUtc:utc(gps1),durationS:Math.max(0,Math.round(gps1-gps0)),maxSeq:Math.max(...rows.map(r=>r.seq))};
}

// DJI_YYYYMMDDhhmmss_… (drone local time) -> ms on a naive clock (only differences are used)
function stamp(name){
  const m=String(name).match(/^DJI_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_(\d{4})/);
  if(!m)return null;
  return {t:Date.UTC(+m[1],m[2]-1,+m[3],+m[4],+m[5],+m[6]),seq:Number(m[7])};
}
const LENS_ORDER=['V','W','Z','T','S','N','D'];
const lensOf=name=>(String(name).match(/_([A-Z])\.(?:jpe?g|tif)$/i)||[])[1]?.toUpperCase()||'';

// Photos of one MRK: taken between the MRK file time and its last exposure (+60 s), exposure number within the MRK.
// One photo per exposure (visible lens first): the camera centre is the same for all lenses of one exposure.
function matchPhotos(mrkName,summary,photos){
  const s=stamp(mrkName);
  if(!s||!summary.photos)return [];
  const from=s.t-5000,to=s.t+(summary.durationS+60)*1000;
  const bySeq=new Map();
  for(const p of photos){
    const ps=stamp(p.name);
    if(!ps||ps.t<from||ps.t>to||ps.seq<1||ps.seq>summary.maxSeq)continue;
    const cur=bySeq.get(ps.seq),rank=x=>{const i=LENS_ORDER.indexOf(lensOf(x.name));return i<0?99:i;};
    if(!cur||rank(p)<rank(cur)||(rank(p)===rank(cur)&&p.key<cur.key))bySeq.set(ps.seq,p);
  }
  return [...bySeq.values()].sort((a,b)=>stamp(a.name).seq-stamp(b.name).seq);
}

// JPEG header stub: SOI + all segments before SOS + EOI (XMP/EXIF kept, image data dropped).
function jpegHeader(buf){
  if(buf.length<4||buf[0]!==0xFF||buf[1]!==0xD8)return {error:'kein JPEG'};
  let p=2;
  while(p+4<=buf.length){
    if(buf[p]!==0xFF)return {error:'JPEG-Kopf defekt'};
    const m=buf[p+1];
    if(m===0xDA)return {header:Buffer.concat([buf.subarray(0,p),Buffer.from([0xFF,0xD9])])};
    const len=buf.readUInt16BE(p+2);
    if(len<2)return {error:'JPEG-Kopf defekt'};
    p+=2+len;
  }
  return {more:true};
}

async function bodyBuffer(body){
  if(!body)return Buffer.alloc(0);
  if(typeof body.transformToByteArray==='function')return Buffer.from(await body.transformToByteArray());
  const chunks=[];for await(const c of body)chunks.push(Buffer.from(c));return Buffer.concat(chunks);
}

function createPpkStorage({storage,now=()=>Date.now()}){
  if(!storage||typeof storage.objects!=='function'||typeof storage.getObject!=='function')throw new TypeError('PPK storage needs the media storage');
  let cache=null;
  async function listAll(prefix){
    const out=[];let cursor;
    for(let i=0;i<500;i++){
      const r=await storage.objects(BUCKET,{prefix,limit:200,...(cursor?{cursor}:{})});
      out.push(...r.objects);
      if(!r.truncated)return out;
      cursor=r.nextCursor;
    }
    throw new Error('zu viele Objekte unter '+prefix);
  }
  const read=async(key,range)=>bodyBuffer((await storage.getObject(BUCKET,key,range?{range}:{})).body);

  async function scan(){
    if(cache&&now()-cache.at<CACHE_MS)return cache;
    const [raw,photoObjects]=await Promise.all([listAll(PPK_PREFIX),listAll(PHOTO_PREFIX)]);
    const dirs=new Map();
    for(const o of raw){
      const i=o.key.lastIndexOf('/');const dir=o.key.slice(0,i+1),name=o.key.slice(i+1);
      if(!dirs.has(dir))dirs.set(dir,[]);
      dirs.get(dir).push({...o,name});
    }
    const photos=photoObjects.map(o=>({...o,name:o.key.slice(o.key.lastIndexOf('/')+1)})).filter(p=>/\.jpe?g$/i.test(p.name)&&stamp(p.name));
    const flights=[];
    for(const [dir,files] of dirs){
      const mrk=files.filter(f=>/\.mrk$/i.test(f.name)&&!/_Timestamp\.MRK$/i.test(f.name));
      const rover=files.find(f=>/_PPKRAW\.bin$/i.test(f.name))||files.find(f=>/\.rtk$/i.test(f.name));
      if(mrk.length!==1)continue;
      const {rows,dropped}=parseMrk((await read(mrk[0].key)).toString('latin1'));
      const summary=mrkSummary(rows);
      const matched=matchPhotos(mrk[0].name,summary,photos);
      const folder=dir.slice(PPK_PREFIX.length).replace(/\/$/,'');
      const id=crypto.createHash('sha256').update(dir).digest('hex').slice(0,16);
      const issues=[];
      if(!rover)issues.push('keine GNSS-Rohdaten (.RTK / _PPKRAW.bin)');
      if(!summary.position)issues.push('Drohne hatte beim Auslösen keine Satellitenposition – PPK nicht möglich');
      if(!matched.length)issues.push('keine passenden Fotos im Speicher');
      flights.push({id,dir,folder,name:folder.split('/').pop(),mrk:mrk[0],rover:rover||null,rows,dropped:dropped.length,
        summary,photos:matched,usable:issues.length===0,issues});
    }
    flights.sort((a,b)=>String(b.summary.startUtc).localeCompare(String(a.summary.startUtc)));
    cache={at:now(),flights};
    return cache;
  }

  const view=f=>({id:f.id,name:f.name,folder:f.folder,photos:f.photos.length,exposures:f.summary.photos,
    quality:f.summary.quality||null,qualityCode:f.summary.qualityCode??null,position:f.summary.position||null,
    startUtc:f.summary.startUtc||null,endUtc:f.summary.endUtc||null,durationS:f.summary.durationS||0,
    rover:f.rover?f.rover.name:null,roverBytes:f.rover?f.rover.size:null,droppedMrkLines:f.dropped,usable:f.usable,issues:f.issues});

  async function list(){return (await scan()).flights.map(view);}

  async function resolve(ids){
    if(!Array.isArray(ids)||!ids.length||ids.length>MAX_FLIGHTS||ids.some(x=>typeof x!=='string'||!/^[0-9a-f]{16}$/.test(x)))
      throw Object.assign(new Error('Flugauswahl ungültig (1–'+MAX_FLIGHTS+')'),{status:400});
    const {flights}=await scan();
    return [...new Set(ids)].map(id=>{
      const f=flights.find(x=>x.id===id);
      if(!f)throw Object.assign(new Error('Flug nicht gefunden'),{status:404});
      if(!f.usable)throw Object.assign(new Error(f.name+': '+f.issues.join(', ')),{status:422});
      return f;
    });
  }

  // JPEG header (EXIF/XMP) of one stored photo: ranged reads until the start of scan.
  async function headOf(p){
    for(const size of [262144,1048576,4194304]){
      const r=jpegHeader(await read(p.key,'bytes=0-'+(Math.min(size,p.size||size)-1)));
      if(r.header)return r.header;
      if(r.error||size>=(p.size||0))return null;
    }
    return null;
  }
  // Photo headers of one flight (coverage.js), eight reads in flight.
  async function photoHeaders(id){
    const {flights}=await scan();
    const f=flights.find(x=>x.id===id);
    if(!f)throw Object.assign(new Error('Flug nicht gefunden'),{status:404});
    const out=[];
    for(let i=0;i<f.photos.length;i+=8){
      const batch=f.photos.slice(i,i+8),heads=await Promise.all(batch.map(headOf));
      batch.forEach((p,k)=>out.push({name:p.name,header:heads[k]}));
    }
    return {flight:view(f),photos:out};
  }
  // Writes flights/<folder>/{MRK (cleaned), rover raw data, photo headers} into a ZIP writer.
  async function pack(flights,zip,{onStep=()=>{},cancelled=()=>false}={}){
    const used=new Set();let skipped=0,done=0;
    const total=flights.reduce((s,f)=>s+f.photos.length+2,0);
    for(const f of flights){
      let folder=f.name.replace(/[^\w.-]/g,'_').slice(0,80)||'flug';
      while(used.has(folder))folder+='_';
      used.add(folder);
      zip.add('flights/'+folder+'/'+f.mrk.name,Buffer.from(f.rows.map(r=>r.line).join('\r\n')+'\r\n','latin1'));
      zip.add('flights/'+folder+'/'+f.rover.name,await read(f.rover.key));
      done+=2;onStep(done,total);
      // Eight range reads in flight, ZIP entries written in exposure order.
      for(let i=0;i<f.photos.length;i+=8){
        if(cancelled())throw new Error('abgebrochen');
        const batch=f.photos.slice(i,i+8),heads=await Promise.all(batch.map(headOf));
        batch.forEach((p,k)=>{if(heads[k])zip.add('flights/'+folder+'/'+p.name,heads[k]);else skipped++;});
        done+=batch.length;onStep(done,total);
      }
    }
    return {skipped};
  }
  return {list,resolve,pack,photoHeaders,invalidate:()=>{cache=null;}};
}

module.exports={createPpkStorage,parseMrk,mrkSummary,matchPhotos,jpegHeader,stamp};
