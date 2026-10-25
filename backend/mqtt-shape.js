'use strict';

// Serial-free catalog of DJI payload shapes: channel, method and top-level field names.
// Lets a hardware test compare real Pilot 2 firmware output with the parser
// without storing values, coordinates, serial numbers or raw MQTT payloads.
function createShapeCatalog(limit = 64) {
  const shapes = new Map();
  function record(message, at = Date.now()) {
    if (!message || typeof message.channel !== 'string') return;
    const method = typeof message.method === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(message.method)
      ? message.method : null;
    const keys = Array.isArray(message.dataKeys) ? message.dataKeys : [];
    const id = message.channel + '|' + (method || '') + '|' + keys.join(',');
    let shape = shapes.get(id);
    if (!shape) {
      if (shapes.size >= limit) return;
      shape = {channel: message.channel, method, dataKeys: [...keys],
        count: 0, needReply: 0, firstAt: at, lastAt: at};
      shapes.set(id, shape);
    }
    shape.count++;
    if (message.needReply === true) shape.needReply++;
    shape.lastAt = at;
  }
  function snapshot() {
    return [...shapes.values()]
      .map(shape => ({...shape, dataKeys: [...shape.dataKeys]}))
      .sort((a, b) => b.lastAt - a.lastAt);
  }
  return {record, snapshot};
}



// Separate, opt-in model-scoped field-name inventory. The model comes from
// the trusted, already accepted SkyHub registry topology, never from a
// self-declared MQTT payload. No device IDs, values or unknown keys survive.
const fieldsCatalog=require('./data/dji-cloud-api-118-fields.json');
const GENERIC_AIRCRAFT_CANDIDATES=Object.freeze([
  'distance_limit_status','rth_altitude','rc_lost_action',
  'payloads','wpmz_version'
]);
const MODEL_SCOPE=Object.freeze({
  '2:144:0':{role:'gateway',profile:'rcPro'},
  '0:77:2':{role:'subdevice',profile:'mavic3'},
  '2:174:0':{role:'gateway',profile:'rcPlus2'},
  '0:99:1':{role:'subdevice',profile:'matrice4T'}
});
// DJI replays the last OSD of an aircraft after mode_code=14 (not connected).
const AIRCRAFT_SCOPES=Object.freeze(new Set(['0:77:2','0:99:1']));
const allowedRoots=Object.create(null);
for(const [key,scope] of Object.entries(MODEL_SCOPE)){
  const set=new Set(fieldsCatalog.profiles[scope.profile].fields
    .filter(field=>!field.path.includes('.')).map(field=>field.path));
  if(key==='0:77:2'){
    for(const candidate of GENERIC_AIRCRAFT_CANDIDATES)set.add(candidate);
  }
  allowedRoots[key]=set;
}
function createModelShapeCatalog() {
  const entries=new Map();
  return {
    record(message,device,at=Date.now()){
      if(!message||!device||!['osd','state'].includes(message.channel)||
        !Number.isFinite(at))return;
      const model=device.model;
      if(!model||!['0','2'].includes(String(model.domain))||
        !Number.isInteger(model.type)||!Number.isInteger(model.subType))return;
      const key=[String(model.domain),model.type,model.subType].join(':');
      const scope=MODEL_SCOPE[key];
      if(!scope||device.role!==scope.role)return;
      // DJI replays last OSD after mode_code=14, which is not new telemetry.
      if(AIRCRAFT_SCOPES.has(key)&&device.aircraftConnected===false)return;
      const name=key+':'+message.channel;
      let entry=entries.get(name);
      if(!entry){
        entry={model:key,channel:message.channel,count:0,
          firstAt:at,lastAt:at,dataKeys:new Set()};
        entries.set(name,entry);
      }
      entry.count++;
      entry.lastAt=at;
      if(Array.isArray(message.dataKeys)){
        for(const raw of message.dataKeys){
          if(typeof raw==='string' && allowedRoots[key].has(raw))entry.dataKeys.add(raw);
        }
      }
    },
    snapshot(){
      return [...entries.values()].map(e=>({
        model:e.model,channel:e.channel,count:e.count,
        firstAt:e.firstAt,lastAt:e.lastAt,
        dataKeys:[...e.dataKeys].sort()
      }));
    }
  };
}

module.exports = {createShapeCatalog,createModelShapeCatalog,GENERIC_AIRCRAFT_CANDIDATES};
