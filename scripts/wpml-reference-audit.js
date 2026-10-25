#!/usr/bin/env node
'use strict';
// Read-only local KMZ risk inspection. Never print filenames, raw XML, or coordinates.
const fs=require('node:fs');
const {auditReferenceKmz}=require('../backend/wpml-reference-audit');
function main(args){
  if(args.length!==1) {
    process.stderr.write('WPML reference audit: exactly one local KMZ argument required\n');
    return 2;
  }
  try{
    const report=auditReferenceKmz(fs.readFileSync(args[0]));
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
    return report.reviewStatus==='blocked'?2:report.findingCount>0?1:0;
  }catch {
    process.stderr.write('WPML reference audit: unreadable, malformed or unsupported KMZ\n');
    return 2;
  }
}
process.exitCode=main(process.argv.slice(2));
