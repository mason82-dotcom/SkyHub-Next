'use strict';
// Livestream on demand (live-control.js): config gate, live_capacity parsing, services + services_reply matching.
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {liveControlConfig,createLiveControl,streamsFromCapacity,statusList}=require('../live-control');
const {pilotLiveConfig}=require('../live-stream');
const {command}=require('../drc-payload');

const live={enabled:true,rtmpOrigin:'rtmp://192.168.178.50:1935',publishPass:'p'.repeat(32)};
const CAP={available_video_number:2,coexist_video_number_max:1,device_list:[{sn:'1581F0000000000M4T00',available_video_number:2,coexist_video_number_max:1,
  camera_list:[{camera_index:'89-0-0',available_video_number:1,coexist_video_number_max:1,
    video_list:[{video_index:'normal-0',video_type:'normal',switchable_video_types:['wide','zoom','ir']}]}]}]};

test('config: off by default, needs the relay and an MQTT account',()=>{
  assert.equal(liveControlConfig({}).enabled,false);
  assert.match(liveControlConfig({SKYHUB_LIVE_CONTROL_ENABLED:'true'},{enabled:false}).issue,/SKYHUB_LIVE_ENABLED/);
  assert.match(liveControlConfig({SKYHUB_LIVE_CONTROL_ENABLED:'true'},live).issue,/MQTT/);
  const c=liveControlConfig({SKYHUB_LIVE_CONTROL_ENABLED:'true',SKYHUB_DRC_MQTT_URL:'mqtt://mosquitto:1884',SKYHUB_DRC_MQTT_USERNAME:'u',SKYHUB_DRC_MQTT_PASSWORD:'p'},live);
  assert.equal(c.enabled,true);assert.equal(c.mqtt.username,'u');
});

test('Pilot liveshare type: on demand only with live control',()=>{
  assert.equal(pilotLiveConfig(live).publishType,'video-by-manual');
  assert.equal(pilotLiveConfig(live,{onDemand:true}).publishType,'video-demand-aux-manual');
});

test('live_capacity → streams; live_status → state; junk dropped',()=>{
  const s=streamsFromCapacity(CAP);
  assert.deepEqual(s.map(x=>x.videoId),['1581F0000000000M4T00/89-0-0/normal-0']);
  assert.deepEqual(s[0].switchable,['wide','zoom','ir']);
  assert.deepEqual(streamsFromCapacity({device_list:[{sn:'x/../y',camera_list:[{camera_index:'1',video_list:[{video_index:'a'}]}]}]}),[]);
  assert.deepEqual(statusList([{video_id:'a',video_type:'wide',video_quality:2,status:1,error_status:0},null]),
    [{videoId:'a',videoType:'wide',quality:2,live:true,error:null}]);
});

function setup(kind='2-174-0',state={live_capacity:CAP}){
  const client=new EventEmitter();client.sent=[];
  client.subscribe=(t,o,cb)=>cb&&cb(null);client.end=()=>{};
  client.publish=(topic,body)=>client.sent.push({topic,msg:JSON.parse(body)});
  const [domain,type,subType]=kind.split('-').map(Number);
  const registry={snapshot:()=>[
    {sn:'RC1',model:{domain:String(domain),type,subType},modelName:'RC',online:true,deviceProperties:{state}},
    {sn:'1581F0000000000M4T00',gatewaySn:'RC1',model:{domain:'0',type:99,subType:1},modelName:'Matrice 4T',online:true}]};
  const audits=[];
  const lc=createLiveControl({config:{mqtt:{url:'mqtt://x',username:'u',password:'p'}},liveSettings:live,registry,
    mqttConnect:()=>client,express:require('express'),audit:e=>audits.push(e),timeoutMs:200,log:{error(){},log(){}}});
  client.emit('connect');
  const reply=(i,result=0,extra={})=>{const m=client.sent[i].msg;
    client.emit('message','thing/product/RC1/services_reply',Buffer.from(JSON.stringify({tid:m.tid,bid:m.bid,method:m.method,data:{result},...extra})));};
  return {lc,client,reply,audits};
}

