'use strict';
// Batch export of DJI radiometric JPEGs (M4T, M3T, M30T, H20T …) as calibrated temperature TIFFs for photogrammetry
// (Agisoft Metashape, Pix4D, OpenDroneMap). Workflow idea: DanGeospatial/dji_m3t_rpeg_to_tif (fork of Teja Kattenborn's
// dji_h20t_rpeg_to_tif); independent implementation, no code taken over (that project is GPL-3.0).
//   - temperatures from the DJI Thermal SDK service (thermal-sdk.js; emissivity, distance, humidity, ambient, reflection)
//   - one Float32 TIFF per image in °C (not scaled to 0..1), uncompressed, one strip, little endian
//   - EXIF GPS (latitude, longitude, absolute altitude) and Make/Model/DateTime from the DJI XMP, as photogrammetry reads them
//   - positions.csv with position, altitudes and gimbal angles; errors per image are listed, the batch continues
// One job at a time, results in the container's temp directory, removed after one hour.
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');

const MAX_ITEMS=300,KEEP_MS=3600e3;

// --- TIFF writer (TIFF 6.0 baseline + SampleFormat, EXIF GPS IFD) -----------------------------------------------------
const TYPE={BYTE:1,ASCII:2,SHORT:3,LONG:4,RATIONAL:5};
const SIZE={1:1,2:1,3:2,4:4,5:8};
function rational(v,den=1e6){return [Math.round(Math.abs(v)*den),den];}
function dms(deg){
  const a=Math.abs(deg),d=Math.floor(a),mFull=(a-d)*60,m=Math.floor(mFull),s=(mFull-m)*60;
  return [[d,1],[m,1],[Math.round(s*1e6),1e6]];
}
function exifDate(iso){
  const t=iso?Date.parse(String(iso).replace(/^(\d{4}):(\d\d):(\d\d)/,'$1-$2-$3')):NaN;
  const d=Number.isFinite(t)?new Date(t):null;
  return d?d.toISOString().slice(0,19).replace(/-/g,':').replace('T',' '):null;
}
// entries: [tag, type, values]; values: array of numbers (SHORT/LONG/BYTE), [[num,den],…] (RATIONAL) or string (ASCII).
function ifdBlock(entries,start,nextIfd=0){
  entries=[...entries].sort((a,b)=>a[0]-b[0]);
  const headLen=2+entries.length*12+4;
  const head=Buffer.alloc(headLen);let extra=[];let extraOff=start+headLen;
  head.writeUInt16LE(entries.length,0);
  entries.forEach(([tag,type,values],i)=>{
    const p=2+i*12;
    let data;
    if(type===TYPE.ASCII){data=Buffer.from(String(values)+'\0','latin1');}
    else if(type===TYPE.RATIONAL){data=Buffer.alloc(values.length*8);values.forEach(([n,d],k)=>{data.writeUInt32LE(n>>>0,k*8);data.writeUInt32LE(d>>>0,k*8+4);});}
    else{data=Buffer.alloc(values.length*SIZE[type]);values.forEach((v,k)=>{
      if(type===TYPE.BYTE)data.writeUInt8(v,k);else if(type===TYPE.SHORT)data.writeUInt16LE(v,k*2);else data.writeUInt32LE(v>>>0,k*4);});}
    const count=type===TYPE.ASCII||type===TYPE.BYTE?data.length:values.length;
    head.writeUInt16LE(tag,p);head.writeUInt16LE(type,p+2);head.writeUInt32LE(count,p+4);
    if(data.length<=4)data.copy(head,p+8);
    else{
      if(extraOff%2)extraOff++, extra.push(Buffer.alloc(1));
      head.writeUInt32LE(extraOff,p+8);extra.push(data);extraOff+=data.length;
    }
  });
  head.writeUInt32LE(nextIfd,headLen-4);
  return Buffer.concat([head,...extra]);
}
const hasPosition=(lat,lon)=>Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&
  !(Math.abs(lat)<1e-4&&Math.abs(lon)<1e-4);
