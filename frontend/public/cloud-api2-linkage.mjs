// Privacy-preserving projection of authenticated, read-only SkyHub linkage audit.
const SCHEMA='skyhub.cloudapi2.linkage.v1';
const STATUS=new Set(['observed','empty','unknown','unavailable']);
const COUNT_MAX=100000;
function validCount(value){return Number.isSafeInteger(value)&&value>=0&&value<=COUNT_MAX;}
function normalizeLinkage(value){
  if(!value||value.schema!==SCHEMA||value.readOnly!==true||
    value.flightReady!==false||value.hardwareVerified!==false||
    value.synthetic!==false||value.deviceCorrelation!=='not-established'||
    value.modelCompatibility?.validatedExecution!==false)
    throw new TypeError('Unbestätigte Verknüpfungsdaten');
  const inventory={};
  for(const name of ['device','mission','media']){
    const node=value.inventories?.[name];
    if(!STATUS.has(node?.status))throw new TypeError('Ungültiger Inventarstatus');
    if(['observed','empty'].includes(node.status)){
      if(!validCount(node.count)|| (node.status==='observed'&&node.count===0) ||
        (node.status==='empty'&&node.count!==0))throw new TypeError('Ungültige Inventarzahl');
    }else if(node.count!==null)throw new TypeError('Unbekannter Inventarwert');
    inventory[name]={status:node.status,count:node.count};
  }
  const pairs=value.modelCompatibility?.candidatePairs;
  const status=value.modelCompatibility?.status;
  if(!['unknown','candidate-only','no-compatible-candidates'].includes(status)||
    (status==='unknown'&&pairs!==null)||
    (status==='candidate-only'&&(!validCount(pairs)||pairs===0))||
    (status==='no-compatible-candidates'&&pairs!==0))throw new TypeError('Ungültiger Modellabgleich');
  for(const kind of ['deviceMission','missionMedia','deviceMedia']){
    const link=value.links?.[kind];
    if(link?.status!=='not-established'||link.verified!==0)
      throw new TypeError('Unbelegte Zuordnung abgelehnt');
  }
  return {
    inventory,modelCandidatePairs:pairs,modelStatus:status,
    deviceMission:'not-established',missionMedia:'not-established',deviceMedia:'not-established',
    source:'SkyHub Cloud API 1.x, WPML metadata and Pilot 2 ingestion receipts',
    flightReady:false,hardwareVerified:false
  };
}
export {SCHEMA,normalizeLinkage};
