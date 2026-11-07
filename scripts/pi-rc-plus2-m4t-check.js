#!/usr/bin/env node
'use strict';
// Read-only validation of RC Plus 2 Enterprise + Matrice 4T against the
// already running SkyHub Next backend. No service restart and no MQTT publish.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {makePreflightEvidence,makeRuntimeEvidence,validateLiveEvidenceReceipt}=
  require('../backend/rc-plus2-m4t-evidence');
const {evaluateHardwareSession,formatReport}=
  require('../backend/rc-plus2-m4t-hardware-validation');

function help(){
  console.log('Nutzung: node scripts/pi-rc-plus2-m4t-check.js [--preflight | --runtime-check] [--json]');
  console.log('--runtime-check: nur Verfügbarkeit zweier Live-JSON-Module im laufenden Backend.');
  console.log('--json: streng begrenzter JSON-Prüfbeleg auf stdout, keine Dateien.');
  console.log('--preflight: ausschließlich Backend-APIs, MQTT und ACK prüfen; kein DJI-Gerät nötig.');
  console.log('Leseprüfung: RC Plus 2 Enterprise + Matrice 4T (DJI Cloud API 1.18).');
  console.log('Nur Modell, Topologie, Pairing-ANZAHLEN und dokumentierte Feldnamen.');
  console.log('Keine Seriennummern, Rohwerte, GPS-Koordinaten oder Tokens.');
  console.log('Bestehender Backend-Container wird weder neu gebaut noch gestartet.');
  console.log('SKYHUB_COMPOSE_DIR kann auf den bestehenden Compose-Ordner zeigen.');
  console.log('Exit 0: jeweiliges begrenztes Prüf-Gate erfüllt; 3: unvollständig; 1: Fehler; 2: Parameter.');
}
const args=process.argv.slice(2);
const preflight=args.includes('--preflight');
const runtimeCheck=args.includes('--runtime-check');
const json=args.includes('--json');
const valid=args.length<=2&&new Set(args).size===args.length&&
  !(preflight&&runtimeCheck)&&
  args.every(a=>a==='--preflight'||a==='--runtime-check'||a==='--json');
