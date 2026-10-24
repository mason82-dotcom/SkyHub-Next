#!/usr/bin/env node
'use strict';
// Dedicated, authenticated Mosquitto instance for SkyHub Next + DJI Pilot 2 on TCP 1884.
// It runs next to the existing host Mosquitto (1883, Xiaozhi, anonymous) and never touches it.
//   node scripts/pi-mosquitto-dedicated.js plan               show ACL (no secrets), needs no root
//   node scripts/pi-mosquitto-dedicated.js init-env [--write] add missing MQTT_USER/MQTT_PASSWORD to .env
//   sudo node scripts/pi-mosquitto-dedicated.js apply         create unit + config, verify, auto-rollback
//   node scripts/pi-mosquitto-dedicated.js verify             re-run the login and ACL probes
//   sudo node scripts/pi-mosquitto-dedicated.js status        listener, recent client connects (no payloads)
//   sudo node scripts/pi-mosquitto-dedicated.js rollback      remove the unit and /etc/skyhub-mosquitto
// Credentials come from ./.env and are never printed. SkyHub's .env and backend stay untouched by
// apply; switch them afterwards with the steps printed at the end (profile mosquitto-dedicated).
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');

const ROOT=path.resolve(__dirname,'..');
const PORT=1884;
const UNIT='skyhub-mosquitto';
const CONF_DIR='/etc/skyhub-mosquitto';
const UNIT_FILE='/etc/systemd/system/'+UNIT+'.service';
const BACKUP_ROOT='/var/backups';
const MOSQUITTO_BIN='/usr/sbin/mosquitto';
const ENV_PATH=path.join(ROOT,'.env');
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');

function readEnv(){
  const env={};
  for(const line of fs.readFileSync(ENV_PATH,'utf8').split('\n')){
    const m=/^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if(m)env[m[1]]=m[2];
  }
  return env;
}
function accounts(){
  const env=readEnv();
  const list={
    reader:{username:env.MQTT_USER,password:env.MQTT_PASSWORD},
    ack:{username:env.SKYHUB_TOPOLOGY_ACK_MQTT_USER,password:env.SKYHUB_TOPOLOGY_ACK_MQTT_PASSWORD},
    pilot:{username:env.SKYHUB_PILOT_MQTT_USER,password:env.SKYHUB_PILOT_MQTT_PASSWORD}
  };
  for(const [role,a] of Object.entries(list)){
    if(!a.username || !/^[A-Za-z0-9_.-]{1,64}$/.test(a.username)){
      throw new Error(role+': ungültiger oder fehlender MQTT-Benutzername in .env'+
        (role==='reader'?' (Lösung: node scripts/pi-mosquitto-dedicated.js init-env --write)':''));
    }
    if(!a.password || a.password.length<16 || /[\r\n]/.test(a.password)){
      throw new Error(role+': MQTT-Passwort fehlt oder zu kurz (mind. 16 Zeichen, eine Zeile)'+
        (role==='reader'?' (Lösung: node scripts/pi-mosquitto-dedicated.js init-env --write)':''));
    }
  }
  const names=new Set(Object.values(list).map(a=>a.username));
  if(names.size!==3)throw new Error('Reader, Topologie-Publisher und Pilot brauchen verschiedene Benutzer');
  return list;
}

// Same topic split as scripts/pi-emqx-harden.js. Mosquitto denies everything not listed.
// Probe namespace: no SkyHub subscription matches it, so probe traffic is never ingested as
// telemetry. Reader may read it and the pilot may write it, so `verify` can prove both directions.
const PROBE_TOPIC='skyhub/probe';
const READER_READ=['sys/product/+/status','thing/product/+/osd','thing/product/+/state',
  'thing/product/+/events','thing/product/+/services_reply',PROBE_TOPIC+'/#'];
const ACK_WRITE=['sys/product/+/status_reply'];
// "+" instead of the RC serial: the RC also publishes for its aircraft.
const PILOT_WRITE=['sys/product/+/status','thing/product/+/osd','thing/product/+/state',
  'thing/product/+/events','thing/product/+/services_reply','thing/product/+/requests',
  'thing/product/+/property/set_reply','thing/product/+/drc/up',PROBE_TOPIC+'/#'];
const PILOT_READ=['sys/product/+/status_reply','sys/product/+/network/probe','thing/product/+/services',
  'thing/product/+/property/set','thing/product/+/events_reply','thing/product/+/requests_reply',
  'thing/product/+/state_reply','thing/product/+/drc/down'];

