'use strict';
const {WebSocketServer,WebSocket}=require('ws');
const {fail}=require('./dji-http');
const {buildTopologyList,osdMessage,topologyMessage,isOnline,MAX_DEVICES}=require('./tsa-contract');

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TOKEN=256;
const MAX_BUFFERED=65536;

function pathname(req){
  try{return new URL(req.url||'/','http://localhost').pathname;}catch(_err){return null;}
}
// DJI's WS module appends the token as ?x-auth-token=... to the configured host.
function tokenFrom(req){
  let token=null;
  try{
    const url=new URL(req.url||'/','http://localhost');
    for(const [key,value] of url.searchParams)if(key.toLowerCase()==='x-auth-token'){token=value;break;}
  }catch(_err){return null;}
  if(token===null&&typeof req.headers?.['x-auth-token']==='string')token=req.headers['x-auth-token'];
  return typeof token==='string'&&token.length>0&&token.length<=MAX_TOKEN?token:null;
}
// The backend listens on loopback behind a TLS proxy (Caddy). Trust X-Forwarded-Proto only
// from a loopback or private peer, exactly like Express's `req.secure` for the HTTP routes.
function normalizeIp(address){
  return typeof address==='string'?address.toLowerCase().replace(/^::ffff:/,''):null;
}
// Trust exact immediate proxy addresses, never entire private networks.
function trustedPeer(address,allowed=['127.0.0.1','::1']){
  const peer=normalizeIp(address);
  return Boolean(peer)&&Array.isArray(allowed)&&allowed.some(ip=>normalizeIp(ip)===peer);
}
function secure(req,allowed){
  return trustedPeer(req.socket?.remoteAddress,allowed) &&
    req.headers?.['x-forwarded-proto']==='https';
}
function reject(socket,status,text){
  if(socket.destroyed)return;
  socket.on('error',()=>{});
  socket.end('HTTP/1.1 '+status+' '+text+'\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
}

// WebSocket push for DJI Pilot 2 situation awareness. Read-only: it sends fleet positions and
// presence to authenticated RCs of the same workspace and ignores everything the client sends.
function createTsaHub({registry,authorize,workspaceId,path='/ws/tsa',intervalMs=1000,pingMs=30000,
  maxClients=20,now=Date.now,trustedProxyIps=['127.0.0.1','::1']}={}){
  if(!registry||typeof registry.snapshot!=='function')throw new TypeError('Registry required');
  if(typeof authorize!=='function')throw new TypeError('Authorization function required');
  if(typeof workspaceId!=='string'||!UUID.test(workspaceId))throw new TypeError('Workspace UUID required');
  const wss=new WebSocketServer({noServer:true,maxPayload:1024,perMessageDeflate:false});
  const clients=new Set();
  const online=new Map(),lastOsd=new Map();
  const stats={accepted:0,rejected:0,sent:0,skippedBackpressure:0};
  let topologyPending=false,timer=null,pinger=null;

  function seed(){
    for(const device of registry.snapshot().slice(0,MAX_DEVICES))online.set(device.sn,isOnline(device));
  }
  seed();

  function broadcast(message){
    if(!message)return;
    const text=JSON.stringify(message);
    for(const ws of clients){
      if(ws.readyState!==WebSocket.OPEN)continue;
      if(ws.bufferedAmount>MAX_BUFFERED){stats.skippedBackpressure++;continue;}
      ws.send(text,error=>{if(error)ws.terminate();});
      stats.sent++;
    }
  }

  function tick(){
    const timestamp=now();
    let appeared=false,vanished=false;
    const devices=registry.snapshot().slice(0,MAX_DEVICES);
    const present=new Set();
    for(const device of devices){
      present.add(device.sn);
      const state=isOnline(device),previous=online.get(device.sn);
      if(previous!==undefined&&previous!==state)(state?appeared=true:vanished=true);
      if(previous===undefined&&state)appeared=true;
      online.set(device.sn,state);
      // Only push a position when a newer one has arrived since the last push.
      if(device.positionFresh&&Number.isFinite(device.lastPositionAt)&&
          device.lastPositionAt!==lastOsd.get(device.sn)){
        const message=osdMessage(device,timestamp);
        if(message){lastOsd.set(device.sn,device.lastPositionAt);broadcast(message);}
      }
    }
    for(const sn of [...online.keys()]){
      if(!present.has(sn)){if(online.get(sn))vanished=true;online.delete(sn);lastOsd.delete(sn);}
    }
    // DJI answers each of these by re-reading the topology list, so send at most one of each.
    if(appeared)broadcast(topologyMessage('online',timestamp));
    if(vanished)broadcast(topologyMessage('offline',timestamp));
    if(topologyPending){topologyPending=false;broadcast(topologyMessage('topology',timestamp));}
  }

  function heartbeat(){
    for(const ws of clients){
      if(ws.isAlive===false){ws.terminate();continue;}
      ws.isAlive=false;
      try{ws.ping();}catch(_err){ws.terminate();}
    }
  }

  function start(){
    if(!timer){timer=setInterval(tick,intervalMs);timer.unref?.();}
    if(!pinger){pinger=setInterval(heartbeat,pingMs);pinger.unref?.();}
  }
  start();

  function matches(req){return pathname(req)===path;}

  async function handleUpgrade(req,socket,head){
    socket.on('error',()=>{});
    if(!secure(req,trustedProxyIps)){stats.rejected++;return reject(socket,'403','Forbidden');}
    const token=tokenFrom(req);
    if(!token){stats.rejected++;return reject(socket,'401','Unauthorized');}
    if(clients.size>=maxClients){stats.rejected++;return reject(socket,'503','Service Unavailable');}
    let principal=null;
    try{principal=await authorize(token);}catch(_err){stats.rejected++;return reject(socket,'503','Service Unavailable');}
    if(!principal||principal.workspaceId!==workspaceId){stats.rejected++;return reject(socket,'401','Unauthorized');}
    if(socket.destroyed||clients.size>=maxClients){stats.rejected++;return reject(socket,'503','Service Unavailable');}
    wss.handleUpgrade(req,socket,head,ws=>{
      ws.isAlive=true;
      clients.add(ws);
      stats.accepted++;
      ws.on('pong',()=>{ws.isAlive=true;});
      // Inbound messages are never interpreted: this channel only pushes.
      ws.on('message',()=>{});
      ws.on('error',()=>{});
      ws.on('close',()=>{clients.delete(ws);});
      // A tick can consume a position before this client connects.
      // Replay only processed, still-fresh positions to the new client.
      for(const device of registry.snapshot().slice(0,MAX_DEVICES)){
        if(!device.positionFresh||!Number.isFinite(device.lastPositionAt)||
            lastOsd.get(device.sn)!==device.lastPositionAt)continue;
        const message=osdMessage(device,now());
        if(!message)continue;
        if(ws.bufferedAmount>MAX_BUFFERED){stats.skippedBackpressure++;break;}
        ws.send(JSON.stringify(message),error=>{if(error)ws.terminate();});
        stats.sent++;
      }
    });
  }

  function close(){
    clearInterval(timer);clearInterval(pinger);timer=pinger=null;
    for(const ws of clients)ws.terminate();
    clients.clear();
    wss.close();
  }

  return {
    matches,handleUpgrade,tick,close,
    topologyChanged(){topologyPending=true;},
    stats(){return {clients:clients.size,...stats};}
  };
}

// GET /manage/api/v1/workspaces/{workspace_id}/devices/topologies (Pilot 2 calls it on connect
// and after every device_online/offline/update_topo push).
function createTopologyListHandler({registry,workspaceId,authorize,trustedProxyIps=['127.0.0.1','::1']}){
  if(typeof authorize!=='function')throw new TypeError('Authorization function required');
  return async function topologies(req,res){
    if(!secure(req,trustedProxyIps))return fail(res,403,'HTTPS required');
    let principal=null;
    try{principal=await authorize(req.headers?.['x-auth-token']);}
    catch(_err){return fail(res,503,'Authorization unavailable');}
    if(!principal)return fail(res,401,'Unauthorized');
    if(typeof workspaceId!=='string'||!UUID.test(workspaceId)||req.params?.workspaceId!==workspaceId||
        principal.workspaceId!==workspaceId)return fail(res,404,'Workspace not found');
    try{return res.json(buildTopologyList(registry.snapshot()));}
    catch(_err){return fail(res,503,'Topology unavailable');}
  };
}

module.exports={createTsaHub,createTopologyListHandler,tokenFrom,secure,trustedPeer};
