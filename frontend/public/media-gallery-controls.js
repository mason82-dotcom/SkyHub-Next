// Local-only view of the single loaded gallery page: never sends a search to S3.
// File extensions are unverified filename hints, not detected media MIME types.
(function(root){
'use strict';
const EXTENSIONS=Object.freeze({
  image:new Set(['jpg','jpeg','png','webp']),
  tiff:new Set(['tif','tiff']),
  video:new Set(['mp4','mov'])
});
const TYPES=new Set(['all','image','tiff','video','other']);
const SORTS=new Set(['recent','name','size-desc','size-asc']);
function kind(name){
  if(typeof name!=='string')return 'other';
  const last=name.split('/').pop()||'';
  const dot=last.lastIndexOf('.');
  const ext=dot>0?last.slice(dot+1).toLowerCase():'';
  for(const [type,extensions] of Object.entries(EXTENSIONS))
    if(extensions.has(ext))return type;
  return 'other';
}
function view(items,{query='',type='all',sort='recent'}={}){
  if(!Array.isArray(items)||items.length>100||typeof query!=='string'||
    query.length>128||!TYPES.has(type)||!SORTS.has(sort))
    throw new TypeError('Invalid page-local gallery view');
  const needle=query.trim().toLocaleLowerCase('de-DE');
  const indexed=items.map((item,index)=>{
    if(!item||typeof item.name!=='string'||item.name.length>2048||
      !Number.isSafeInteger(item.bytes)||item.bytes<0)
      throw new TypeError('Invalid page-local gallery item');
    return {item,index};
  }).filter(({item})=>
    (type==='all'||kind(item.name)===type)&&
    item.name.toLocaleLowerCase('de-DE').includes(needle)
  );
  if(sort!=='recent')indexed.sort((a,b)=>{
    let comparison=0;
    if(sort==='name')comparison=a.item.name.localeCompare(b.item.name,'de');
    if(sort==='size-desc')comparison=b.item.bytes-a.item.bytes;
    if(sort==='size-asc')comparison=a.item.bytes-b.item.bytes;
    return comparison||a.index-b.index;
  });
  return {items:indexed.map(x=>x.item),shown:indexed.length,total:items.length};
}
const api=Object.freeze({kind,view});
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.SkyhubGalleryControls=api;
})(typeof window==='object'?window:null);
