'use strict';
// One-shot metadata-only DJI media acceptance. No STS, S3, uploads or shell access.
const crypto = require('node:crypto');

const FLIGHT = 'skyhub-lab-media-01';
const COUNT = 2;
const SN = /^7UUXN[A-Z0-9]{9}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const METHODS = Object.freeze(['highest_priority_upload_flighttask_media','file_upload_callback']);
function envelope(topic, value, sn, now=Date.now()) {
  if (topic!=='thing/product/'+sn+'/events' || !value || typeof value!=='object' ||
      Array.isArray(value) || !METHODS.includes(value.method) ||
      !UUID.test(value.tid) || !UUID.test(value.bid) ||
      value.gateway!==sn || !Number.isSafeInteger(value.timestamp) ||
      Math.abs(value.timestamp-now)>60000) return null;
  if (value.method==='highest_priority_upload_flighttask_media')
    return value.data?.flight_id===FLIGHT ? {tid:value.tid,bid:value.bid,method:value.method} : null;
  const f=value.data?.file;
  if (!f || typeof f!=='object' || f.ext?.flight_id!==FLIGHT ||
      !/^SIM_skyhub-lab-media-01_[12]\.jpg$/.test(f.name) ||
      f.object_key!=='sim/'+FLIGHT+'/'+f.name || f.path!==FLIGHT) return null;
  return {tid:value.tid,bid:value.bid,method:value.method,name:f.name};
}
function correlate(sent,reply) {
  return !!sent && !!reply && sent.tid===reply.tid && sent.bid===reply.bid &&
    sent.method===reply.method && reply.data?.result===0;
}
function denyStorage(request,reply,sn) {
  return request?.method==='storage_config_get' && request.gateway===sn &&
    reply?.method==='storage_config_get' && reply.tid===request.tid &&
    reply.bid===request.bid && reply.data?.result===1 &&
    !reply.data?.output && !reply.data?.bucket && !reply.data?.credentials;
}
async function getJson(url, options) {
  // Only the simulator's private Compose DNS API may be used.
  if (!/^http:\/\/hivemind-simulator:9090\/api\/media(?:\/trigger|\/files)?$/.test(url))
    throw Error('Disallowed media API target');
  const response=await fetch(url,{...options, redirect:'error', signal:AbortSignal.timeout(6000)});
  if (!response.ok)throw Error('Lab simulator media API failed');
  return response.json();
}
async function run(){
  const mqtt=require('mqtt');
  if(process.argv.length!==3 || !SN.test(process.argv[2]))throw Error('Invalid synthetic Dock3 SN');
  const sn=process.argv[2];
  const base='http://hivemind-simulator:9090/api/media';
  const files=await getJson(base+'/files');
  if(files.success!==true || !Array.isArray(files.mediaFiles))
    throw Error('Unexpected media file listing response');
  if(files.mediaFiles.length!==0)throw Error('Refusing nonempty media directory');
  const old=await getJson(base);
  if(!Array.isArray(old) || old.length!==0)throw Error('Refusing reused media session');

  const client=mqtt.connect('mqtt://hivemind-broker:1884',{
    clientId:'skyhub_media_'+crypto.randomBytes(6).toString('hex'),
    protocolVersion:5,reconnectPeriod:0,connectTimeout:5000
  });
  const events=new Map(),acks=new Set(),requests=new Map(),denied=new Set();
  const eventTopic='thing/product/'+sn+'/events';
  const replyTopic='thing/product/'+sn+'/events_reply';
  const reqTopic='thing/product/'+sn+'/requests';
  const reqReplyTopic='thing/product/'+sn+'/requests_reply';
  try{
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('MQTT subscription timeout')),8000);
      client.once('connect',()=>{
        client.subscribe([eventTopic,replyTopic,reqTopic,reqReplyTopic],{qos:0},(error,granted)=>{
          clearTimeout(timer);
          if(error||!granted||granted.length!==4||granted.some(x=>x.qos===128))
            reject(Error('Media MQTT subscription refused'));
          else resolve();
        });
      });
      client.once('error',()=>{clearTimeout(timer);reject(Error('Private broker unreachable'));});
    });
    client.on('message',(topic,buf,packet)=>{
      if(packet?.retain || !Buffer.isBuffer(buf)||buf.length>16384)return;
      let msg;
      try{msg=JSON.parse(buf.toString('utf8'));}catch{return;}
      if(topic===eventTopic){
        const entry=envelope(topic,msg,sn);
        if(entry)events.set(entry.tid,entry);
      }else if(topic===replyTopic){
        const item=events.get(msg?.tid);
        if(correlate(item,msg))acks.add(item.tid);
      }else if(topic===reqTopic && msg?.method==='storage_config_get' &&
               msg?.gateway===sn && UUID.test(msg?.tid) && UUID.test(msg?.bid))
        requests.set(msg.tid,{tid:msg.tid,bid:msg.bid,method:msg.method,gateway:sn});
      else if(topic===reqReplyTopic && requests.has(msg?.tid) &&
              denyStorage(requests.get(msg.tid),msg,sn))
        denied.add(msg.tid);
    });
    const accepted=await getJson(base+'/trigger',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({flight_id:FLIGHT,file_count:COUNT})
    });
    if(accepted?.success!==true || accepted.flight_id!==FLIGHT ||
        accepted.file_count!==COUNT)throw Error('Metadata-only trigger refused');
    const deadline=Date.now()+23000;
    while(Date.now()<deadline){
      const full=[...events.values()].filter(e=>acks.has(e.tid));
      const priority=full.filter(e=>e.method===METHODS[0]).length;
      const files=full.filter(e=>e.method===METHODS[1]);
      if(denied.size===1 && priority===1 && files.length===COUNT &&
         new Set(files.map(x=>x.name)).size===COUNT){
        const rows=await getJson(base);
        if(!Array.isArray(rows) || rows.length!==COUNT ||
           !rows.every(x=>x.flight_id===FLIGHT && x.uploaded===false))
          throw Error('Simulator did not confirm metadata-only upload');
        console.log('PASS: STS denied, 3 correlated events_reply and 2 metadata-only callbacks; zero uploads');
        return;
      }
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    throw Error('Incomplete synthetic media acknowledgement sequence');
  }finally{
    await new Promise(resolve=>client.end(true,resolve));
  }
}
if(require.main===module)run().catch(e=>{
  // Never print arbitrary HTTP or MQTT content.
  console.error('FAIL: '+e.message);
  process.exitCode=1;
});
module.exports={FLIGHT,COUNT,SN,METHODS,envelope,correlate,denyStorage,getJson};
