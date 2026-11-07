'use strict';
// Synthetic, deterministic regression corpus: NEVER actual Go-SDK or Pilot 2 output.
// In-memory only; no drone controls, GPS output, file downloads, or network.
const planner=require('../frontend/public/wpml-editor-core');
const {auditReferenceKmz}=require('./wpml-reference-audit');
const MODELS=Object.freeze(['mavic3e','mavic3t','mavic3m','matrice4e','matrice4t']);
const CASES=Object.freeze([
  'skyhub-baseline',
  'sdk-style-rc-loss',
  'sdk-style-subtype-zero',
  'sdk-style-height-copy',
  'sdk-style-degree-distance',
  'sdk-style-namespace-1.0.6'
]);
function docs(model,scenario){
  const plan={name:'Synthetic offline regression',model,finishAction:'goHome',
    speed:5,transitionSpeed:5,takeoffHeight:30,timestamp:1792573200000,
    waypoints:[{lat:49,lon:8,height:50,photo:true},
      {lat:49,lon:8.04,height:50,photo:false}]};
  const generated=planner.documents(plan);
  let template=generated.templateXml,waylines=generated.waylinesXml;
  function transform(fn){template=fn(template);waylines=fn(waylines);}
  if(scenario==='sdk-style-rc-loss'){
    transform(xml=>xml
      .replace('<wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>',
        '<wpml:exitOnRCLost>goContinue</wpml:exitOnRCLost>')
      .replace('<wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>',
        '<wpml:executeRCLostAction>hover</wpml:executeRCLostAction>'));
  }else if(scenario==='sdk-style-subtype-zero'){
    transform(xml=>xml.replace(/<wpml:droneSubEnumValue>\d+<\/wpml:droneSubEnumValue>/,
      '<wpml:droneSubEnumValue>0</wpml:droneSubEnumValue>'));
  }else if(scenario==='sdk-style-height-copy'){
    template=template.replace('<wpml:height>50</wpml:height>',
      '<wpml:ellipsoidHeight>50</wpml:ellipsoidHeight><wpml:height>50</wpml:height>');
  }else if(scenario==='sdk-style-degree-distance'){
    waylines=waylines.replace('</Folder>',
      '<wpml:distance>4440</wpml:distance><wpml:duration>888</wpml:duration></Folder>');
  }else if(scenario==='sdk-style-namespace-1.0.6'){
    transform(xml=>xml.replace('http://www.dji.com/wpmz/1.0.2',
      'http://www.dji.com/wpmz/1.0.6'));
  }else if(scenario!=='skyhub-baseline')throw Error('unknown synthetic scenario');
  return [template,waylines];
}
function runReferenceMatrix(){
  const cases=[];
  for(const model of MODELS){
    for(const scenario of CASES){
      const [template,waylines]=docs(model,scenario);
      const kmz=Buffer.from(planner.createKmz(template,waylines));
      const report=auditReferenceKmz(kmz);
      cases.push({
        model,scenario,
        reviewStatus:report.reviewStatus,
        offlineValid:report.offlineValid,
        namespaceCheck:report.namespaceCheck,
        findings:report.findings,
        flightReady:false
      });
    }
  }
  return Object.freeze({
    schema:'skyhub-wpml-synthetic-compat-matrix-v1',
    modelCount:MODELS.length,
    scenarioCount:CASES.length,
    caseCount:cases.length,
    source:'synthetic-skyhub-generated-mutations-only',
    actualGoSdkExecutableRun:false,
    actualPilot2ImportTest:false,
    noReferenceHardwareOrRemoteOperations:true,
    flightReady:false,
    cases
  });
}
module.exports={runReferenceMatrix,MODELS,CASES};
