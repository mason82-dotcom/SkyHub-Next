'use strict';
const KEYS=['accepted','ignored','rtkTransitions','flightStarts','flightEnds',
 'deviceEvictions','msdkAccepted','trackedDevices','activeFlights'];
function fhMetrics(observer){
 const s=observer.metrics();
 return KEYS.map(k=>{
  const name='skyhub_fh_'+k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase());
  const type=['trackedDevices','activeFlights'].includes(k)?'gauge':'counter';
  const value=Number.isSafeInteger(s[k])&&s[k]>=0?s[k]:0;
  return '# TYPE '+name+' '+type+'\n'+name+' '+value+'\n';
 }).join('');
}
module.exports={fhMetrics};
