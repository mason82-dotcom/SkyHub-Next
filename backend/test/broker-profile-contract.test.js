'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {validateBrokerConfig}=require('../mqtt-config');

// The broker kind -> port pairing lives in three independent places (backend validator,
// Pi preflight, Pi update script). They must never drift apart: a profile that only one of
// them knows makes `pi-update-backend.sh` refuse a configuration the backend accepts.
const ROOT=path.resolve(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const sorted=map=>Object.fromEntries(Object.entries(map).sort(([a],[b])=>a.localeCompare(b)));

function fromBackend(){
  const m=/expectedPorts\s*=\s*Object\.freeze\(\{([^}]*)\}\)/.exec(read('backend/mqtt-config.js'));
  assert.ok(m,'expectedPorts table not found in backend/mqtt-config.js');
  return sorted(Object.fromEntries([...m[1].matchAll(/['"]?([a-z0-9-]+)['"]?\s*:\s*(\d+)/g)].map(([,k,v])=>[k,Number(v)])));
}
function fromPreflight(){
  const m=/case "\$broker_kind\/\$broker_port" in\s*\n\s*([^)]*)\) ;;/.exec(read('scripts/pi-preflight.sh'));
  assert.ok(m,'broker kind/port case not found in scripts/pi-preflight.sh');
  return sorted(Object.fromEntries(m[1].trim().split('|').map(pair=>{
    const [kind,port]=pair.split('/');return [kind,Number(port)];})));
}
function fromUpdateScript(){
  const m=/expected=\{([^}]*)\}/.exec(read('scripts/pi-update-backend.sh'));
  assert.ok(m,'expected profile dict not found in scripts/pi-update-backend.sh');
  return sorted(Object.fromEntries([...m[1].matchAll(/"([a-z0-9-]+)"\s*:\s*"(\d+)"/g)].map(([,k,v])=>[k,Number(v)])));
}

test('broker profile tables are identical in backend, preflight and update script',()=>{
  const backend=fromBackend();
  assert.ok(Object.keys(backend).length>=3,'expected at least emqx, mosquitto and mosquitto-dedicated');
  assert.deepEqual(fromPreflight(),backend,'scripts/pi-preflight.sh differs from backend/mqtt-config.js');
  assert.deepEqual(fromUpdateScript(),backend,'scripts/pi-update-backend.sh differs from backend/mqtt-config.js');
});

test('the backend validator really enforces the table it declares',()=>{
  for(const [kind,port] of Object.entries(fromBackend())){
    const url='mqtt://host.docker.internal:'+port;
    assert.equal(validateBrokerConfig(url,String(port),kind).port,port,kind);
    for(const wrong of [port-1,port+1]){
      assert.throws(()=>validateBrokerConfig('mqtt://host.docker.internal:'+wrong,String(wrong),kind),
        /requires (port|SKYHUB_MQTT_REQUIRED_PORT)/,kind+' must reject port '+wrong);
    }
  }
});
