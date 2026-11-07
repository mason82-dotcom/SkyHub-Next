'use strict';
// Opt-in, bounded DJI HMS transition store. No flight commands, no raw MQTT persisted.
const {serial}=require('./dji');
const CODE=/^0x[0-9A-F]{8}$/;
const MAX_ACTIVE=20, MAX_EVENTS=3000;
function cleanAlert(a){
  if(!a||!CODE.test(a.code||'')||!Number.isInteger(a.level)||a.level<0||a.level>5)return null;
  const index=v=>Number.isInteger(v)&&v>=0&&v<=65535?v:-1;
  return {code:a.code,level:a.level,componentIndex:index(a.componentIndex),
    sensorIndex:index(a.sensorIndex)};
}
function alertKey(a){return [a.code,a.componentIndex,a.sensorIndex].join(':');}
function normalize(list){
  if(!Array.isArray(list)||list.length>MAX_ACTIVE)throw new TypeError('Invalid HMS snapshot');
  const map=new Map();
  for(const item of list){
    const a=cleanAlert(item);
    if(!a)throw new TypeError('Invalid HMS alert');
    if(map.has(alertKey(a)))throw new TypeError('Ambiguous HMS alert');
    map.set(alertKey(a),a);
  }
  return map;
}
function transitions(before,after){
  const previous=normalize(before),current=normalize(after),changes=[];
  for(const [key,a] of current){
    const old=previous.get(key);
    if(!old)changes.push({...a,action:'appeared'});
    else if(old.level!==a.level)changes.push({...a,action:'updated'});
  }
  for(const [key,a] of previous)if(!current.has(key))changes.push({...a,action:'resolved'});
  return changes.sort((a,b)=>alertKey(a).localeCompare(alertKey(b))||a.action.localeCompare(b.action));
}
function createHmsHistory(pool){
  if(!pool||typeof pool.connect!=='function'||typeof pool.query!=='function')
    throw new TypeError('PostgreSQL pool required');
  let tail=Promise.resolve(),queued=0;
  async function write(sn,alerts,at,timeVerified){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      // Serialize across API processes; also protects an initially empty device snapshot.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('skyhub_hms:' || $1))",[sn]);
      const {rows}=await client.query(
        'SELECT code,level,component_index AS "componentIndex",sensor_index AS "sensorIndex"'+
        ' FROM skyhub_hms_active WHERE device_sn=$1',[sn]);
      const prior=rows.map(r=>({...r,level:Number(r.level)}));
      const delta=transitions(prior,alerts);
      if(delta.length){
        await client.query('DELETE FROM skyhub_hms_active WHERE device_sn=$1',[sn]);
        for(const a of alerts)await client.query(
          'INSERT INTO skyhub_hms_active (device_sn,code,level,component_index,sensor_index)'+
          ' VALUES ($1,$2,$3,$4,$5)',[sn,a.code,a.level,a.componentIndex,a.sensorIndex]);
        for(const d of delta)await client.query(
          'INSERT INTO skyhub_hms_transitions (device_sn,code,level,component_index,sensor_index,action,source_at,time_verified)'+
          ' VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7::double precision/1000),$8)',
          [sn,d.code,d.level,d.componentIndex,d.sensorIndex,d.action,at,timeVerified]);
        await client.query('DELETE FROM skyhub_hms_transitions WHERE id IN ('+
          'SELECT id FROM skyhub_hms_transitions ORDER BY id DESC OFFSET $1)',[MAX_EVENTS]);
      }
      await client.query('COMMIT');
      return delta.length;
    }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}
    finally{client.release();}
  }
  return {
    observe(deviceSn,snapshot,at,timeVerified){
      if(!serial(deviceSn)||!Number.isSafeInteger(at)||at<=0||
          typeof timeVerified!=='boolean')return Promise.reject(new TypeError('Invalid HMS source'));
      const alerts=[...normalize(snapshot).values()];
      if(queued>=64)return Promise.reject(new Error('HMS write queue full'));
      queued++;
      const work=tail.then(()=>write(deviceSn,alerts,at,timeVerified));
      tail=work.catch(()=>{});
      work.finally(()=>{queued--;}).catch(()=>{});
      return work;
    },
    async list(deviceSn,limit=50,offset=0){
      if(deviceSn!==null&&!serial(deviceSn))throw new TypeError('Invalid HMS device');
      if(!Number.isInteger(limit)||limit<1||limit>100||
        !Number.isInteger(offset)||offset<0||offset>10000)
        throw new TypeError('Invalid HMS pagination');
      const {rows}=await pool.query(
        'SELECT id,device_sn AS "deviceSn",code,level,component_index AS "componentIndex",'+
        'sensor_index AS "sensorIndex",action,source_at AS "sourceAt",time_verified AS "timeVerified"'+
        ' FROM skyhub_hms_transitions WHERE ($1::varchar IS NULL OR device_sn=$1)'+
        ' ORDER BY id DESC LIMIT $2 OFFSET $3',[deviceSn,limit,offset]);
      return rows;
    }
  };
}
// Read-only HTTP handler: stored transitions plus German/English HMS text for the dashboard.
// The text is resolved at read time from the bundled DJI catalogue; nothing textual is stored.
function createHmsHistoryHandler({history,registry,describe=require('./hms-catalog').describeHms}){
  return async(req,res)=>{
    if(!history)return res.status(503).json({error:'HMS history disabled',enabled:false});
    const device=req.query.device===undefined||req.query.device===''?null:req.query.device;
    const limit=req.query.limit===undefined?50:Number(req.query.limit);
    const offset=req.query.offset===undefined?0:Number(req.query.offset);
    try{
      const rows=await history.list(device,limit,offset);
      const items=rows.map(row=>{
        const known=registry.get(row.deviceSn);
        return {...row,modelName:known?.modelName??null,
          text:describe(row,{domain:known?.model?.domain??null})};
      });
      res.json({enabled:true,items,limit,offset,hasMore:items.length===limit});
    }catch(err){
      res.status(err instanceof TypeError?400:503).json({error:err instanceof TypeError?'Invalid query':'HMS history unavailable'});
    }
  };
}
module.exports={createHmsHistory,createHmsHistoryHandler,cleanAlert,normalize,transitions,MAX_EVENTS};
