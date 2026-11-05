#!/usr/bin/env node
'use strict';
// Simulierte DJI RC Plus 2 + Matrice 4T am echten Broker – zum Testen der Live-Steuerung OHNE Hardware und zum Mitlesen mit MQTTX.
//   node scripts/drc-rc-simulator.js --url mqtt://192.168.178.63:1884 --username <pilot2-artig> --password-file <datei>
//        [--gateway SIMRCP2] [--aircraft SIMM4T] [--deny]
// Nur mit Test-Seriennummern benutzen (Standard SIMRCP2/SIMM4T). SKYHUB_DRC_GATEWAY_SN muss für den Test auf dieselbe Nummer zeigen.
const fs=require('node:fs');
const path=require('node:path');
const mqtt=require(path.join(__dirname,'../backend/node_modules/mqtt'));
const {createRcSimulator}=require('../backend/drc-rc-simulator');

const args=process.argv.slice(2);
const opt=(name,def)=>{const i=args.indexOf('--'+name);return i>=0?args[i+1]:def;};
const url=opt('url'),username=opt('username'),passwordFile=opt('password-file');
const gateway=opt('gateway','SIMRCP2'),aircraft=opt('aircraft','SIMM4T');
if(!url||!username||!passwordFile){
  console.error('Verwendung: node scripts/drc-rc-simulator.js --url mqtt://host:port --username U --password-file DATEI [--gateway SN] [--aircraft SN] [--deny]');
  process.exit(2);
}
if(!/^SIM/.test(gateway)&&!args.includes('--real-serial-ok')){
  console.error('Abbruch: Gateway-Seriennummer beginnt nicht mit SIM. Ein Simulator darf nie unter der Nummer einer echten RC laufen.');
  process.exit(2);
}
const client=mqtt.connect(url,{username,password:fs.readFileSync(passwordFile,'utf8').trim(),clientId:'sim-'+gateway,reconnectPeriod:2000});
const sim=createRcSimulator({gateway,aircraftSn:aircraft,approve:!args.includes('--deny'),
  publish:(topic,msg)=>client.publish(topic,JSON.stringify(msg),{qos:/services_reply|events$/.test(topic)?1:0})});
client.on('connect',()=>{
  client.subscribe([`thing/product/${gateway}/services`,`thing/product/${gateway}/drc/down`,`thing/product/${gateway}/events_reply`]);
  sim.announce();sim.start(5);
  console.log('Simulator verbunden: RC',gateway,'mit Matrice 4T',aircraft,args.includes('--deny')?'(lehnt Autorisierung ab)':'(stimmt zu)');
});
client.on('message',(topic,payload)=>{
  if(topic.endsWith('/events_reply')){console.log('events_reply erhalten:',String(payload).slice(0,160));return;}
  try{sim.receive(topic,payload);}catch(err){console.error('Nachricht unlesbar:',err.message);}
});
client.on('error',err=>console.error('Broker:',err.message));
setInterval(()=>{const a=sim.state();console.log(`DRC=${a.drcState} Höhe=${a.elevation.toFixed(1)} m Pos=${a.latitude.toFixed(6)},${a.longitude.toFixed(6)} mode=${a.mode}`);},5000).unref();
process.on('SIGINT',()=>{sim.stop();client.end(true,()=>process.exit(0));});
