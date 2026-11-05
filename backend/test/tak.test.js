'use strict';
// TAK output: CoT content and the rules (fresh, verified, never 0/0, heartbeat, no buffering), TLS + multicast transport.
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {cotEvent,takConfig,createTakOutput}=require('../tak');

const NOW=Date.parse('2026-11-05T10:00:00Z');
const dev=(o={})=>({sn:'1581F0000000000M4T00',modelName:'Matrice 4T',deviceCategory:'aircraft',gatewaySn:'RC',positionFresh:true,
  positionTimeVerified:true,lastPositionAt:NOW-1000,telemetry:{latitude:49.15,longitude:8.6,heightEllipsoid:210.4,altitude:60,heading:-90,horizontalSpeed:7.5,battery:76},...o});

test('CoT event: uid, type, times, point with ellipsoid height, track, contact, remarks; XML escaped',()=>{
  const x=cotEvent(dev(),{now:NOW});
  assert.match(x,/uid="SKYHUB-1581F0000000000M4T00" type="a-f-A-M-H-Q" how="m-g" time="2026-11-05T09:59:59.000Z" start="2026-11-05T09:59:59.000Z" stale="2026-11-05T10:00:14.000Z"/);
  assert.match(x,/<point lat="49.1500000" lon="8.6000000" hae="210.4" ce="9999999.0" le="9999999.0"\/>/);
  assert.match(x,/<track course="270.0" speed="7.5"\/>/);assert.match(x,/callsign="Matrice 4T 4T00"/);assert.match(x,/Akku 76 %/);
  assert.match(cotEvent(dev({modelName:'<x&y>'}),{now:NOW}),/&lt;x&amp;y&gt;/);
  assert.match(cotEvent(dev({telemetry:{latitude:49.15,longitude:8.6}}),{now:NOW}),/hae="9999999.0"/);
});
test('never sent: stale, unverified time, 0/0, future time, docks; RC only as ground unit',()=>{
  assert.equal(cotEvent(dev({positionFresh:false}),{now:NOW}),null);
  assert.equal(cotEvent(dev({positionTimeVerified:false}),{now:NOW}),null);
  assert.equal(cotEvent(dev({telemetry:{latitude:0,longitude:0}}),{now:NOW}),null);
  assert.equal(cotEvent(dev({lastPositionAt:NOW-31000}),{now:NOW}),null);
  assert.equal(cotEvent(dev({lastPositionAt:NOW+10000}),{now:NOW}),null);
  assert.equal(cotEvent(dev({deviceCategory:'dock'}),{now:NOW}),null);
  assert.match(cotEvent(dev({deviceCategory:'controller'}),{now:NOW}),/type="a-f-G-U-C"/);
});
test('config: off by default; TLS needs host:port and certificate files; multicast alone allowed',()=>{
  assert.equal(takConfig({}).enabled,false);
  assert.match(takConfig({SKYHUB_TAK_ENABLED:'true'}).issue,/weder/);
  assert.match(takConfig({SKYHUB_TAK_ENABLED:'true',SKYHUB_TAK_SERVER:'tak.lan:8089'}).issue,/SKYHUB_TAK_CERT/);
  assert.equal(takConfig({SKYHUB_TAK_ENABLED:'true',SKYHUB_TAK_MULTICAST_ENABLED:'true'}).enabled,true);
  const c=takConfig({SKYHUB_TAK_ENABLED:'true',SKYHUB_TAK_SERVER:'tak.lan:8089',SKYHUB_TAK_CERT:'/c',SKYHUB_TAK_KEY:'/k',SKYHUB_TAK_CA:'/a'});
  assert.deepEqual([c.server.host,c.server.port],['tak.lan',8089]);
});
test('transport: TLS with client certificate, heartbeat every 5 s when unchanged, dropped (not buffered) while disconnected, multicast',()=>{
  let t=NOW,devices=[dev()];
  const sock=new EventEmitter();sock.writable=true;sock.written=[];sock.write=b=>sock.written.push(b.toString());sock.destroy=()=>{};
  let opts=null;
  const connect=(o,cb)=>{opts=o;setImmediate(cb);return sock;};
  const udp=new EventEmitter();udp.sent=[];udp.bind=(p,cb)=>cb&&cb();udp.setMulticastTTL=()=>{};udp.close=()=>{};
  udp.send=(b,port,host)=>udp.sent.push([port,host]);
  const out=createTakOutput({config:{server:{host:'tak.lan',port:8089,cert:'/c',key:'/k',ca:'/a'},multicast:true,includeRc:false,aircraftType:'a-f-A-M-H-Q',team:'Cyan'},
    registry:{snapshot:()=>devices.map(d=>({...d,lastPositionAt:t-500}))},now:()=>t,connect,createSocket:()=>udp,
    readFile:f=>Buffer.from(f),setTimer:()=>null,clearTimer:()=>{},log:{log(){}}});
  assert.equal(opts.rejectUnauthorized,true);assert.equal(String(opts.cert),'/c');
  out.tick();assert.equal(out.status().dropped,1,'not yet connected: dropped');
  return new Promise(r=>setImmediate(r)).then(()=>{
    sock.emit('connect');
    t+=1000;out.tick();assert.equal(sock.written.length,0,'unchanged within 5 s');
    t+=5000;out.tick();assert.equal(sock.written.length,1,'heartbeat');
    devices=[dev({telemetry:{...dev().telemetry,latitude:49.151}})];t+=1000;out.tick();assert.equal(sock.written.length,2,'moved');
    assert.deepEqual(udp.sent[0],[6969,'239.2.3.1']);
    sock.writable=false;t+=6000;out.tick();assert.equal(out.status().dropped,2);
    out.close();
  });
});
