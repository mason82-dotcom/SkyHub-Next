#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const {MODELS,reviewPlanarKmz}=require('../backend/planar-wayline-compat');
const [filename,targetModel]=process.argv.slice(2);
if(!filename||process.argv.length>4||(targetModel&&!Object.hasOwn(MODELS,targetModel))){
  process.stderr.write('Usage: node scripts/audit-planar-wayline-kmz.js FILE.kmz [mavic3m|matrice4t|mavic3e|mavic3t|matrice4e]\n');
  process.exitCode=2;
}else{
  try{
    const stat=fs.statSync(filename);
    if(!stat.isFile()||stat.size<22||stat.size>12*1024*1024)
      throw Error('Unsupported file size');
    const result=reviewPlanarKmz(fs.readFileSync(filename),{targetModel:targetModel||null});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }catch{
    process.stderr.write('Invalid or unsupported KMZ archive\n');
    process.exitCode=1;
  }
}