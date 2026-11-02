'use strict';
// Lab-only, one-shot MQTT mission exercise. This file never runs as a service.
// It is intentionally hardcoded to a synthetic device and private lab broker.
const crypto = require('node:crypto');
// Under node:test there is no argv[2]; the fixture is deliberately synthetic.
const GATEWAY = process.argv[2] || '7UUXNABCDE1234';
const EXPECTED_DOCK3_SN = /^7UUXN[A-Z0-9]{9}$/;
const FLIGHT_ID = 'skyhub-lab-mission-01';
const ALLOWED = Object.freeze(['flighttask_prepare','flighttask_execute','flighttask_pause','flighttask_recovery','flighttask_undo','flighttask_stop']);
const TIMEOUT_MS = 12000;
let phase='init';
const safe = (v) => v && typeof v === 'object' && !Array.isArray(v);
const uuid = (x) => typeof x === 'string' && /^[a-f0-9-]{36}$/i.test(x);

function requestEnvelope(method, data, tid, bid, now=Date.now()) {
  if (!EXPECTED_DOCK3_SN.test(GATEWAY) || !ALLOWED.includes(method) || !uuid(tid) || !uuid(bid) || !safe(data) ||
      (method==='flighttask_prepare'||method==='flighttask_execute') &&
        (data.flight_id!==FLIGHT_ID) ||
      method==='flighttask_stop' && (data.flight_id!==FLIGHT_ID || data.reason!==0) ||
      method==='flighttask_undo' && (!Array.isArray(data.flight_ids) ||
        data.flight_ids.length!==1 || data.flight_ids[0]!==FLIGHT_ID))
    throw Error('lab mission contract violated');
  return {tid,bid,timestamp:now,gateway:GATEWAY,method,data};
}
function replyMatches(msg, expected, expectedResult=0) {
  return safe(msg) && msg.tid===expected.tid && msg.bid===expected.bid &&
    msg.method===expected.method && msg.gateway===GATEWAY &&
    safe(msg.data) && msg.data.result===expectedResult &&
    Number.isSafeInteger(msg.timestamp);
}
function validProgress(msg, executeBid) {
  const out=msg?.data?.output, progress=out?.progress;
  return safe(msg) && msg.method==='flighttask_progress' &&
    msg.gateway===GATEWAY && msg.bid===executeBid &&
    msg.data?.result===0 && safe(out) && safe(out.ext) &&
    out.ext.flight_id===FLIGHT_ID && safe(progress) &&
    Number.isInteger(progress.current_step) &&
    Number.isInteger(progress.percent) &&
    progress.percent>=0 && progress.percent<=100 &&
    typeof out.status==='string';
}
async function run() {
  if (process.argv.length!==3 || !EXPECTED_DOCK3_SN.test(process.argv[2]))
    throw Error('Only the pinned Dock3 test identity is accepted');
  phase='mqtt_connect';
  const mqtt=require('mqtt');
  const client=mqtt.connect('mqtt://hivemind-broker:1884',{
    clientId:'skyhub_hivemind_mission_'+crypto.randomBytes(6).toString('hex'),
    protocolVersion:5,reconnectPeriod:0,connectTimeout:5000
  });
  const pending=new Map(),progress=[];
  const services='thing/product/'+GATEWAY+'/services';
  let completed=false;
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('private MQTT connection timeout')),8000);
      client.once('connect',()=>{
        client.subscribe([
          'thing/product/'+GATEWAY+'/services_reply',
          'thing/product/'+GATEWAY+'/events'
        ],{qos:0},(err,granted)=>{
          clearTimeout(timer);
          if(err||!Array.isArray(granted)||granted.length!==2||
             granted.some(g=>g.qos===128))reject(Error('lab subscription refused'));
          else resolve();
        });
      });
      client.once('error',()=>{clearTimeout(timer);reject(Error('lab broker unavailable'));});
    });
    let execBid=null, undoBid=null;
    const cancellation=[];
    client.on('message',(topic,bytes,packet)=>{
      if(packet?.retain||!Buffer.isBuffer(bytes)||bytes.length>16384)return;
      let msg;try{msg=JSON.parse(bytes.toString('utf8'));}catch{return;}
      if(topic.endsWith('/services_reply')){
        const item=pending.get(msg?.tid);
        if(!item)return;
        pending.delete(msg.tid);
        clearTimeout(item.timer);
        if(replyMatches(msg,item.request,item.expectedResult))item.resolve(msg);
        else item.reject(Error('service reply mismatch or failure'));
      }else if(topic.endsWith('/events') && undoBid && validProgress(msg,undoBid) &&
          msg.data.output.status==='canceled')cancellation.push(true);
      else if(topic.endsWith('/events') && execBid &&
          validProgress(msg,execBid))progress.push({step:msg.data.output.progress.current_step,
          percent:msg.data.output.progress.percent,status:msg.data.output.status});
    });
    async function command(method,data,bid=crypto.randomUUID(),expectedResult=0){
      const tid=crypto.randomUUID();
      const req=requestEnvelope(method,data,tid,bid);
      const wait=new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(tid);reject(Error('service reply timeout: '+method));},TIMEOUT_MS);
        pending.set(tid,{request:req,expectedResult,resolve,reject,timer});
      });
      client.publish(services,JSON.stringify(req),{qos:0,retain:false},err=>{
        if(err){const p=pending.get(tid);if(p){pending.delete(tid);clearTimeout(p.timer);p.reject(Error('lab publish failed'));}}
      });
      await wait;
    }
    phase='prepare_before_cancel';
    await command('flighttask_prepare',{flight_id:FLIGHT_ID,task_type:0,rth_altitude:50});
    phase='ground_undo';
    undoBid=crypto.randomUUID();
    await command('flighttask_undo',{flight_ids:[FLIGHT_ID]},undoBid);
    phase='await_cancel_event';
    // MQTT QoS 0 progress delivery can lag behind services_reply during
    // GitHub runner startup; keep a bounded observation window, fail closed.
    const canceledUntil=Date.now()+10000;
    while(cancellation.length===0 && Date.now()<canceledUntil)
      await new Promise(resolve=>setTimeout(resolve,100));
    if(cancellation.length===0)throw Error('Ground cancellation event not confirmed');
    phase='prepare_after_cancel';
    await command('flighttask_prepare',{flight_id:FLIGHT_ID,task_type:0,rth_altitude:50});
    phase='execute';
    execBid=crypto.randomUUID();
    await command('flighttask_execute',{flight_id:FLIGHT_ID},execBid);
    phase='await_progress';
    const until=Date.now()+14000;
    while(progress.length===0 && Date.now()<until)
      await new Promise(resolve=>setTimeout(resolve,250));
    if(progress.length===0)throw Error('no simulator flighttask_progress event');
    // The simulator must reject flighttask_stop when already airborne.
    phase='airborne_stop';
    await command('flighttask_stop',{flight_id:FLIGHT_ID,reason:0},
      crypto.randomUUID(),326109);
    phase='pause';
    await command('flighttask_pause',{});
    phase='recovery';
    await command('flighttask_recovery',{});
    completed=true;
    console.log('PASS: synthetic ground cancel, airborne stop rejected, execute/progress/pause/recovery');
  }finally{
    for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('connection closed'));}
    pending.clear();
    await new Promise(resolve=>client.end(true,resolve));
  }
  if(!completed)throw Error('mission probe did not finish');
}
if(require.main===module){
  run().catch(_e=>{console.error('FAIL_STAGE: '+phase);process.exitCode=1;});
}
module.exports={GATEWAY,FLIGHT_ID,ALLOWED,EXPECTED_DOCK3_SN,requestEnvelope,replyMatches,validProgress};
