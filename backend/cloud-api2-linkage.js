'use strict';
// Read-only, privacy-preserving correlation candidates. Matching product models,
// timestamps, filenames or STS sessions NEVER establish mission execution or media origin.
const {waylineId}=require('./wpml-mission-store');
const SCHEMA='skyhub.cloudapi2.linkage.v1';
const LIMIT=500;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const MODEL=/^0-\d{1,5}-\d{1,5}$/;
function count(n){return Number.isSafeInteger(n)&&n>=0&&n<=100000?n:null;}
function result(status,total=null){return {status,count:total};}
function aircraftModel(device){
  if(!device||device.role!=='subdevice'||device.topologyOnline!==true||
    device.topologyTimeVerified!==true||device.topologyRestored===true)return null;
  const m=device.model;
  if(!m||String(m.domain)!=='0'||!/^\d{1,5}$/.test(String(m.type))||
    !/^\d{1,5}$/.test(String(m.subType??0)))return null;
  return '0-'+Number(m.type)+'-'+Number(m.subType??0);
}
function missionModel(mission){
  if(!mission||typeof mission.sha256!=='string'||!SHA.test(mission.sha256)||
    typeof mission.id!=='string'||!UUID.test(mission.id)||
    mission.id.toLowerCase()!==waylineId(mission.sha256).toLowerCase()||
    typeof mission.droneModelKey!=='string'||!MODEL.test(mission.droneModelKey))return null;
  return mission.droneModelKey;
}
function compatibleModels(devices,missions){
  if(!Array.isArray(devices)||!Array.isArray(missions)||
    devices.length>LIMIT||missions.length>LIMIT)return null;
  const models=new Map();
  for(const device of devices){
    const model=aircraftModel(device);
    if(model)models.set(model,(models.get(model)||0)+1);
  }
  let validMissions=0,pairs=0;
  for(const mission of missions){
    const model=missionModel(mission);
    if(!model)continue;
    validMissions++;
    pairs+=models.get(model)||0;
  }
  if(pairs>100000)return null;
  return {topologyVerifiedAircraft:[...models.values()].reduce((a,b)=>a+b,0),
    metadataConsistentMissions:validMissions,compatiblePairs:pairs};
}
async function safeRead(fn){
  let timer;
  try{return await Promise.race([
    Promise.resolve().then(fn),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('unavailable')),6000);})
  ]);}catch(_err){return null;}finally{clearTimeout(timer);}
}
async function mediaCount(db,workspace){
  if(!db||typeof db.query!=='function'||typeof workspace!=='string'||!UUID.test(workspace))
    return result('unavailable');
  const q=await safeRead(()=>db.query(
    'SELECT count(*)::integer AS n FROM dji_pilot_media_verified WHERE workspace_id=$1',
    [workspace]
  ));
  const n=count(q?.rows?.length===1?Number(q.rows[0].n):null);
  return result(n===null?'unknown':n?'observed':'empty',n);
}
async function collectLinkage({registry=null,wpmlStore=null,db=null,workspace=null}={}){
  let deviceStatus=result('unavailable'),missionStatus=result('unavailable'),modelCandidates=null;
  const devices=registry&&typeof registry.snapshot==='function'
    ?await safeRead(()=>registry.snapshot()):null;
  if(registry){
    if(!Array.isArray(devices)||devices.length>LIMIT)deviceStatus=result('unknown');
    else deviceStatus=result(devices.length?'observed':'empty',devices.length);
  }
  const missions=wpmlStore&&typeof wpmlStore.all==='function'
    ?await safeRead(()=>wpmlStore.all()):null;
  if(wpmlStore){
    if(!Array.isArray(missions)||missions.length>LIMIT)missionStatus=result('unknown');
    else missionStatus=result(missions.length?'observed':'empty',missions.length);
  }
  if(Array.isArray(devices)&&Array.isArray(missions))modelCandidates=compatibleModels(devices,missions);
  const media=await mediaCount(db,workspace);
  return {schema:SCHEMA,readOnly:true,hardwareVerified:false,flightReady:false,
    deviceCorrelation:'not-established',synthetic:false,
    inventories:{device:deviceStatus,mission:missionStatus,media},
    provenance:{device:'cloud-api-1.x-topology-observation',
      mission:'wpml-stored-object-metadata',
      media:'pilot-media-head-at-ingestion-not-rechecked'},
    modelCompatibility:{
      status:modelCandidates===null?'unknown':
        modelCandidates.compatiblePairs>0?'candidate-only':'no-compatible-candidates',
      candidatePairs:modelCandidates?.compatiblePairs??null,
      topologyVerifiedAircraft:modelCandidates?.topologyVerifiedAircraft??null,
      metadataConsistentMissions:modelCandidates?.metadataConsistentMissions??null,
      validatedExecution:false
    },
    links:{
      deviceMission:{status:'not-established',verified:0},
      missionMedia:{status:'not-established',verified:0},
      deviceMedia:{status:'not-established',verified:0}
    },
    warning:'Model compatibility, WPML metadata, STS grants, filenames and time proximity do not prove a flown mission or media-to-aircraft association.'};
}
function createCloudApi2LinkageRouter({express,...sources}){
  const router=express.Router();
  router.get('/linkage',async(_req,res)=>{
    res.set('Cache-Control','no-store');
    try{res.json(await collectLinkage(sources));}
    catch(_err){res.status(503).json({error:'Linkage evidence unavailable'});}
  });
  return router;
}
module.exports={SCHEMA,aircraftModel,missionModel,compatibleModels,collectLinkage,createCloudApi2LinkageRouter};