// temps: Float32Array (row-major, °C). meta: {make, model, datetime, latitude, longitude, altitude, description}
function writeTemperatureTiff({width,height,temps,meta={}}){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||!(temps instanceof Float32Array)||temps.length!==width*height)
    throw new TypeError('temperature matrix required');
  const pixels=Buffer.from(temps.buffer,temps.byteOffset,temps.byteLength);
  // Layout: header(8) | pixels | IFD0 + values | GPS IFD + values
  const pixelOff=8,ifd0Off=pixelOff+pixels.length+(pixels.length%2);
  // DJI writes tiny values such as 2e-7/5e-7 instead of 0/0 without a GPS fix (see media-upload-contract noPosition).
  const hasGps=hasPosition(meta.latitude,meta.longitude);
  const date=exifDate(meta.datetime);
  const base=[
    [256,TYPE.LONG,[width]],[257,TYPE.LONG,[height]],[258,TYPE.SHORT,[32]],[259,TYPE.SHORT,[1]],[262,TYPE.SHORT,[1]],
    [273,TYPE.LONG,[pixelOff]],[277,TYPE.SHORT,[1]],[278,TYPE.LONG,[height]],[279,TYPE.LONG,[pixels.length]],
    [284,TYPE.SHORT,[1]],[339,TYPE.SHORT,[3]],
    [270,TYPE.ASCII,String(meta.description||'Temperature in degrees Celsius (DJI Thermal SDK)').slice(0,200)],
    [271,TYPE.ASCII,String(meta.make||'DJI').slice(0,40)],[305,TYPE.ASCII,'SkyHub Next thermal export']
  ];
  if(meta.model)base.push([272,TYPE.ASCII,String(meta.model).slice(0,60)]);
  if(date)base.push([306,TYPE.ASCII,date]);
  // Two passes: the GPS IFD offset depends on the IFD0 length.
  let ifd0=ifdBlock(hasGps?[...base,[34853,TYPE.LONG,[0]]]:base,ifd0Off);
  let gps=Buffer.alloc(0);
  if(hasGps){
    const gpsOff=ifd0Off+ifd0.length+(ifd0.length%2);
    const g=[[0,TYPE.BYTE,[2,3,0,0]],[1,TYPE.ASCII,meta.latitude<0?'S':'N'],[2,TYPE.RATIONAL,dms(meta.latitude)],
      [3,TYPE.ASCII,meta.longitude<0?'W':'E'],[4,TYPE.RATIONAL,dms(meta.longitude)]];
    if(Number.isFinite(meta.altitude))g.push([5,TYPE.BYTE,[meta.altitude<0?1:0]],[6,TYPE.RATIONAL,[rational(meta.altitude,1000)]]);
    ifd0=ifdBlock([...base,[34853,TYPE.LONG,[gpsOff]]],ifd0Off);
    gps=ifdBlock(g,gpsOff);
  }
  const header=Buffer.from([0x49,0x49,42,0,0,0,0,0]);header.writeUInt32LE(ifd0Off,4);
  const pad=n=>n%2?Buffer.alloc(1):Buffer.alloc(0);
  return Buffer.concat([header,pixels,pad(pixels.length),ifd0,pad(ifd0.length),gps]);
}

// --- streaming ZIP (stored entries, data descriptors not needed: entries are buffered one by one) --------------------
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(buf){let c=0xffffffff;for(let i=0;i<buf.length;i++)c=CRC[(c^buf[i])&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}
function createZipWriter(file){
  const fd=fs.openSync(file,'w');let offset=0;const central=[];
  function add(name,data){
    const n=Buffer.from(name,'utf8'),crc=crc32(data);
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);
    h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(n.length,26);
    fs.writeSync(fd,h);fs.writeSync(fd,n);fs.writeSync(fd,data);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);
    c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
    central.push(Buffer.concat([c,n]));offset+=30+n.length+data.length;
    if(offset>0xF0000000)throw new Error('archive too large');
  }
  function close(){
    const dir=Buffer.concat(central),e=Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50,0);e.writeUInt16LE(central.length,8);e.writeUInt16LE(central.length,10);
    e.writeUInt32LE(dir.length,12);e.writeUInt32LE(offset,16);
    fs.writeSync(fd,dir);fs.writeSync(fd,e);fs.closeSync(fd);
  }
  return {add,close};
}

