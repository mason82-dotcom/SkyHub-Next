#!/usr/bin/env node
'use strict';
// Local read-only inspection of two bounded DJI WPML KMZ files.
// Output never contains XML/mission coordinates, mission names or user filenames.
const fs=require('node:fs');
const {compareKmz}=require('../backend/wpml-compare');
function main(argv){
  const review=argv[0]==='--review';
  const paths=review?argv.slice(1):argv;
  if(paths.length!==2){
    process.stderr.write('Usage: node scripts/wpml-compare.js [--review] original.kmz skyhub.kmz\n');
    process.exitCode=2;return;
  }
  const [a,b]=paths;
  const max=12*1024*1024;
  const leftStat=fs.statSync(a),rightStat=fs.statSync(b);
  if(!leftStat.isFile()||!rightStat.isFile()||
     leftStat.size<22||rightStat.size<22||
     leftStat.size>max||rightStat.size>max)throw Error('invalid file size');
  const report=compareKmz(fs.readFileSync(a),fs.readFileSync(b));
  // --review is a *display-only* filter, not a weaker comparison or exit code.
  // Geometry, waypoint and unknown differences still count in the overall result.
  const output=review?{
    comparisonSchema:report.comparisonSchema,
    displayMode:'focused-review-not-complete-diff',
    left:report.left,right:report.right,summary:report.summary,
    reviewedCategories:['actions','cameraFormats','heightReferences','payload','mission'],
    focusChanges:report.documents.map(d=>({
      file:d.file,
      allDifferenceOccurrences:d.totalChanges,
      totalPatterns:d.patterns.total,
      selectedPatterns:d.patterns.entries.filter(p=>
        ['actions','cameraFormats','heightReferences','payload','mission'].includes(p.category)),
      sourcePatternsTruncated:d.patterns.truncated
    })),
    warning:'Focused display hides geometry/waypoint/other details; exit code still checks ALL differences. No Pilot 2 import or flight certification.',
    privacy:report.privacy,
    flightReady:false
  }:report;
  process.stdout.write(JSON.stringify(output,null,2)+'\n');
  if(!report.left.valid||!report.right.valid)process.exitCode=2;
  else if(report.summary.structuralDifferences>0||
          !report.summary.resourceCountMatches)process.exitCode=1;
}
try{main(process.argv.slice(2));}
catch(_error){
  // Archive data, filenames, GPS positions and filesystem paths remain private.
  process.stderr.write('WPML comparison failed: inspect both local KMZ archives and their permissions.\n');
  process.exitCode=2;
}
