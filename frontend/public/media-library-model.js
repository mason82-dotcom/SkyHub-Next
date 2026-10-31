// Pure helpers for the media gallery: file kinds, DJI capture times, folders, filters, sorting.
// No network or DOM access, so the same file runs in the browser and in node --test.
(function(root){
'use strict';
const EXTENSIONS=Object.freeze({
  image:new Set(['jpg','jpeg','png','webp','gif']),
  tiff:new Set(['tif','tiff']),
  video:new Set(['mp4','mov','m4v'])
});
const KINDS=Object.freeze(['image','video','tiff','other']);
const KIND_LABELS=Object.freeze({all:'Alle',image:'Fotos',video:'Videos',tiff:'TIFF / Multispektral',other:'Sonstige'});
const SORTS=Object.freeze(['newest','oldest','name','size-desc','size-asc']);
// Browser-renderable previews beside the EXIF thumbnail (bytes).
const DIRECT_PREVIEW_LIMIT=Object.freeze({jpg:4194304,jpeg:4194304,png:8388608,webp:8388608,gif:8388608});

function baseName(key){return String(key||'').split('/').pop()||'';}
function extension(key){
  const last=baseName(key),dot=last.lastIndexOf('.');
  return dot>0?last.slice(dot+1).toLowerCase():'';
}
function kind(key){
  const ext=extension(key);
  for(const [name,set] of Object.entries(EXTENSIONS))if(set.has(ext))return name;
  return 'other';
}
// DJI_20261002165548_0001_V.JPG -> 2026-10-02T16:55:48 (local camera time);
// org_00e9af24aeb848f8_1729610684000.jpg -> epoch milliseconds.
function captureTime(key){
  const name=baseName(key);
  let m=/(?:^|_)(20\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:_|\.|$)/.exec(name);
  if(m){
    const [y,mo,d,h,mi,s]=m.slice(1).map(Number);
    if(mo>=1&&mo<=12&&d>=1&&d<=31&&h<24&&mi<60&&s<60){
      return new Date(y,mo-1,d,h,mi,s).getTime();
    }
  }
  m=/_(1\d{12})(?:\.|_|$)/.exec(name);
  if(m)return Number(m[1]);
  return null;
}
// Lens/band from the DJI file suffix; null when the name gives no hint.
function lens(key){
  const name=baseName(key).replace(/\.[^.]+$/,'');
  const ms=/_MS_(NIR|RE|R|G)$/i.exec(name);
  if(ms)return 'Multispektral '+ms[1].toUpperCase();
  const m=/^DJI_\d{14}_\d{4}_([A-Z])$/i.exec(name);
  if(!m)return null;
  return {T:'Wärmebild',V:'Visuell',W:'Weitwinkel',Z:'Zoom',S:'Super-Auflösung'}[m[1].toUpperCase()]||null;
}
function normalize(raw){
  if(!raw||typeof raw.key!=='string'||!raw.key)return null;
  const size=Number.isSafeInteger(raw.size)&&raw.size>=0?raw.size:0;
  const modified=typeof raw.lastModified==='string'&&Number.isFinite(Date.parse(raw.lastModified))?
    Date.parse(raw.lastModified):null;
  const captured=captureTime(raw.key);
  return {key:raw.key,name:baseName(raw.key),size,modified,captured,
    time:captured??modified??0,kind:kind(raw.key),ext:extension(raw.key),lens:lens(raw.key)};
}
function normalizeAll(list){
  if(!Array.isArray(list))throw new TypeError('Invalid media index');
  const out=[];
  for(const raw of list){const item=normalize(raw);if(item)out.push(item);}
  return out;
}
function counts(items){
  const result={all:items.length,image:0,video:0,tiff:0,other:0,bytes:0};
  for(const item of items){result[item.kind]++;result.bytes+=item.size;}
  return result;
}
// Direct children of a folder prefix ('' = bucket root): sub-folders with totals and files.
function folder(items,prefix=''){
  const folders=new Map(),files=[];
  for(const item of items){
    if(!item.key.startsWith(prefix))continue;
    const rest=item.key.slice(prefix.length);
    const slash=rest.indexOf('/');
    if(slash===-1){if(rest)files.push(item);continue;}
    const name=rest.slice(0,slash);
    let entry=folders.get(name);
    if(!entry){
      entry={name,prefix:prefix+name+'/',count:0,bytes:0,images:0,videos:0,latest:0,cover:null};
      folders.set(name,entry);
    }
    entry.count++;entry.bytes+=item.size;
    if(item.kind==='image'){entry.images++;if(!entry.cover||item.time>entry.cover.time)entry.cover=item;}
    if(item.kind==='video')entry.videos++;
    if(item.time>entry.latest)entry.latest=item.time;
  }
  return {folders:[...folders.values()].sort((a,b)=>a.name.localeCompare(b.name,'de',{numeric:true})),files};
}
function within(items,prefix=''){
  return prefix?items.filter(item=>item.key.startsWith(prefix)):items.slice();
}
function filter(items,{query='',type='all'}={}){
  if(type!=='all'&&!KINDS.includes(type))throw new TypeError('Invalid type');
  const needle=String(query).trim().toLocaleLowerCase('de-DE');
  const words=needle?needle.split(/\s+/):[];
  return items.filter(item=>(type==='all'||item.kind===type)&&
    words.every(word=>item.key.toLocaleLowerCase('de-DE').includes(word)));
}
function sort(items,mode='newest'){
  if(!SORTS.includes(mode))throw new TypeError('Invalid sort');
  const list=items.slice();
  const byName=(a,b)=>a.key.localeCompare(b.key,'de',{numeric:true});
  const compare={
    newest:(a,b)=>b.time-a.time||byName(a,b),
    oldest:(a,b)=>a.time-b.time||byName(a,b),
    name:byName,
    'size-desc':(a,b)=>b.size-a.size||byName(a,b),
    'size-asc':(a,b)=>a.size-b.size||byName(a,b)
  }[mode];
  return list.sort(compare);
}
function canPreviewDirectly(item){
  const limit=DIRECT_PREVIEW_LIMIT[item.ext];
  return Boolean(limit)&&item.size<=limit;
}
function fileUrl(bucket,key,{download=false}={}){
  const q=new URLSearchParams({bucket,key});
  if(download)q.set('download','1');
  return '/api/media/file?'+q.toString();
}
function thumbUrl(bucket,key){
  return '/api/media/thumb?'+new URLSearchParams({bucket,key}).toString();
}
function size(bytes){
  if(!Number.isFinite(bytes)||bytes<0)return '—';
  if(bytes<1024)return bytes+' B';
  const units=['KB','MB','GB','TB'];
  let number=bytes,i=-1;
  do{number/=1024;i++;}while(number>=1024&&i<units.length-1);
  return new Intl.NumberFormat('de-DE',{maximumFractionDigits:number<10?1:0}).format(number)+' '+units[i];
}
function number(value){return new Intl.NumberFormat('de-DE').format(value);}
function date(ms){
  if(!Number.isFinite(ms)||ms<=0)return '—';
  return new Date(ms).toLocaleString('de-DE',{dateStyle:'medium',timeStyle:'short'});
}
function crumbs(prefix){
  const parts=prefix.split('/').filter(Boolean);
  return parts.map((name,i)=>({name,prefix:parts.slice(0,i+1).join('/')+'/'}));
}
const api=Object.freeze({KINDS,KIND_LABELS,SORTS,baseName,extension,kind,captureTime,lens,
  normalize,normalizeAll,counts,folder,within,filter,sort,canPreviewDirectly,
  fileUrl,thumbUrl,size,number,date,crumbs});
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.SkyhubMediaLibrary=api;
})(typeof window==='object'?window:null);
