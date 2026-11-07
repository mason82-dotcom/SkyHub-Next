#!/usr/bin/env node
'use strict';
// Offline helper; does not contact DJI, MQTT or SkyHub live services.
const fs=require('node:fs');
const {inspectKmz,packageKmz}=require('../backend/wpml-kmz');
function main(argv){
  if(argv.length===1&&argv[0]!=='--pack'){
    const report=inspectKmz(fs.readFileSync(argv[0]));
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
    if(!report.valid)process.exitCode=2;
    return;
  }
  if(argv.length===4&&argv[0]==='--pack'){
    const [template,waylines,out]=argv.slice(1);
    const kmz=packageKmz(fs.readFileSync(template,'utf8'),fs.readFileSync(waylines,'utf8'));
    fs.writeFileSync(out,kmz,{flag:'wx',mode:0o600});
    process.stdout.write('KMZ generated (offline): '+out+'\n');
    return;
  }
  process.stderr.write('Usage:\n  node scripts/wpml-inspect.js mission.kmz\n'+
    '  node scripts/wpml-inspect.js --pack template.kml waylines.wpml output.kmz\n');
  process.exitCode=2;
}
try{main(process.argv.slice(2));}
catch(err){
  // No mission XML, uploaded filename content or internal decompression data in error output.
  process.stderr.write('WPML operation failed: '+String(err.message).slice(0,200)+'\n');
  process.exitCode=2;
}