// --- jobs ------------------------------------------------------------------------------------------------------------
const csvCell=v=>v===null||v===undefined?'':/[",\n;]/.test(String(v))?'"'+String(v).replace(/"/g,'""')+'"':String(v);
function createThermalExport({fetchSource,parse,sdk,dir=path.join(os.tmpdir(),'skyhub-thermal-export'),now=()=>Date.now(),log=()=>{}}){
  if(typeof fetchSource!=='function'||typeof parse!=='function'||!sdk||typeof sdk.measure!=='function')
    throw new TypeError('thermal export needs the source reader, the R-JPEG parser and the Thermal SDK');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const jobs=new Map();let running=null;
  function cleanup(){
    for(const [id,j] of jobs)if(j.finishedAt&&now()-j.finishedAt>KEEP_MS){jobs.delete(id);fsp.rm(j.file,{force:true}).catch(()=>{});}
  }
  function view(j){
    return {id:j.id,status:j.status,total:j.items.length,done:j.done,failed:j.errors.length,parameters:j.params,
      errors:j.errors.slice(0,50),createdAt:j.createdAt,finishedAt:j.finishedAt||null,
      bytes:j.status==='done'?j.bytes:null,expiresAt:j.finishedAt?j.finishedAt+KEEP_MS:null};
  }
  async function run(j){
    running=j;j.status='running';
    const zip=createZipWriter(j.file);
    const rows=[['file','source','latitude','longitude','absolute_altitude_m','relative_altitude_m','gimbal_pitch_deg','gimbal_yaw_deg',
      'lrf_distance_m','utc','min_c','max_c','mean_c'].join(',')];
    const used=new Set();
    try{
      for(const it of j.items){
        if(j.cancelled)break;
        try{
          const src=await fetchSource(it.bucket,it.key);
          const frame=parse(src.buffer);
          if(!frame)throw new Error('kein radiometrisches DJI-JPEG');
          const out=await sdk.measure(src.buffer,j.params);
          const m=frame.meta||{};
          const tif=writeTemperatureTiff({width:out.width,height:out.height,temps:out.temps,meta:{model:m.model,
            datetime:m.utcAtExposure,latitude:m.latitude,longitude:m.longitude,altitude:m.absoluteAltitude}});
          let name=(it.name||it.key.split('/').pop()||'image').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/\.jpe?g$/i,'')+'.tif';
          while(used.has(name))name=name.replace(/\.tif$/,'_'+used.size+'.tif');
          used.add(name);
          zip.add(name,tif);
          let min=Infinity,max=-Infinity,sum=0;
          for(const v of out.temps){if(v<min)min=v;if(v>max)max=v;sum+=v;}
          const fix=hasPosition(m.latitude,m.longitude);
          rows.push([name,it.key,fix?m.latitude:null,fix?m.longitude:null,m.absoluteAltitude,m.relativeAltitude,m.gimbalPitch,m.gimbalYaw,
            m.lrfDistance,m.utcAtExposure,min.toFixed(2),max.toFixed(2),(sum/out.temps.length).toFixed(2)].map(csvCell).join(','));
        }catch(err){j.errors.push({key:it.key,error:String(err&&err.message||err).slice(0,120)});}
        j.done++;
      }
      zip.add('positions.csv',Buffer.from(rows.join('\n')+'\n','utf8'));
      zip.add('README.txt',Buffer.from(['SkyHub Next – Wärmebild-Export',
        'Jede .tif: Float32-Temperaturen in °C (DJI Thermal SDK), unkomprimiert, mit EXIF-GPS aus den DJI-Metadaten.',
        'Parameter: '+JSON.stringify(j.params),'Fehler: '+j.errors.length+(j.errors.length?' (siehe Statusseite)':''),
        'Hinweis: Viele Bildbetrachter zeigen Float-TIFFs weiß; in Metashape/ODM/QGIS öffnen.'].join('\n')+'\n','utf8'));
      zip.close();
      j.bytes=(await fsp.stat(j.file)).size;
      j.status=j.cancelled?'cancelled':'done';
    }catch(err){
      j.status='failed';j.errors.push({key:null,error:String(err&&err.message||err).slice(0,120)});
      try{zip.close();}catch{}
    }finally{
      j.finishedAt=now();running=null;
      log('[thermal export] '+j.id+' '+j.status+' '+j.done+'/'+j.items.length+' ('+j.errors.length+' Fehler)');
      cleanup();
    }
  }
  function start(items,params){
    cleanup();
    if(running)throw Object.assign(new Error('Es läuft bereits ein Export'),{status:409});
    if(!Array.isArray(items)||!items.length||items.length>MAX_ITEMS)throw Object.assign(new Error('1 bis '+MAX_ITEMS+' Bilder'),{status:400});
    const id=crypto.randomBytes(12).toString('hex');
    const j={id,items,params,done:0,errors:[],status:'queued',createdAt:now(),file:path.join(dir,id+'.zip')};
    jobs.set(id,j);
    run(j);
    return view(j);
  }
  return {
    start,
    status:id=>{const j=jobs.get(id);return j?view(j):null;},
    file:id=>{const j=jobs.get(id);return j&&j.status==='done'?j.file:null;},
    cancel:id=>{const j=jobs.get(id);if(j&&j.status==='running')j.cancelled=true;return Boolean(j);}
  };
}

module.exports={writeTemperatureTiff,createThermalExport,createZipWriter,crc32,MAX_ITEMS};
