'use strict';

// Helpers for the LAN media viewer: content types by file extension and the
// embedded EXIF thumbnail (IFD1) that DJI cameras write into every JPEG.
// Reading only the first bytes of a 5-12 MB original keeps the grid fast on the Pi.

const TYPES=Object.freeze({
  jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',
  mp4:'video/mp4',mov:'video/quicktime',m4v:'video/mp4',
  tif:'image/tiff',tiff:'image/tiff',
  json:'application/json',geojson:'application/geo+json',
  txt:'text/plain; charset=utf-8',csv:'text/csv; charset=utf-8',
  xml:'application/xml',kml:'application/vnd.google-earth.kml+xml',
  kmz:'application/vnd.google-earth.kmz',zip:'application/zip',pdf:'application/pdf'
});
// Shown in the browser (img/video tag or new tab); everything else is a download.
const INLINE=new Set(['jpg','jpeg','png','webp','gif','mp4','mov','m4v','pdf']);

function extension(key){
  const last=String(key||'').split('/').pop()||'';
  const dot=last.lastIndexOf('.');
  return dot>0?last.slice(dot+1).toLowerCase():'';
}
function contentType(key){
  return TYPES[extension(key)]||'application/octet-stream';
}
function inline(key){
  return INLINE.has(extension(key));
}

function readIfd(tiff,offset,little){
  const u16=o=>little?tiff.readUInt16LE(o):tiff.readUInt16BE(o);
  const u32=o=>little?tiff.readUInt32LE(o):tiff.readUInt32BE(o);
  if(offset<8||offset+2>tiff.length)return null;
  const count=u16(offset);
  if(offset+2+count*12+4>tiff.length)return null;
  const tags=new Map();
  for(let i=0;i<count;i++){
    const entry=offset+2+i*12;
    const tag=u16(entry),type=u16(entry+2);
    const value=type===3?u16(entry+8):u32(entry+8);
    tags.set(tag,value);
  }
  return {tags,next:u32(offset+2+count*12)};
}

// Returns the embedded JPEG thumbnail or null. Never throws for malformed input.
function exifThumbnail(buffer){
  try{
    if(!Buffer.isBuffer(buffer)||buffer.length<12||buffer[0]!==0xFF||buffer[1]!==0xD8)return null;
    let pos=2;
    while(pos+4<=buffer.length&&buffer[pos]===0xFF){
      const marker=buffer[pos+1];
      if(marker===0xDA||marker===0xD9)break;
      const length=buffer.readUInt16BE(pos+2);
      if(length<2)break;
      const start=pos+4,end=pos+2+length;
      if(marker===0xE1&&end<=buffer.length&&
         buffer.toString('latin1',start,start+6)==='Exif\0\0'){
        const tiff=buffer.subarray(start+6,end);
        const order=tiff.toString('latin1',0,2);
        if(order!=='II'&&order!=='MM')return null;
        const little=order==='II';
        const ifd0=readIfd(tiff,little?tiff.readUInt32LE(4):tiff.readUInt32BE(4),little);
        const ifd1=ifd0&&ifd0.next?readIfd(tiff,ifd0.next,little):null;
        const offset=ifd1?.tags.get(0x0201),size=ifd1?.tags.get(0x0202);
        if(!offset||!size||offset+size>tiff.length)return null;
        const thumb=tiff.subarray(offset,offset+size);
        return thumb[0]===0xFF&&thumb[1]===0xD8?Buffer.from(thumb):null;
      }
      pos=end;
    }
  }catch(_err){/* malformed EXIF: no thumbnail */}
  return null;
}

// Small in-memory LRU so repeated grid views do not hit MinIO again.
function createLru(max){
  const map=new Map();
  return {
    get(key){
      if(!map.has(key))return undefined;
      const value=map.get(key);
      map.delete(key);map.set(key,value);
      return value;
    },
    set(key,value){
      map.delete(key);map.set(key,value);
      while(map.size>max)map.delete(map.keys().next().value);
    },
    get size(){return map.size;}
  };
}

module.exports={extension,contentType,inline,exifThumbnail,createLru};