// Topics the delivery test publishes (see aclCases for the rule they must follow).
const DELIVERY_PUBLISH={
  ack:['sys/product/SKYHUBPROBE/status_reply'],
  pilot:['thing/product/SKYHUBPROBE/requests',PROBE_TOPIC+'/delivery']
};
function aclText(a){
  const block=(user,write,read)=>[
    'user '+user,
    ...write.map(t=>'topic write '+t),
    ...read.map(t=>'topic read '+t),
    ''];
  return [
    '# SkyHub Next - managed by scripts/pi-mosquitto-dedicated.js. No entry means denied.',
    '',
    ...block(a.reader.username,[],READER_READ),
    ...block(a.ack.username,ACK_WRITE,[]),
    ...block(a.pilot.username,PILOT_WRITE,PILOT_READ)
  ].join('\n');
}
function confText(){
  return [
    '# SkyHub Next - managed by scripts/pi-mosquitto-dedicated.js',
    'listener '+PORT+' 0.0.0.0',
    'protocol mqtt',
    'allow_anonymous false',
    'password_file '+CONF_DIR+'/passwd',
    'acl_file '+CONF_DIR+'/acl',
    'persistence false',
    'log_dest stderr',
    'log_type error',
    'log_type warning',
    'log_type notice',
    'connection_messages true',
    'max_connections 50',
    'max_packet_size 1048576',
    ''
  ].join('\n');
}
function unitText(){
  return [
    '[Unit]',
    'Description=SkyHub Next dedicated authenticated Mosquitto (DJI Pilot 2, TCP '+PORT+')',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'User=mosquitto',
    'ExecStart='+MOSQUITTO_BIN+' -c '+CONF_DIR+'/mosquitto.conf',
    'Restart=on-failure',
    'RestartSec=3',
    'NoNewPrivileges=true',
    'ProtectSystem=strict',
    'ProtectHome=true',
    'PrivateTmp=true',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    ''
  ].join('\n');
}
// mosquitto 2.0 sha512-pbkdf2 entry. Hashed here so the password never appears in argv or `ps`.
function passwdLine(account){
  const salt=crypto.randomBytes(12);
  const hash=crypto.pbkdf2Sync(account.password,salt,101,64,'sha512');
  return account.username+':$7$101$'+salt.toString('base64')+'$'+hash.toString('base64');
}

