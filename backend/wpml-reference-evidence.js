'use strict';
// Operator-supplied local KMZ evidence; never authenticate provenance by a role label.
// No raw coordinate, private file path, XML, file hash, mission name or media output.
// Deliberately NOT a Go-SDK execution, DJI Pilot 2 test or aircraft authorization.
const {auditReferenceKmz}=require('./wpml-reference-audit');
const {compareKmz}=require('./wpml-compare');

const ROLES=Object.freeze(['skyhub','goSdk','pilot2']);
const SCHEMA='skyhub-wpml-reference-evidence-v1';
function invalid(){throw Error('WPML evidence rejected: malformed or unsupported local files');}
function buildEvidenceReport(artifacts){
  if(!Array.isArray(artifacts)||artifacts.length<2||artifacts.length>3)invalid();
  const provided=new Map();
  for(const item of artifacts){
    if(!item||typeof item!=='object'||!ROLES.includes(item.role)||
       !Buffer.isBuffer(item.bytes)||item.bytes.length<22||
       item.bytes.length>12*1024*1024||provided.has(item.role))invalid();
    provided.set(item.role,item.bytes);
  }
  const roles=ROLES.filter(role=>provided.has(role));
  const audits=new Map();
  const inputs=roles.map(role=>{
    let report;
    try{report=auditReferenceKmz(provided.get(role));}catch{invalid();}
    audits.set(role,report);
    return {
      role,
      provenance:'operator-declared-unverified',
      offlineValid:report.offlineValid,
      namespaceCheck:report.namespaceCheck,
      inspectionMode:report.inspectionMode,
      reviewStatus:report.reviewStatus,
      findings:report.findings,
      flightReady:false
    };
  });
  const comparisons=[];
  for(let i=0;i<roles.length;i++){
    for(let j=i+1;j<roles.length;j++){
      const left=roles[i],right=roles[j];
      const leftBytes=provided.get(left),rightBytes=provided.get(right);
      const binaryEqual=leftBytes.equals(rightBytes);
      const a=audits.get(left),b=audits.get(right);
      if(a.reviewStatus==='blocked'||b.reviewStatus==='blocked'||
         a.offlineValid!==true||b.offlineValid!==true){
        comparisons.push({leftRole:left,rightRole:right,
          comparisonStatus:'skipped-noncomparable-or-blocked',
          inputBytesIdentical:binaryEqual,
          structuralEqual:null,structuralDifferenceCount:null,
          independentlyProvenanced:false,flightReady:false});
        continue;
      }
      let c;
      try{c=compareKmz(leftBytes,rightBytes);}catch{invalid();}
      comparisons.push({leftRole:left,rightRole:right,
        comparisonStatus:'compared',
        inputBytesIdentical:binaryEqual,
        structuralEqual:c.summary.structurallyEqualExcludingVolatileMetadata &&
          c.summary.resourceCountMatches,
        structuralDifferenceCount:c.summary.structuralDifferences,
        resourceCountMatches:c.summary.resourceCountMatches,
        cameraActionSummariesDiffer:c.summary.cameraActionSummariesDiffer,
        independentlyProvenanced:false,flightReady:false});
    }
  }
  const blocked=inputs.some(x=>x.reviewStatus==='blocked');
  const requiresReview=blocked||inputs.some(x=>x.reviewStatus!=='no-listed-divergence-observed')||
    comparisons.some(x=>x.inputBytesIdentical||x.comparisonStatus!=='compared'||
      x.structuralEqual!==true);
  return {
    schema:SCHEMA,
    evidence:'operator-declared-local-files-not-authenticated',
    roleCount:roles.length,
    pairCount:comparisons.length,
    inputs,comparisons,
    summary:{
      allFilesIndependentlyVerified:false,
      allStructurallyComparable:comparisons.every(x=>x.comparisonStatus==='compared'),
      noListedStructuralDifference:comparisons.every(x=>x.structuralEqual===true),
      anyInputByteIdentical:comparisons.some(x=>x.inputBytesIdentical),
      requiresReview,
      reviewStatus:blocked?'blocked':requiresReview?'review-required':'no-listed-divergence-observed'
    },
    actualGoSdkExecutableRun:false,
    actualPilot2ImportTest:false,
    flightReady:false,
    pilot2HardwareVerified:false,
    missionDispatchEnabled:false,
    privacy:'only fixed roles, statuses, aggregate counts and diagnostic codes; paths/bytes/hashes excluded',
    scope:'offline-operator-evidence-review-not-authenticated-source-or-flight-certification'
  };
}
module.exports={buildEvidenceReport,ROLES};
