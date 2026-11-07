// Strict browser projection: only known aggregate fields, never raw inventory records.
const SCHEMA='skyhub.cloudapi2.evidence.v1';
const ORDER=Object.freeze([
  Object.freeze({id:'mission',title:'WPML-Missionen',meaning:'Gespeicherte Revisionen, nicht freigegebene Flugaufträge'}),
  Object.freeze({id:'mapping',title:'Mapping-Eingangsflüge',meaning:'Foto-/PPK-Eingänge, keine berechneten Coverage-Ergebnisse'}),
  Object.freeze({id:'thermal',title:'Thermal-Dateikandidaten',meaning:'Dateinamensinventar, keine bestätigte Temperaturgenauigkeit'})
]);
const STATES=Object.freeze({observed:'INVENTAR VORHANDEN',empty:'KEINE EINTRÄGE',unknown:'NICHT NACHGEWIESEN',unavailable:'MODUL DEAKTIVIERT'});
function normalizeEvidence(input){
  if(!input||input.schema!==SCHEMA||input.readOnly!==true||
    input.flightReady!==false||input.hardwareVerified!==false||
    input.accuracyVerified!==false||input.deviceCorrelation!=='not-established'||
    input.synthetic!==false)throw new TypeError('Ungültiger oder ungesicherter Nachweisstatus');
  const modules=ORDER.map(entry=>{
    const item=input.modules?.[entry.id];
    const status=Object.hasOwn(STATES,item?.status)?item.status:'unknown';
    const count=(status==='observed'||status==='empty')&&
      Number.isSafeInteger(item?.count)&&item.count>=0&&item.count<=100000?item.count:null;
    const verifiedStatus=(status==='observed' && (count===null||count===0)) ||
      (status==='empty' && count!==0)?'unknown':status;
    return {...entry,status:verifiedStatus,count:verifiedStatus===status?count:null,label:STATES[verifiedStatus]};
  });
  return {modules,deviceCorrelation:'not-established',flightReady:false,accuracyVerified:false};
}
export {SCHEMA,ORDER,STATES,normalizeEvidence};