if(args.length===1&&args[0]==='--help'){
  help();
}else if(!valid){
  console.error('Ungültige Parameter. --help zeigt die sichere Nutzung.');
  process.exitCode=2;
}else{
  // This runs *inside* the already-running backend container. The view token
  // is read there, never forwarded to or printed by the host shell.
  const inside=String.raw`'use strict';
const PREFLIGHT=${preflight};
const RUNTIME_CHECK=${runtimeCheck};
const JSON_MODE=${json};
(async()=>{
  if(RUNTIME_CHECK){
    // Require only two known local modules in the already running backend.
    // Never inspect or export .env, credentials, source text, devices or logs.
    const checks=[
      ['evaluatorAvailable','./rc-plus2-m4t-hardware-validation',
        ['evaluateHardwareSession']],
      ['evidenceAvailable','./rc-plus2-m4t-evidence',
        ['makeLiveEvidence','validateLiveEvidenceReceipt']]
    ];
    const output={schema:'skyhub-rcplus2-m4t-runtime-check-v1'};
    for(const [key,moduleName,exportsRequired] of checks){
      try{
        const loaded=require(moduleName);
        output[key]=exportsRequired.every(name=>typeof loaded?.[name]==='function');
      }catch(_){output[key]=false;}
    }
    process.stdout.write(JSON.stringify(output));
    return;
  }
  const token=process.env.SKYHUB_VIEW_TOKEN;
  if(!token){process.exitCode=1;return;}
  async function get(uri,authorized){
    const res=await fetch('http://127.0.0.1:4000'+uri,{
      headers:authorized?{Authorization:'Bearer '+token}:{},
      signal:AbortSignal.timeout(5000)
    });
    if(!res.ok)throw Error('request rejected');
    return res.json();
  }
  try{
    const requests=[
      get('/api/health',false),get('/api/devices',true),
      get('/api/diagnostics/mqtt-shapes',true),
      get('/api/pilot-admin/pairings',true)
    ];
    // Missing optional API endpoints are incomplete prerequisites, not an
    // undiagnosable crash. Preflight and live JSON isolate every GET failure
    // (the host reports them as exit 3); the human-readable mode stays strict.
    const [health,devices,shapes,pairings]=await Promise.all(
      requests.map((request,index)=>
        (PREFLIGHT||JSON_MODE||index===3)?request.catch(()=>null):request)
    );
    if(PREFLIGHT){
      // Preflight intentionally keeps full snapshots inside the container:
      // only a fixed, anonymized allowlist of booleans crosses stdout.
      const okObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
      const result={
        schema:'skyhub-rcplus2-m4t-preflight-v1',
        healthApi:okObject(health),
        devicesApi:Array.isArray(devices),
        shapesApi:Array.isArray(shapes),
        pairingsApi:okObject(pairings)&&Array.isArray(pairings.devices)&&
          Array.isArray(pairings.pending),
        mqttConnected:health?.mqtt===true,
        subscribed:health?.subscribed===true,
        topologyAckEnabled:health?.topologyReplyEnabled===true,
        topologyAckConnected:health?.topologyReplyConnected===true
      };
      process.stdout.write(JSON.stringify(result));
      return;
    }
    if(JSON_MODE){
      // Live JSON is evaluated inside the *running* backend container.
      // Do not transfer raw DJI device, GNSS, pairing or MQTT API snapshots.
      // If the runtime image lacks these modules, fail closed: no deployment.
      const unavailable=reason=>process.stdout.write(JSON.stringify(
        {schema:'skyhub-rcplus2-m4t-live-unavailable-v1',reason}));
      let evaluateHardwareSession,makeLiveEvidence;
      try{
        ({evaluateHardwareSession}=require('./rc-plus2-m4t-hardware-validation'));
        ({makeLiveEvidence}=require('./rc-plus2-m4t-evidence'));
      }catch(_){return unavailable('modules-missing');}
      if(!health||!Array.isArray(devices)||!Array.isArray(shapes))return unavailable('api');
      const report=evaluateHardwareSession(devices,health,shapes,Date.now(),pairings);
      process.stdout.write(JSON.stringify(makeLiveEvidence(report)));
      return;
    }
    const payload=JSON.stringify({health,devices,shapes,pairings});
    if(payload.length>3000000)throw Error('response too large');
    process.stdout.write(payload);
  }catch(_){process.exitCode=1;}
})();`;
  const composeDir=process.env.SKYHUB_COMPOSE_DIR?
    path.resolve(process.env.SKYHUB_COMPOSE_DIR):path.resolve(__dirname,'..');
  const exec=spawnSync('docker',
    ['compose','-p','skyhub-next','exec','-T','backend','node','-e',inside],
    {cwd:composeDir,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
  if(exec.error||exec.status!==0||!exec.stdout){
    console.error('Hardwarecheck fehlgeschlagen: Docker/Backend oder geschützte GET-APIs prüfen.');
    process.exitCode=1;
  }else{
    try{
      const data=JSON.parse(exec.stdout);
      if(json&&!runtimeCheck&&!preflight&&data?.schema==='skyhub-rcplus2-m4t-live-unavailable-v1'){
        // Distinguish "backend image too old" and "API not answering" from a
        // garbled reply; both are incomplete prerequisites (exit 3), no receipt.
        console.error(data.reason==='modules-missing'
          ?'Live-JSON nicht verfügbar: laufendes Backend-Image enthält die Evidence-Module nicht. Zuerst --runtime-check, dann Backend aktualisieren.'
          :'Live-JSON nicht verfügbar: Health-, Devices- oder Shapes-API antwortet nicht. --preflight prüfen.');
        process.exitCode=3;
        return;
      }
      if(runtimeCheck){
        const keys=['evaluatorAvailable','evidenceAvailable'];
        if(data?.schema!=='skyhub-rcplus2-m4t-runtime-check-v1'||
            Object.keys(data).length!==3||
            keys.some(key=>typeof data[key]!=='boolean')){
          throw Error('unrecognized runtime readiness reply');
        }
        const ready=keys.every(key=>data[key]);
        if(json){
          console.log(JSON.stringify(makeRuntimeEvidence(data)));
        }else{
          console.log('=== RC Plus 2/M4T – Backend-Live-JSON-Modulprüfung ===');
          console.log('Live-Evaluator ladbar: '+(data.evaluatorAvailable?'JA':'NEIN'));
          console.log('JSON-Evidence-Modul ladbar: '+(data.evidenceAvailable?'JA':'NEIN'));
          console.log('Live-JSON-Module: '+(ready?'BEREIT':'UNVOLLSTÄNDIG'));
          console.log('Kein DJI-Gerätenachweis, kein Backend-Deployment.');
        }
        process.exitCode=ready?0:3;
      }else if(preflight){
        const keys=['healthApi','devicesApi','shapesApi','pairingsApi',
          'mqttConnected','subscribed','topologyAckEnabled','topologyAckConnected'];
        if(data?.schema!=='skyhub-rcplus2-m4t-preflight-v1'||
            keys.some(k=>typeof data[k]!=='boolean')){
          throw Error('unrecognized preflight reply');
        }
        const ready=keys.every(k=>data[k]===true);
        if(json){
          console.log(JSON.stringify(makePreflightEvidence(data)));
        }else{
          console.log('=== RC Plus 2/M4T – nur lesender Pi-Backend-Preflight ===');
          for(const [key,label] of [
            ['healthApi','Health-API'],['devicesApi','Devices-API'],
            ['shapesApi','MQTT-Shapes-API'],['pairingsApi','Pairing-API (nur GET)'],
            ['mqttConnected','MQTT verbunden'],['subscribed','MQTT abonniert'],
            ['topologyAckEnabled','Topologie-ACK aktiviert'],
            ['topologyAckConnected','Topologie-ACK-Publisher verbunden']
          ]){
            console.log(label+': '+(data[key]?'JA':'NEIN'));
          }
          console.log('Pi-Backend-Voraussetzungen: '+(ready?'BEREIT':'UNVOLLSTÄNDIG'));
          console.log('Kein DJI-Gerätenachweis, keine Hardware- oder Flugfreigabe.');
        }
        process.exitCode=ready?0:3;
      }else if(json){
        if(!validateLiveEvidenceReceipt(data))throw Error('invalid receipt');
        console.log(JSON.stringify(data));
        process.exitCode=data.result==='TRANSPORT_SMOKE_OK'?0:3;
      }else{
        // Historical human-readable mode retains its bounded local snapshot pipe.
        const report=evaluateHardwareSession(data.devices,data.health,data.shapes,
          Date.now(),data.pairings);
        console.log(formatReport(report));
        process.exitCode=report.passed?0:3;
      }
    }catch(_){
      console.error('Hardwarecheck fehlgeschlagen: Backend-Antwort nicht auswertbar.');
      process.exitCode=1;
    }
  }
}
