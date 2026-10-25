#!/usr/bin/env node
'use strict';

// Reads bundled synthetic fixtures only; no external input, MQTT or DJI hardware.
const fixtures=require('../backend/data/dji-118-parity-fixtures.json');
const {runAudit}=require('../backend/dji-protocol-parity');

try{
  const report=runAudit(fixtures);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(report.failed!==0)process.exitCode=1;
}catch(_error){
  // Never print fixture data, paths, raw messages or user-supplied values.
  process.stderr.write('DJI synthetic parity audit failed safely.\n');
  process.exitCode=2;
}
