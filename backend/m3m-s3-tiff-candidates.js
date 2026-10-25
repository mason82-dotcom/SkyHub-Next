'use strict';
// Bounded read-only S3 directory enumeration. Keys are private outputs for
// local, in-memory handoff ONLY; never serialize or log them to a terminal.
const {validatePrefix}=require('./m3m-s3-inventory');
const {identify}=require('./m3m-media-inventory');
const MAX_PAGES=101,PAGE_SIZE=200,MAX_DIRECT=20000,MAX_TIFF=12;
async function collectTiffs(storage,prefix,includeKnown){
  if(typeof includeKnown!=='boolean')
    throw new TypeError('Invalid TIFF selection mode');
  validatePrefix(prefix);
  let cursor,seen=new Set(),pages=0,direct=0;
  const keys=[];
  while(pages<MAX_PAGES){
    pages++;
    const page=await storage.objects('dji-cloud',{
      prefix,limit:PAGE_SIZE,...(cursor?{cursor}:{})
    });
    if(!page||!Array.isArray(page.objects)||
       page.objects.length>PAGE_SIZE||
       typeof page.truncated!=='boolean')
      throw new Error('Invalid TIFF list response');
    for(const item of page.objects){
      const key=item?.key;
      if(typeof key!=='string'||!key.startsWith(prefix))
        throw new Error('Invalid TIFF object key');
      const relative=key.slice(prefix.length);
      if(!relative||relative.includes('/'))continue;
      direct++;
      if(direct>MAX_DIRECT)throw new RangeError('Too many direct objects');
      if(/\.tiff?$/i.test(relative)&&(includeKnown||!identify(relative))){
        if(keys.length>=MAX_TIFF)throw new RangeError('TIFF probe cap exceeded');
        if(keys.includes(key))throw new Error('Duplicate TIFF object key');
        keys.push(key);
      }
    }
    if(!page.truncated)return keys;
    const next=page.nextCursor;
    if(typeof next!=='string'||!next||next.length>4096||seen.has(next))
      throw new Error('Invalid TIFF pagination');
    seen.add(next);
    cursor=next;
  }
  throw new RangeError('TIFF page cap exceeded');
}
async function collectUnknownTiffs(storage,prefix){
  return collectTiffs(storage,prefix,false);
}
async function collectAllTiffs(storage,prefix){
  return collectTiffs(storage,prefix,true);
}
module.exports={collectUnknownTiffs,collectAllTiffs,MAX_TIFF};
