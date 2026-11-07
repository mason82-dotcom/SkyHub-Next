#!/usr/bin/env node
'use strict';
// All KMZ files stay on this host; the manifest itself is never copied to output.
// Only operator-declared provenance; never interpret a filename as DJI certification.
const fs=require('node:fs');
const path=require('node:path');
const {parseJson}=require('../frontend/public/wpml-waylines-reference');
const {buildEvidenceReport,ROLES}=require('../backend/wpml-reference-evidence');
function invalid(){throw Error('invalid manifest');}
function strictKeys(obj,keys){
  if(!obj||typeof obj!=='object'||Array.isArray(obj)||
     Object.getPrototypeOf(obj)!==Object.prototype)invalid();
  if(Object.keys(obj).some(key=>!keys.includes(key)))invalid();
}
function readBounded(pathname,max){
  const flags=fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0);
  const fd=fs.openSync(pathname,flags);
  try{
    const st=fs.fstatSync(fd);
    if(!st.isFile()||st.size<1||st.size>max)invalid();
    const data=fs.readFileSync(fd);
    if(data.length!==st.size)invalid();
    return data;
  }finally{fs.closeSync(fd);}
}
function readManifest(manifestName){
  if(typeof manifestName!=='string'||!manifestName.trim())invalid();
  const manifestPath=path.resolve(manifestName);
  const st=fs.lstatSync(manifestPath);
  if(!st.isFile()||st.isSymbolicLink())invalid();
  const dir=path.dirname(fs.realpathSync(manifestPath));
  const bytes=readBounded(manifestPath,8*1024);
  const manifest=parseJson(bytes.toString('utf8'));
  strictKeys(manifest,['schema','files']);
  if(manifest.schema!=='skyhub-wpml-reference-fixtures-v1')invalid();
  strictKeys(manifest.files,ROLES);
  const roles=ROLES.filter(role=>Object.hasOwn(manifest.files,role));
  if(roles.length<2||roles.length>3)invalid();
  return roles.map(role=>{
    const name=manifest.files[role];
    if(typeof name!=='string'||name.length<1||name.length>240||
      name.includes('\\')||/[\u0000-\u001f\u007f]/.test(name)||
      path.isAbsolute(name)||name.split('/').some(p=>p===''||p==='.'||p==='..'))invalid();
    const pathname=path.resolve(dir,name);
    const delta=path.relative(dir,pathname);
    if(!delta||delta.startsWith('..'+path.sep)||delta==='..'||path.isAbsolute(delta))invalid();
    const fileStat=fs.lstatSync(pathname);
    if(!fileStat.isFile()||fileStat.isSymbolicLink())invalid();
    const real=fs.realpathSync(pathname);
    const realDelta=path.relative(dir,real);
    if(!realDelta||realDelta==='..'||realDelta.startsWith('..'+path.sep)||
       path.isAbsolute(realDelta))invalid();
    return {role,bytes:readBounded(pathname,12*1024*1024)};
  });
}
function main(argv){
  if(argv.length!==1)invalid();
  const report=buildEvidenceReport(readManifest(argv[0]));
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  return report.summary.reviewStatus==='blocked'?2:
    report.summary.reviewStatus==='review-required'?1:0;
}
try{process.exitCode=main(process.argv.slice(2));}
catch{
  process.stderr.write('WPML reference evidence: invalid or unsupported local manifest/KMZ; no paths or mission content disclosed.\n');
  process.exitCode=2;
}
