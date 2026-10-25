#!/usr/bin/env node
'use strict';
// Builds backend/data/hms-texts.json from DJI's hms.json: the official file linked in
// the Cloud API docs (see backend/data/HMS-LICENSE.txt for provenance and license
// status) or the older Cloud-API-Demo copy (MIT License, (c) 2022 DJI-SDK). Keeps only well-formed keys and German/English
// plain text, so nothing unexpected from the vendor file reaches SkyHub.
//   node scripts/build-hms-texts.js <path/to/dji/hms.json>
const fs=require('node:fs');
const path=require('node:path');

const source=process.argv[2];
if(!source){console.error('Verwendung: node scripts/build-hms-texts.js <hms.json>');process.exit(2);}
const raw=JSON.parse(fs.readFileSync(source,'utf8'));
const KEY=/^(fpv|dock)_tip_0x([0-9A-Fa-f]{8})(_in_the_sky)?$/;
const clean=value=>typeof value==='string' && value.length>0 && value.length<=400 &&
  !/[<>]/.test(value) ? value.replace(/\s+/g,' ').trim() : null;
const out={};
for(const [key,entry] of Object.entries(raw)){
  const match=KEY.exec(key);
  if(!match || !entry || typeof entry!=='object')continue;
  const en=clean(entry.en),de=clean(entry.de);
  if(!en && !de)continue;
  // Normalised key: prefix + upper-case hex + optional in-the-sky variant.
  out[match[1]+'_tip_0x'+match[2].toUpperCase()+(match[3]||'')]={...(de?{de}:{}),...(en?{en}:{})};
}
const target=path.resolve(__dirname,'../backend/data/hms-texts.json');
fs.mkdirSync(path.dirname(target),{recursive:true});
fs.writeFileSync(target,JSON.stringify(out)+'\n');
console.log(Object.keys(out).length+' HMS-Texte geschrieben: '+path.relative(process.cwd(),target));
