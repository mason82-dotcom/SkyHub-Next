#!/usr/bin/env node
'use strict';
// Purely offline JSON waypoints -> DJI WPML KMZ. Never sends flight commands.
const fs=require('node:fs');
const {build}=require('../frontend/public/wpml-editor-core');
const {inspectKmz}=require('../backend/wpml-kmz');
function main(args){
  if(args.length!==2){
    process.stderr.write('Usage: node scripts/wpml-plan.js draft.json output.kmz\n');
    process.exitCode=2;return;
  }
  const [input,output]=args;
  const size=fs.statSync(input).size;
  if(size>128*1024||size<2)throw Error('JSON input must be 2–131072 bytes');
  const inputData=JSON.parse(fs.readFileSync(input,'utf8'));
  const result=build(inputData);
  const kmz=Buffer.from(result.kmz);
  const inspected=inspectKmz(kmz);
  if(!inspected.valid)throw Error('Generated WPML failed offline validator');
  fs.writeFileSync(output,kmz,{flag:'wx',mode:0o600});
  process.stdout.write('WPML KMZ generated offline: '+
    result.summary.waypointCount+' waypoints, '+result.summary.photoCount+
    ' reach-point photo actions'+
    (result.summary.intervalPhotos?', draft '+result.summary.intervalPhotos.type+
      ' trigger every '+result.summary.intervalPhotos.interval+' '+
      result.summary.intervalPhotos.unit+' (hardware UNVERIFIED)':'')+
    '; flightReady=false.\n');
}
try{main(process.argv.slice(2));}
catch(_error){
  // Never emit source JSON, positions, filenames or secret details.
  process.stderr.write('WPML generation rejected: check input, output permissions and WPML rules.\n');
  process.exitCode=2;
}
