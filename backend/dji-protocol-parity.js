'use strict';

// Offline-only, synthetic DJI Cloud API 1.18 parity audit.
// Importing this module never connects to MQTT, reads device data or publishes commands.
// Reference: cd miltd/dji-cloud-api-sdk v1.18.0.2; see docs/dji-protocol-parity-audit.md.
const {parseMessage}=require('./dji');
const {classifyMessage}=require('./message-guard');
const {createStatusReply}=require('./topology-ack');
const {resolveDeviceModel}=require('./catalog');

const FIXTURE_SCHEMA='skyhub-dji-parity-fixtures-v1';
const REPORT_SCHEMA='skyhub-dji-parity-report-v1';
const MAX_CASES=64;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID=/^[a-z][a-z0-9-]{2,63}$/;
const EXPECTED_KEYS=new Set([
  'intakeAccepted','channel','gatewayModel','aircraftModel',
  'modelResolution','replyEligible','replyShape','transactionValid'
]);

function object(value){
  return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
function serviceReplyShape(envelope){
  const data=envelope?.data;
  if(!object(data)||!Object.hasOwn(data,'result'))return 'invalid-shape';
  const keys=Object.keys(data);
  if(Number.isSafeInteger(data.result)){
    if(Object.hasOwn(data,'output')){
      if(keys.length!==2||!object(data.output))return 'ambiguous-shape';
      return 'result-output';
    }
    return keys.length===1?'result-only':'result-flat';
  }
  if(object(data.result)&&Number.isSafeInteger(data.result.code)&&keys.length===1){
    // Used in the separate SkyHub RPC design; not a hardware-confirmed DJI variant.
    return 'object-result-candidate';
  }
  return 'invalid-shape';
}

function inspectFixture(entry){
  // Only explicitly authored synthetic fixtures are supported. Nothing is logged.
  if(!object(entry)||!SAFE_ID.test(entry.id)||!Number.isSafeInteger(entry.now)||
    entry.now<1e12||!object(entry.envelope)||typeof entry.topic!=='string'||
    entry.topic.length>150||Buffer.byteLength(JSON.stringify(entry.envelope))>131072){
    throw new Error('Invalid parity fixture');
  }
  const output={
    intakeAccepted:false,channel:null,gatewayModel:null,aircraftModel:null,
    modelResolution:'not-applicable',replyEligible:false,
    replyShape:'not-applicable',transactionValid:false
  };
  const raw=Buffer.from(JSON.stringify(entry.envelope));
  let parsed;
  try{
    parsed=parseMessage(entry.topic,raw);
  }catch(_error){
    output.modelResolution='parse-rejected';
    return output;
  }
  if(!parsed){
    output.modelResolution='topic-rejected';
    return output;
  }
  output.channel=parsed.channel;
  output.transactionValid=UUID.test(entry.envelope.tid??'')&&
    UUID.test(entry.envelope.bid??'')&&Number.isSafeInteger(parsed.timestamp);
  const gate=classifyMessage(parsed,{retain:entry.retained===true},entry.now);
  output.intakeAccepted=gate.accept===true;
  if(!output.intakeAccepted){
    output.modelResolution='not-inspected';
    output.replyShape='not-inspected';
    return output;
  }
  if(parsed.channel==='status'&&parsed.method==='update_topo'){
    const topo=parsed.topology;
    if(!topo){output.modelResolution='no-topology';return output;}
    output.gatewayModel=resolveDeviceModel(topo.model);
    const children=topo.children;
    if(children.length===0)output.modelResolution='no-child';
    else if(children.length!==1)output.modelResolution='multiple-children';
    else if(children[0].model.domain===null)output.modelResolution='unknown-domain';
    else{
      output.aircraftModel=resolveDeviceModel(children[0].model);
      output.modelResolution=output.aircraftModel===null?'unknown-model':'resolved';
    }
    output.replyEligible=Boolean(createStatusReply(parsed,raw,entry.now));
  }
  if(parsed.channel==='services_reply'){
    output.replyShape=output.transactionValid?
      serviceReplyShape(entry.envelope):'invalid-transaction';
  }
  return output;
}

function runAudit(fixtures){
  if(!object(fixtures)||fixtures.schema!==FIXTURE_SCHEMA||
    !Array.isArray(fixtures.cases)||fixtures.cases.length<1||
    fixtures.cases.length>MAX_CASES)throw new Error('Invalid parity fixture collection');
  const ids=new Set(),results=[];
  for(const entry of fixtures.cases){
    if(!object(entry)||!object(entry.expect)||ids.has(entry.id))throw new Error('Invalid parity case');
    ids.add(entry.id);
    const expectedKeys=Object.keys(entry.expect);
    if(!expectedKeys.length||expectedKeys.some(key=>!EXPECTED_KEYS.has(key)))
      throw new Error('Invalid parity expectation');
    const observed=inspectFixture(entry);
    const mismatchedFields=expectedKeys.filter(key=>observed[key]!==entry.expect[key]);
    results.push({
      id:entry.id,
      result:mismatchedFields.length?'mismatch':'pass',
      mismatchedFields,
      // Flag known protocol uncertainties separately from regression failures.
      unresolvedModel:observed.modelResolution==='unknown-domain'||
        observed.modelResolution==='unknown-model',
      unverifiedReplyVariant:observed.replyShape==='object-result-candidate'
    });
  }
  const failed=results.filter(x=>x.result!=='pass').length;
  return {
    schema:REPORT_SCHEMA,
    reference:'cdmiltd/dji-cloud-api-sdk@1.18.0.2',
    classification:'bounded-synthetic-fixtures-only',
    hardwareVerified:false,
    flightReady:false,
    liveMqttUsed:false,
    total:results.length,
    passed:results.length-failed,
    failed,
    unresolvedModelCases:results.filter(x=>x.unresolvedModel).length,
    candidateReplyCases:results.filter(x=>x.unverifiedReplyVariant).length,
    cases:results
  };
}

module.exports={inspectFixture,serviceReplyShape,runAudit,FIXTURE_SCHEMA,REPORT_SCHEMA};
