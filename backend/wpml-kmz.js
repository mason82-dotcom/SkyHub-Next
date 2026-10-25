'use strict';
// Bounded KMZ/ZIP reader & writer for offline DJI WPML. No shelling out or network access.
const zlib=require('node:zlib');
const {TextDecoder}=require('node:util');
const {validateDocuments}=require('./wpml');
const DECODER=new TextDecoder('utf-8',{fatal:true});
const MAX_ZIP=12*1024*1024;
const MAX_TOTAL=32*1024*1024;
const MAX_ENTRIES=128;
const TEMPLATE='wpmz/template.kml';
const WAYLINES='wpmz/waylines.wpml';
function crc32(data){
  let c=0xffffffff;
  for(const b of data){
    c^=b;
    for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);
  }
  return (c^0xffffffff)>>>0;
}
function readKmz(buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length<22||buffer.length>MAX_ZIP)
    throw Error('Invalid KMZ size');
  // ZIP64 and split-volume archives are intentionally not supported.
  let eocd=-1;
  const start=Math.max(0,buffer.length-22-65535);
  for(let i=buffer.length-22;i>=start;i--){
    if(buffer.readUInt32LE(i)===0x06054b50&&i+22+buffer.readUInt16LE(i+20)===buffer.length){
      eocd=i;break;
    }
  }
  if(eocd<0)throw Error('ZIP end-of-central-directory missing');
  const count=buffer.readUInt16LE(eocd+10);
  const directorySize=buffer.readUInt32LE(eocd+12);
  const directoryOffset=buffer.readUInt32LE(eocd+16);
  if(buffer.readUInt16LE(eocd+4)!==0||buffer.readUInt16LE(eocd+6)!==0||
    buffer.readUInt16LE(eocd+8)!==count||count<2||count>MAX_ENTRIES||
    directoryOffset+directorySize!==eocd)throw Error('Unsupported KMZ ZIP directory');
  const names=new Set(),records=new Map();
  let pos=directoryOffset,total=0;
  const occupied=[];
  for(let i=0;i<count;i++){
    if(pos+46>eocd||buffer.readUInt32LE(pos)!==0x02014b50)
      throw Error('Corrupted KMZ central directory');
    const flag=buffer.readUInt16LE(pos+8);
    const method=buffer.readUInt16LE(pos+10);
    const crc=buffer.readUInt32LE(pos+16);
    const compressed=buffer.readUInt32LE(pos+20);
    const uncompressed=buffer.readUInt32LE(pos+24);
    const nameLen=buffer.readUInt16LE(pos+28);
    const extraLen=buffer.readUInt16LE(pos+30);
    const commentLen=buffer.readUInt16LE(pos+32);
    const attrs=buffer.readUInt32LE(pos+38);
    const local=buffer.readUInt32LE(pos+42);
    const end=pos+46+nameLen+extraLen+commentLen;
    if(end>eocd||nameLen===0)throw Error('Invalid ZIP member');
    const name=DECODER.decode(buffer.subarray(pos+46,pos+46+nameLen));
    if(name.includes('\\')||name.startsWith('/')||name.includes('..')||
       name.includes('\0')||!(/^(?:wpmz\/)?(?:template\.kml|waylines\.wpml)$/.test(name)||
           /^wpmz\/res\/[A-Za-z0-9_./ -]+$/.test(name)||name==='wpmz/'||
           name==='wpmz/res/'))throw Error('Unsafe or unknown KMZ member');
    if(names.has(name))throw Error('Duplicate KMZ member');
    names.add(name);
    if((flag&1)!==0||(flag&0x40)!==0||![0,8].includes(method)||
       (attrs>>>16&0xf000)===0xa000||compressed>MAX_ZIP||
       uncompressed>MAX_TOTAL||uncompressed>compressed*500+4096)
      throw Error('Unsupported ZIP entry or decompression limit');
    total+=uncompressed;
    if(total>MAX_TOTAL)throw Error('KMZ uncompressed size limit');
    if(local+30>directoryOffset||buffer.readUInt32LE(local)!==0x04034b50)
      throw Error('Invalid local ZIP header');
    if(buffer.readUInt16LE(local+6)!==flag)throw Error('ZIP flags disagree');
    if((flag&0x8)===0&&(
      buffer.readUInt32LE(local+14)!==crc||
      buffer.readUInt32LE(local+18)!==compressed||
      buffer.readUInt32LE(local+22)!==uncompressed))
      throw Error('ZIP local/central size or CRC mismatch');
    const localNameLen=buffer.readUInt16LE(local+26);
    const localExtraLen=buffer.readUInt16LE(local+28);
    const dataOffset=local+30+localNameLen+localExtraLen;
    if(dataOffset+compressed>directoryOffset)throw Error('ZIP entry overlaps directory');
    const endOfEntry=dataOffset+compressed;
    if(occupied.some(([a,b])=>local<b&&endOfEntry>a))
      throw Error('Overlapping ZIP members');
    occupied.push([local,endOfEntry]);
    const localName=DECODER.decode(buffer.subarray(local+30,local+30+localNameLen));
    if(localName!==name||buffer.readUInt16LE(local+8)!==method)
      throw Error('ZIP headers disagree');
    // Verify ALL members, including opaque resources, before trusting their metadata.
    // A corrupt or modified res/ item can never be silently skipped.
    const isXml=name===TEMPLATE||name===WAYLINES||name==='template.kml'||name==='waylines.wpml';
    if(isXml&&uncompressed>2*1024*1024)throw Error('WPML XML size limit');
    const bytes=buffer.subarray(dataOffset,dataOffset+compressed);
    let plain;
    try{plain=method===0?Buffer.from(bytes):zlib.inflateRawSync(bytes,{maxOutputLength:uncompressed+1});}
    catch{throw Error('Corrupted or oversized KMZ member');}
    if(plain.length!==uncompressed||crc32(plain)!==crc)
      throw Error('ZIP CRC32/length mismatch');
    if(isXml)records.set(name,DECODER.decode(plain));
    pos=end;
  }
  if(pos!==eocd)throw Error('Invalid ZIP directory length');
  const template=records.get(TEMPLATE)??records.get('template.kml');
  const waylines=records.get(WAYLINES)??records.get('waylines.wpml');
  if(!template||!waylines)throw Error('Missing template.kml or waylines.wpml');
  if(records.has(TEMPLATE)&&records.has('template.kml')||
     records.has(WAYLINES)&&records.has('waylines.wpml'))
    throw Error('Ambiguous duplicate WPML document');
  return {template,waylines,resourceCount:[...names].filter(n=>n.startsWith('wpmz/res/')&&!n.endsWith('/')).length};
}
function inspectKmz(buffer){
  const result=readKmz(buffer);
  return {...validateDocuments(result.template,result.waylines),resourceCount:result.resourceCount};
}
// Package caller-supplied XML without editing it. No route computation is implied.
function packageKmz(template,waylines){
  if(typeof template!=='string'||typeof waylines!=='string')
    throw Error('Two XML strings required');
  const validation=validateDocuments(template,waylines);
  if(!validation.valid)throw Error('Cannot package invalid WPML: '+validation.errors[0]?.path);
  const entries=[[TEMPLATE,Buffer.from(template,'utf8')],[WAYLINES,Buffer.from(waylines,'utf8')]];
  const locals=[],central=[];
  let offset=0;
  for(const [name,bytes] of entries){
    const filename=Buffer.from(name,'utf8'),crc=crc32(bytes);
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0);
    local.writeUInt16LE(20,4);
    local.writeUInt16LE(0x800,6);
    local.writeUInt16LE(0,8);
    local.writeUInt32LE(crc,14);
    local.writeUInt32LE(bytes.length,18);
    local.writeUInt32LE(bytes.length,22);
    local.writeUInt16LE(filename.length,26);
    locals.push(local,filename,bytes);
    const dir=Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50,0);
    dir.writeUInt16LE(20,4);
    dir.writeUInt16LE(20,6);
    dir.writeUInt16LE(0x800,8);
    dir.writeUInt16LE(0,10);
    dir.writeUInt32LE(crc,16);
    dir.writeUInt32LE(bytes.length,20);
    dir.writeUInt32LE(bytes.length,24);
    dir.writeUInt16LE(filename.length,28);
    dir.writeUInt32LE(offset,42);
    central.push(dir,filename);
    offset+=local.length+filename.length+bytes.length;
  }
  const cd=Buffer.concat(central);
  const eocd=Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50,0);
  eocd.writeUInt16LE(entries.length,8);
  eocd.writeUInt16LE(entries.length,10);
  eocd.writeUInt32LE(cd.length,12);
  eocd.writeUInt32LE(offset,16);
  const kmz=Buffer.concat([...locals,cd,eocd]);
  if(kmz.length>MAX_ZIP)throw Error('KMZ package exceeds size limit');
  return kmz;
}
module.exports={readKmz,inspectKmz,packageKmz,crc32};