function sh(cmd,...args){return execFileSync(cmd,args,{encoding:'utf8'});}
function requireRoot(){
  if(process.getuid()!==0)throw new Error('Dieser Schritt braucht root: sudo node scripts/pi-mosquitto-dedicated.js '+process.argv[2]);
}
let mosquittoIds;
// The service runs as "mosquitto": every path it reads, the directory included, must belong to it.
function owned(target,mode){
  mosquittoIds??=[Number(sh('id','-u','mosquitto').trim()),Number(sh('id','-g','mosquitto').trim())];
  fs.chownSync(target,...mosquittoIds);
  fs.chmodSync(target,mode);
}
function ensureConfDir(){
  fs.mkdirSync(CONF_DIR,{recursive:true,mode:0o750});
  owned(CONF_DIR,0o750);
}
function writeOwned(file,text,mode){
  fs.writeFileSync(file,text,{mode});
  owned(file,mode);
}
function listening(){
  return sh('ss','-ltnH').split('\n').some(l=>l.trim().split(/\s+/)[3]?.endsWith(':'+PORT));
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// Mosquitto (acl_file) grants wildcard SUBSCRIBEs and filters at delivery, so ACLs are proven by
// what actually arrives, not by SUBACK codes. Probes run inside the SkyHub Next backend container
// (MQTT.js, same network path as production). Credentials go through stdin, never through argv.
function probeProgram(broker,payload){
  return `
const mqtt=require('/app/backend/node_modules/mqtt');
const {cases,users}=${JSON.stringify(payload)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const options=u=>({clientId:'skyhub_acl_probe_'+Math.random().toString(16).slice(2,8),protocolVersion:5,
  reconnectPeriod:0,connectTimeout:5000,...(u.username?{username:u.username}:{}),...(u.password?{password:u.password}:{})});
function run(c){return new Promise(resolve=>{
  const cl=mqtt.connect(${JSON.stringify(broker)},options(c));
  const done=r=>{cl.end(true);resolve(r);};
  const timer=setTimeout(()=>done('timeout'),8000);
  cl.on('error',err=>{clearTimeout(timer);done('refused:'+(err.code??'?'));});
  cl.on('connect',()=>{
    if(c.action==='connect'){clearTimeout(timer);return done('connected');}
    cl.publish(c.topic,'{}',{qos:1},(err)=>{clearTimeout(timer);
      done(err?(err.code===135||/not authorized/i.test(err.message)?'denied':'error:'+err.code):'allowed');});
  });
});}
const connect=u=>new Promise((res,rej)=>{const c=mqtt.connect(${JSON.stringify(broker)},options(u));
  c.on('connect',()=>res(c));c.on('error',rej);});
async function delivery(){
  const got={reader:[],ack:[],pilot:[]},cl={};
  for(const k of Object.keys(got)){
    cl[k]=await connect(users[k]);
    cl[k].on('message',t=>got[k].push(t));
    await new Promise(r=>cl[k].subscribe('#',{qos:1},r));
  }
  await sleep(300);
  for(const t of ${JSON.stringify(DELIVERY_PUBLISH.ack)})cl.ack.publish(t,'{}',{qos:1});
  for(const t of ${JSON.stringify(DELIVERY_PUBLISH.pilot)})cl.pilot.publish(t,'{}',{qos:1});
  await sleep(1500);
  for(const c of Object.values(cl))c.end(true);
  return got;
}
(async()=>{const results=[];for(const c of cases)results.push(await run(c));
  let got=null;
  if(users)try{got=await delivery();}catch(e){got={error:String(e.code||e.message)};}
  console.log(JSON.stringify({results,got}));})();`;
}
function probe(payload){
  const out=execFileSync('docker',['compose','-p','skyhub-next','exec','-T','backend','node','-'],
    {cwd:ROOT,input:probeProgram('mqtt://host.docker.internal:'+PORT,payload),encoding:'utf8',timeout:120000});
  return JSON.parse(out.trim().split('\n').pop());
}
function connectCases(a){
  return [
    {name:'anonym verbinden',action:'connect',expect:/^refused/},
    {name:'falsches Passwort',action:'connect',username:a.reader.username,password:'x'.repeat(20),expect:/^refused/},
    {name:'Reader verbinden',action:'connect',...a.reader,expect:/^connected$/},
    {name:'Topologie-Publisher verbinden',action:'connect',...a.ack,expect:/^connected$/},
    {name:'Pilot-Konto verbinden',action:'connect',...a.pilot,expect:/^connected$/}
  ];
}
// Allowed publishes only use topics the backend does not subscribe to (status_reply, requests,
// PROBE_TOPIC); denied ones never reach any subscriber. Never publish a topic SkyHub ingests
// (osd, state, status, events, services_reply): the backend would register the probe serial as a device.
function aclCases(a){
  return [
    {name:'Reader sendet services',action:'publish',topic:'thing/product/SKYHUBPROBE/services',...a.reader,expect:/^denied$/},
    {name:'Reader sendet Probe-Topic',action:'publish',topic:PROBE_TOPIC+'/reader',...a.reader,expect:/^denied$/},
    {name:'Publisher sendet status_reply',action:'publish',topic:'sys/product/SKYHUBPROBE/status_reply',...a.ack,expect:/^allowed$/},
    {name:'Publisher sendet services',action:'publish',topic:'thing/product/SKYHUBPROBE/services',...a.ack,expect:/^denied$/},
    {name:'Pilot sendet requests',action:'publish',topic:'thing/product/SKYHUBPROBE/requests',...a.pilot,expect:/^allowed$/},
    {name:'Pilot sendet Probe-Topic',action:'publish',topic:PROBE_TOPIC+'/pilot',...a.pilot,expect:/^allowed$/},
    {name:'Pilot faelscht status_reply',action:'publish',topic:'sys/product/SKYHUBPROBE/status_reply',...a.pilot,expect:/^denied$/}
  ];
}
// Delivery matrix with all three roles subscribed to "#": each must receive exactly its read topics.
function deliveryChecks(got){
  if(got.error)return [{name:'Zustelltest ausfuehrbar',value:got.error,pass:false}];
  const has=(k,t)=>got[k].includes(t);
  const only=(k,allowed)=>got[k].every(t=>allowed.includes(t));
  return [
    {name:'Reader erhaelt Probe-Topic',pass:has('reader',PROBE_TOPIC+'/delivery')},
    {name:'Reader erhaelt nur Lese-Topics',pass:only('reader',[PROBE_TOPIC+'/delivery'])},
    {name:'Topologie-Publisher erhaelt nichts',pass:got.ack.length===0},
    {name:'Pilot erhaelt status_reply',pass:has('pilot','sys/product/SKYHUBPROBE/status_reply')},
    {name:'Pilot erhaelt nur Lese-Topics',pass:only('pilot',['sys/product/SKYHUBPROBE/status_reply'])}
  ].map(c=>({...c,value:c.pass?'ok':'verletzt'}));
}
// users: the three role accounts, given only when the delivery matrix should run as well.
function report(cases,users){
  const {results,got}=probe({cases:cases.map(({expect,name,...c})=>c),users:users||null});
  let ok=true;
  cases.forEach((c,i)=>{
    const pass=c.expect.test(results[i]);
    if(!pass)ok=false;
    console.log((pass?'  ok   ':'  FEHL ')+c.name.padEnd(38)+results[i]);
  });
  if(users)for(const d of deliveryChecks(got)){
    if(!d.pass)ok=false;
    console.log((d.pass?'  ok   ':'  FEHL ')+d.name.padEnd(38)+d.value);
  }
  return ok;
}

function removeInstall(){
  try{sh('systemctl','disable','--now',UNIT);}catch(_){}
  fs.rmSync(UNIT_FILE,{force:true});
  fs.rmSync(CONF_DIR,{recursive:true,force:true});
  sh('systemctl','daemon-reload');
  try{sh('systemctl','reset-failed',UNIT);}catch(_){}
}
function install(a){
  ensureConfDir();
  writeOwned(CONF_DIR+'/passwd',Object.values(a).map(passwdLine).join('\n')+'\n',0o600);
  writeOwned(CONF_DIR+'/acl',aclText(a),0o600);
  writeOwned(CONF_DIR+'/mosquitto.conf',confText(),0o640);
  fs.writeFileSync(UNIT_FILE,unitText(),{mode:0o644});
  sh('systemctl','daemon-reload');
  sh('systemctl','enable',UNIT);
  sh('systemctl','restart',UNIT);
}
async function waitListening(){
  for(let i=0;i<20;i++){if(listening())return true;await sleep(500);}
  return false;
}

function initEnv(write){
  const text=fs.readFileSync(ENV_PATH,'utf8');
  const env=readEnv();
  const additions=[];
  if(!env.MQTT_USER)additions.push('MQTT_USER=skyhub_reader');
  if(!env.MQTT_PASSWORD)additions.push('MQTT_PASSWORD='+crypto.randomBytes(24).toString('base64url'));
  if(!additions.length){console.log('MQTT_USER und MQTT_PASSWORD sind bereits gesetzt - nichts zu tun.');return;}
  console.log('Fehlend in .env: '+additions.map(l=>l.split('=')[0]).join(', ')+' (Werte werden nicht angezeigt)');
  if(!write){console.log('Trockenlauf. Mit --write wird zuerst eine Sicherung (0600) angelegt, dann ergänzt.');return;}
  const backup=ENV_PATH+'.before-mqtt-reader-'+stamp();
  fs.writeFileSync(backup,text,{mode:0o600});
  const tmp=ENV_PATH+'.tmp-'+process.pid;
  fs.writeFileSync(tmp,text+(text.endsWith('\n')?'':'\n')+additions.join('\n')+'\n',{mode:0o600});
  fs.renameSync(tmp,ENV_PATH);
  fs.chmodSync(ENV_PATH,0o600);
  console.log('.env ergänzt, Sicherung: '+path.basename(backup));
}

function status(){
  requireRoot();
  const active=(()=>{try{return sh('systemctl','is-active',UNIT).trim();}catch(e){return 'inactive';}})();
  console.log('Dienst '+UNIT+': '+active+' | TCP '+PORT+' lauscht: '+(listening()?'ja':'nein'));
  let log='';
  try{log=sh('journalctl','-u',UNIT,'--since','-30min','--no-pager','-o','cat');}catch(_){}
  const byUser={},byIp={};let denied=0;
  const count=(map,key)=>{map[key]=(map[key]||0)+1;};
  for(const line of log.split('\n')){
    const m=/New client connected from ([0-9a-fA-F:.]+):\d+ as \S+ \(.*u'([^']*)'\)/.exec(line);
    if(m){count(byUser,m[2]);count(byIp,m[1]);}
    if(/not authori[sz]ed|bad user name or password/i.test(line))denied++;
  }
  console.log('Letzte 30 min - Verbindungen je Benutzer: '+JSON.stringify(byUser));
  console.log('Letzte 30 min - Verbindungen je Quell-IP:  '+JSON.stringify(byIp));
  console.log('Letzte 30 min - abgelehnte Anmeldungen:    '+denied);
}

