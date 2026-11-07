'use strict';
// Explicit, authenticated, operator-requested live read-only diagnostics.
// All sensitive registry and Pilot 2 pairing inputs stay inside the backend.
// This is DJI Cloud API 1.x evidence, NOT DJI Cloud API 2 / flight certification.
const {evaluateHardwareSession}=require('./rc-plus2-m4t-hardware-validation');
const {makeLiveEvidence,validateLiveEvidenceReceipt}=require('./rc-plus2-m4t-evidence');
const MAX_DEVICES=200;
const MAX_SHAPES=128;
const PAIRING_TIMEOUT_MS=2000;

async function readPairings(pairing,timeoutMs=PAIRING_TIMEOUT_MS){
  if(!pairing||typeof pairing.devices!=='function')return null;
  let timeout;
  try{
    const devices=await Promise.race([
      Promise.resolve().then(()=>pairing.devices()),
      new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Timed out')),timeoutMs);})
    ]);
    if(!Array.isArray(devices)||devices.length>MAX_DEVICES)return null;
    // Never return pending codes; the evaluator only needs a typed empty list.
    return {devices,pending:[]};
  }catch(_error){return null;}
  finally{clearTimeout(timeout);}
}
async function collectHardwareEvidence({registry,healthSnapshot,mqttShapes,pairing},date=new Date()){
  if(!(date instanceof Date)||!Number.isFinite(date.getTime())||
      !registry||typeof registry.snapshot!=='function'||
      typeof healthSnapshot!=='function'||!mqttShapes||
      typeof mqttShapes.snapshot!=='function')throw new TypeError('Unavailable evidence providers');
  const now=date.getTime();
  // No state changes or MQTT publication. Read the in-memory snapshots once.
  const devices=registry.snapshot(now);
  const health=healthSnapshot();
  const shapes=mqttShapes.snapshot();
  if(!Array.isArray(devices)||devices.length>MAX_DEVICES||
      !Array.isArray(shapes)||shapes.length>MAX_SHAPES)throw new TypeError('Invalid evidence source');
  const pairings=await readPairings(pairing);
  const report=evaluateHardwareSession(devices,health,shapes,now,pairings);
  // Exact-key strict allowlist already used by the Pi's --json hardware test.
  const receipt=makeLiveEvidence(report,date);
  if(!validateLiveEvidenceReceipt(receipt))throw new TypeError('Invalid sanitized hardware evidence');
  return receipt;
}
function createCloudApi2HardwareRouter({express,...providers}){
  const router=express.Router();
  router.get('/hardware/rc-plus2-m4t',async(_req,res)=>{
    res.set('Cache-Control','no-store');
    try{res.json(await collectHardwareEvidence(providers));}
    catch(_error){res.status(503).json({error:'Hardware evidence unavailable'});}
  });
  return router;
}
module.exports={readPairings,collectHardwareEvidence,createCloudApi2HardwareRouter};
