'use strict';

// DJI Pilot 2 situation awareness (TSA): pure message and response builders.
// Sources: feature-set/pilot-feature-set/pilot-situation-awareness, the WebSocket message
// push pages (device_osd, device_online, device_offline, device_update_topo) and
// GET /manage/api/v1/workspaces/{workspace_id}/devices/topologies.
// No I/O. Only fields the read-only registry already holds are used; no serials beyond the
// device's own, no credentials and no third-party data.
const WS_VERSION='1.0';
const MAX_DEVICES=200;
const BIZ_CODES=Object.freeze({
  online:'device_online',offline:'device_offline',topology:'device_update_topo',osd:'device_osd'
});

function finite(value){return Number.isFinite(value)?value:null;}
function intText(value){
  return (Number.isInteger(value)&&value>=0)||(typeof value==='string'&&/^\d{1,4}$/.test(value))?String(value):null;
}
function modelKey(model){
  if(!model||typeof model!=='object')return null;
  const domain=intText(model.domain),type=intText(model.type),sub=intText(model.subType);
  return domain&&type&&sub?{key:domain+'-'+type+'-'+sub,domain,type,sub_type:sub}:null;
}

// A device is shown online only when its topology says so AND its OSD is fresh, so a restored
// topology from a restart never makes a silent device look present.
function isOnline(device){
  return Boolean(device)&&device.topologyOnline===true&&device.fresh===true&&device.aircraftConnected!==false;
}

function deviceEntry(device){
  const model=modelKey(device.model);
  if(!model||typeof device.sn!=='string')return null;
  return {
    sn:device.sn,
    device_model:{key:model.key,domain:model.domain,type:model.type,sub_type:model.sub_type},
    online_status:isOnline(device),
    device_callsign:typeof device.modelName==='string'?device.modelName:'',
    user_id:'',user_callsign:''
  };
}

// hosts = aircraft/sub-devices, parents = their gateway (remote controller).
function buildTopologyList(devices){
  const list=Array.isArray(devices)?devices.slice(0,MAX_DEVICES):[];
  const bySn=new Map(list.map(device=>[device.sn,device]));
  const used=new Set(),groups=[];
  for(const gateway of list){
    if(gateway.role!=='gateway')continue;
    const parent=deviceEntry(gateway);
    if(!parent)continue;
    const childSns=new Set(Array.isArray(gateway.children)?gateway.children:[]);
    for(const device of list)if(device.gatewaySn===gateway.sn)childSns.add(device.sn);
    const hosts=[];
    for(const sn of childSns){
      const child=bySn.get(sn);
      const entry=child&&child!==gateway?deviceEntry(child):null;
      if(entry){hosts.push(entry);used.add(sn);}
    }
    used.add(gateway.sn);
    groups.push({hosts,parents:[parent]});
  }
  for(const device of list){
    if(used.has(device.sn)||device.role==='gateway')continue;
    const entry=deviceEntry(device);
    if(entry)groups.push({hosts:[entry],parents:[]});
  }
  return {code:0,message:'success',data:{list:groups}};
}

// device_osd: position and motion for the map. Requires a fresh, valid position; DJI's 0/0
// placeholder is never sent. Field names follow the DJI payload (including its own naming).
function osdMessage(device,timestamp){
  if(!device||!device.positionFresh||typeof device.sn!=='string')return null;
  const t=device.telemetry||{};
  const latitude=finite(t.latitude),longitude=finite(t.longitude);
  if(latitude===null||longitude===null||Math.abs(latitude)>90||Math.abs(longitude)>180||
    (latitude===0&&longitude===0))return null;
  const host={latitude,longitude};
  const optional=[['height',t.heightEllipsoid],['attitude_head',t.heading],['elevation',t.altitude],
    ['horizontal_speed',t.horizontalSpeed],['vertical_speed',t.verticalSpeed]];
  for(const [name,value] of optional)if(finite(value)!==null)host[name]=value;
  return {biz_code:BIZ_CODES.osd,version:WS_VERSION,timestamp,data:{sn:device.sn,host}};
}

function topologyMessage(kind,timestamp){
  const biz=BIZ_CODES[kind];
  if(!biz||biz===BIZ_CODES.osd||!Number.isSafeInteger(timestamp))throw new TypeError('Invalid TSA message');
  return {biz_code:biz,version:WS_VERSION,timestamp,data:{}};
}

module.exports={buildTopologyList,osdMessage,topologyMessage,isOnline,deviceEntry,modelKey,
  WS_VERSION,BIZ_CODES,MAX_DEVICES};