async function main(){
  const cmd=process.argv[2];
  if(cmd==='plan'){
    const a=accounts();
    const names=Object.fromEntries(Object.keys(a).map(k=>[k,{username:'<'+k+'>'}]));
    console.log('Benutzer: reader, topology-ack, pilot (Namen aus .env, Passwörter werden nicht angezeigt)');
    console.log('--- '+CONF_DIR+'/mosquitto.conf ---\n'+confText());
    console.log('--- '+CONF_DIR+'/acl ---\n'+aclText(names));
    return;
  }
  if(cmd==='init-env'){initEnv(process.argv.includes('--write'));return;}
  if(cmd==='verify'){
    const a=accounts();
    console.log('Anmeldung:');const c=report(connectCases(a));
    console.log('Berechtigungen (Senden) und Zustellung:');const z=report(aclCases(a),a);
    process.exitCode=c&&z?0:1;return;
  }
  if(cmd==='status'){status();return;}
  if(cmd==='rollback'){
    requireRoot();removeInstall();
    console.log('Entfernt: '+UNIT+' und '+CONF_DIR+'. Der Broker auf 1883 und die .env wurden nicht verändert.');
    return;
  }
  if(cmd!=='apply'){
    console.error('Verwendung: node scripts/pi-mosquitto-dedicated.js plan|init-env [--write]|apply|verify|status|rollback');
    process.exitCode=2;return;
  }

  requireRoot();
  const a=accounts();
  if(!fs.existsSync(MOSQUITTO_BIN))throw new Error(MOSQUITTO_BIN+' fehlt');
  const hadInstall=fs.existsSync(CONF_DIR)||fs.existsSync(UNIT_FILE);
  if(!hadInstall && listening())throw new Error('TCP '+PORT+' ist bereits belegt (nicht von '+UNIT+')');
  let backup=null;
  if(hadInstall){
    backup=BACKUP_ROOT+'/'+UNIT+'-'+stamp();
    fs.mkdirSync(backup,{recursive:true,mode:0o700});
    if(fs.existsSync(CONF_DIR))fs.cpSync(CONF_DIR,backup+'/conf',{recursive:true});
    if(fs.existsSync(UNIT_FILE))fs.copyFileSync(UNIT_FILE,backup+'/unit');
    console.log('1/4 Vorhandene Installation gesichert: '+backup);
  }else console.log('1/4 Neuinstallation, nichts zu sichern');
  try{
    console.log('2/4 Konfiguration, Passwortdatei (PBKDF2), ACL und systemd-Unit schreiben, starten');
    install(a);
    if(!await waitListening())throw new Error('Broker lauscht nach 10 s nicht auf TCP '+PORT);
    console.log('3/4 Anmeldung prüfen');
    if(!report(connectCases(a)))throw new Error('Anmeldeprüfung fehlgeschlagen');
    console.log('4/4 ACL prüfen (Senderechte + Zustellung)');
    if(!report(aclCases(a),a))throw new Error('ACL-Prüfung fehlgeschlagen');
  }catch(err){
    console.error('FEHLER: '+err.message+' - setze zurück ...');
    removeInstall();
    if(backup){
      if(fs.existsSync(backup+'/conf'))fs.cpSync(backup+'/conf',CONF_DIR,{recursive:true});
      if(fs.existsSync(backup+'/unit')){fs.copyFileSync(backup+'/unit',UNIT_FILE);
        sh('systemctl','daemon-reload');sh('systemctl','enable','--now',UNIT);}
      console.error('Vorherige Installation wiederhergestellt.');
    }else console.error('Neuinstallation entfernt.');
    process.exitCode=1;return;
  }
  console.log('\nFertig: authentifizierter Mosquitto auf TCP '+PORT+' (Unit '+UNIT+').');
  console.log('Die RC (SKYHUB_PILOT_MQTT_URL ...:'+PORT+') kann sich jetzt anmelden. SkyHub-Backend und .env sind noch unverändert.');
  console.log('Nächste Schritte (nicht automatisiert):');
  console.log('  1. In .env: SKYHUB_MQTT_BROKER_KIND=mosquitto-dedicated, SKYHUB_MQTT_REQUIRED_PORT='+PORT+',');
  console.log('     MQTT_BROKER_URL=mqtt://host.docker.internal:'+PORT+', SKYHUB_PILOT_MQTT_URL=mqtt://<Pi-LAN-IP>:'+PORT);
  console.log('  2. bash scripts/pi-preflight.sh --broker-kind mosquitto-dedicated --broker-port '+PORT);
  console.log('  3. bash scripts/pi-update-backend.sh --apply   (Backup/Preflight laufen dort vorher)');
  console.log('  4. Auf der RC "MQTT erneut verbinden", danach: sudo node scripts/pi-mosquitto-dedicated.js status');
}
if(require.main===module)main().catch(err=>{console.error('Abbruch: '+err.message);process.exitCode=1;});
module.exports={aclCases,aclText,DELIVERY_PUBLISH,PROBE_TOPIC};
