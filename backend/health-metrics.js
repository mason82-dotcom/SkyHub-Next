'use strict';

// Prometheus text exposition (format 0.0.4) of the public /api/health snapshot.
// Same exposure class as /api/health: counters, flags and timestamps only. Serial numbers, topics,
// workspace ids or other payload-derived strings never become metric names or label values:
// names come from the snapshot keys (code-defined), labels only from the allowlisted count maps below.

const LABELLED_MAPS=Object.freeze({
  mqttChannelCounts:'channel',
  mqttObservedChannelCounts:'channel',
  mqttDroppedByReason:'reason'
});
const LABEL_VALUE=/^[A-Za-z0-9_.:-]{1,64}$/;

function snake(key){
  return String(key).replace(/([a-z0-9])([A-Z])/g,'$1_$2').replace(/[^A-Za-z0-9_]/g,'_').toLowerCase();
}

function numeric(value){
  if(typeof value==='boolean')return value?1:0;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  return null;
}

// Epoch-millisecond fields (`...At`) are exported in seconds, as Prometheus expects.
function addValue(out,name,key,value){
  const n=numeric(value);
  if(n===null)return;
  if(/At$/.test(key))out.push([`${name}_timestamp_seconds`,'',n/1000]);
  else out.push([name,'',n]);
}

function collect(snapshot){
  const out=[];
  out.push(['skyhub_online','',snapshot&&snapshot.status==='online'?1:0]);
  for(const [key,value] of Object.entries(snapshot||{})){
    if(key==='status')continue;
    const name=`skyhub_${snake(key)}`;
    if(Object.hasOwn(LABELLED_MAPS,key)){
      const label=LABELLED_MAPS[key];
      for(const [item,count] of Object.entries(value||{})){
        const n=numeric(count);
        if(n!==null&&LABEL_VALUE.test(item))out.push([name,`{${label}="${item}"}`,n]);
      }
    }else if(value&&typeof value==='object'&&!Array.isArray(value)){
      // One level of nesting (tileCache, liveStream, tsa, pilotMediaUpload); deeper objects are skipped.
      for(const [inner,innerValue] of Object.entries(value)){
        if(innerValue&&typeof innerValue==='object')continue;
        addValue(out,`${name}_${snake(inner)}`,inner,innerValue);
      }
    }else{
      addValue(out,name,key,value);
    }
  }
  return out;
}

function renderHealthMetrics(snapshot){
  const lines=[];
  const typed=new Set();
  for(const [name,labels,value] of collect(snapshot)){
    if(!typed.has(name)){
      typed.add(name);
      lines.push(`# TYPE ${name} gauge`);
    }
    lines.push(`${name}${labels} ${value}`);
  }
  return lines.join('\n')+'\n';
}

module.exports={renderHealthMetrics};
