'use strict';
// Bounded, operator-triggered, read-only module evidence: counts only.
// No device correlation, raw mission names, object keys, positions or thermal values.
const SCHEMA='skyhub.cloudapi2.evidence.v1';
const TIMEOUT_MS=6000;
function boundedCount(value){
  return Number.isSafeInteger(value)&&value>=0&&value<=100000?value:null;
}
function state(source,kind,status='unknown',count=null){
  return {source,evidenceKind:kind,status,count,flightReady:false,hardwareVerified:false};
}
async function safeRead(fn){
  let timeout;
  try{
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Read timeout')),TIMEOUT_MS);})
    ]);
  }catch(_err){return null;}
  finally{clearTimeout(timeout);}
}
async function missions(store){
  const source='skyhub-wpml-store';
  const kind='stored-revisions-only';
  if(!store||typeof store.status!=='function'||typeof store.list!=='function')
    return state(source,kind,'unavailable');
  const available=await safeRead(()=>store.status());
  if(available?.status!=='online')return state(source,kind,'unknown');
  const result=await safeRead(()=>store.list({page:1,pageSize:1}));
  const count=boundedCount(result?.pagination?.total);
  return state(source,kind,count===null?'unknown':count?'observed':'empty',count);
}
async function mapping(flights){
  const source='skyhub-ppk-flight-inventory';
  const kind='flight-inputs-not-coverage-results';
  if(!flights||typeof flights.list!=='function')return state(source,kind,'unavailable');
  const result=await safeRead(()=>flights.list());
  if(!Array.isArray(result)||result.length>10000)return state(source,kind,'unknown');
  const count=boundedCount(result.filter(f=>Number.isSafeInteger(f?.photos)&&f.photos>=2).length);
  return state(source,kind,count===null?'unknown':count?'observed':'empty',count);
}
async function thermal(storage,index){
  const source='skyhub-media-index';
  const kind='filename-candidates-not-calibration';
  if(!storage||typeof storage.buckets!=='function'||typeof index!=='function')
    return {...state(source,kind,'unavailable'),accuracyVerified:false};
  const buckets=await safeRead(()=>storage.buckets());
  if(!Array.isArray(buckets)||buckets.length>8||!buckets.every(x=>typeof x==='string'))
    return {...state(source,kind,'unknown'),accuracyVerified:false};
  let count=0;
  for(const bucket of buckets){
    const result=await safeRead(()=>index(bucket));
    if(!Array.isArray(result?.objects)||result.objects.length>15000)
      return {...state(source,kind,'unknown'),accuracyVerified:false};
    for(const object of result.objects){
      const name=typeof object?.displayName==='string'?object.displayName:
        typeof object?.key==='string'?object.key.split('/').pop():'';
      if(/_T\.jpe?g$/i.test(name))count++;
    }
  }
  const safe=boundedCount(count);
  return {...state(source,kind,safe===null?'unknown':safe?'observed':'empty',safe),accuracyVerified:false};
}
async function collectEvidence({wpmlStore=null,ppkFlights=null,mediaStorage=null,mediaIndex=null}={}){
  const [mission,mappingResult,thermalResult]=await Promise.all([
    missions(wpmlStore),mapping(ppkFlights),thermal(mediaStorage,mediaIndex)
  ]);
  return {schema:SCHEMA,readOnly:true,source:'existing-skyhub-local-inventories',
    deviceCorrelation:'not-established',hardwareVerified:false,flightReady:false,
    accuracyVerified:false,synthetic:false,
    modules:{mission,mapping:mappingResult,thermal:thermalResult}};
}
function createCloudApi2EvidenceRouter({express,...providers}){
  const router=express.Router();
  router.get('/evidence',async(_req,res)=>{
    res.set('Cache-Control','no-store');
    try{res.json(await collectEvidence(providers));}
    catch(_err){res.status(503).json({error:'Evidence inventory unavailable'});}
  });
  return router;
}
module.exports={SCHEMA,boundedCount,collectEvidence,createCloudApi2EvidenceRouter};