test('start: services live_start_push with RTMP to the own relay, reply matched by tid + method + gateway',async()=>{
  const {lc,client,reply,audits}=setup();
  const id='1581F0000000000M4T00/89-0-0/normal-0';
  const p=lc.start('RC1',{videoId:id,videoQuality:3},'op-12345678');
  const m=client.sent[0];
  assert.equal(m.topic,'thing/product/RC1/services');
  assert.equal(m.msg.method,'live_start_push');
  assert.deepEqual(m.msg.data,{url_type:1,url:'rtmp://192.168.178.50:1935/pilot?user=skyhub-pilot&pass='+'p'.repeat(32),video_id:id,video_quality:3});
  assert.doesNotMatch(JSON.stringify(audits),/p{32}/,'password never in the audit');
  // wrong method on the same tid is ignored, then the real reply resolves
  client.emit('message','thing/product/RC1/services_reply',Buffer.from(JSON.stringify({tid:m.msg.tid,method:'live_stop_push',data:{result:0}})));
  reply(0);
  assert.deepEqual(await p,{result:0});
});

test('refusals: unknown camera, bad quality, non-zero result, timeout',async()=>{
  const {lc,reply}=setup();
  await assert.rejects(lc.start('RC1',{videoId:'1581F0000000000M4T00/88-0-0/normal-0'},'op-12345678'),/live_capacity/);
  await assert.rejects(lc.start('RC1',{videoId:'1581F0000000000M4T00/89-0-0/normal-0',videoQuality:9},'op-12345678'),/Qualität/);
  await assert.rejects(lc.start('NOPE',{videoId:'1581F0000000000M4T00/89-0-0/normal-0'},'op-12345678'),/unbekannt/);
  const p=lc.stop('RC1',{videoId:'1581F0000000000M4T00/89-0-0/normal-0'},'op-12345678');reply(0,513003);
  await assert.rejects(p,/Code 513003/);
  await assert.rejects(lc.setQuality('RC1',{videoId:'1581F0000000000M4T00/89-0-0/normal-0',videoQuality:1},'op-12345678'),/Keine Antwort/);
});

test('one relay channel: a second stream is refused while one runs',async()=>{
  const {lc}=setup('2-174-0',{live_capacity:CAP,live_status:[{video_id:'1581F0000000000M4T00/89-0-0/zoom-0',status:1}]});
  await assert.rejects(lc.start('RC1',{videoId:'1581F0000000000M4T00/89-0-0/normal-0'},'op-12345678'),/schon ein Stream/);
});

test('lens: RC Pro over services, RC Plus 2 refused (DRC), DRC builder validates',async()=>{
  const {lc,client,reply}=setup('2-144-0');
  const p=lc.lens('RC1',{videoId:'1581F0000000000M4T00/89-0-0/normal-0',videoType:'zoom'},'op-12345678');
  assert.deepEqual(client.sent[0].msg.data,{video_id:'1581F0000000000M4T00/89-0-0/normal-0',video_type:'zoom'});
  reply(0);await p;
  const plus=setup('2-174-0');
  await assert.rejects(plus.lc.lens('RC1',{videoId:'1581F0000000000M4T00/89-0-0/normal-0',videoType:'zoom'},'op-12345678'),/Live-Steuerung/);
  const ctx={payloadIndex:'89-0-0',cameraTypes:['wide','zoom','ir']};
  assert.deepEqual(command('live_lens',{videoType:'thermal'},ctx).data,{payload_index:'89-0-0',video_type:'thermal'});
  assert.throws(()=>command('live_lens',{videoType:'thermal'},{payloadIndex:'88-0-0',cameraTypes:['wide','zoom']}),/Matrice 4T/);
});
