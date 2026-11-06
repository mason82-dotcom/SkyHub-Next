'use strict';

// P2.1 local laboratory only. There is intentionally NO startup, timer,
// live DJI subscription, server route, inbound UDP message handler or
// arbitrary host configuration. Only operator-enabled, validated MAVLink
// companion telemetry can be sent to literal IPv4 loopback.
const dgram=require('node:dgram');
const {inspectPassiveBatch}=require('./mavlink-passive-frame-audit');

const SCHEMA='skyhub-mavlink-loopback-lab-v1';
const MIN_INTERVAL_MS=1000;
function denied(reason){
  return Object.freeze({schema:SCHEMA,accepted:false,reason,
    framesSent:0,loopbackOnly:true,udpSent:false,
    commandCapable:false,hardwareVerified:false,flightReady:false});
}
function createLoopbackTelemetryLab({enabled=false,host='127.0.0.1',port}={}){
  // Ports must be explicit. Never resolve hostnames, accept LAN addresses
  // or use privileged ports; no network side effect in the constructor.
  const valid=enabled===true&&host==='127.0.0.1'&&
    Number.isInteger(port)&&port>=1024&&port<=65535;
  let closed=false,busy=false,lastSent=-Infinity,nextExpected=null;
  return Object.freeze({
    async sendBatch(projection){
      if(!valid||closed)return denied('disabled_or_invalid_destination');
      if(busy)return denied('busy');
      const now=Date.now();
      // Clone before inspection. No mutable frame reaches the sender that
      // has not itself passed the independent strict decoder + CRC check.
      const prepared=projection&&typeof projection==='object'?
        {...projection,frames:Array.isArray(projection.frames)?
          projection.frames.map(b=>Buffer.isBuffer(b)?Buffer.from(b):b):null}:null;
      const audit=inspectPassiveBatch(prepared,{now});
      if(!audit.accepted)return denied('unverified_frames');
      if(now-lastSent<MIN_INTERVAL_MS)return denied('rate_limited');
      if(nextExpected!==null&&audit.firstSequence!==nextExpected)
        return denied('replay_or_out_of_order');
      busy=true;
      let socket=null;
      try{
        socket=dgram.createSocket('udp4');
        // No socket.bind(), socket.on('message'), receive callback or
        // connection to a vehicle/GCS/remote controller.
        for(const packet of prepared.frames){
          await new Promise((resolve,reject)=>{
            socket.send(packet,port,'127.0.0.1',err=>
              err?reject(err):resolve());
          });
        }
        lastSent=Date.now();
        nextExpected=audit.nextSequence;
        return Object.freeze({schema:SCHEMA,accepted:true,reason:null,
          framesSent:prepared.frames.length,loopbackOnly:true,udpSent:true,
          commandCapable:false,hardwareVerified:false,flightReady:false});
      }catch(_err){
        return denied('loopback_send_failed');
      }finally{
        if(socket)socket.close();
        busy=false;
      }
    },
    close(){closed=true;},
    get enabled(){return valid&&!closed;}
  });
}
module.exports={createLoopbackTelemetryLab,SCHEMA,MIN_INTERVAL_MS};
