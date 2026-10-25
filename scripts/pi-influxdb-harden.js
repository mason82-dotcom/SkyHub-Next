#!/usr/bin/env node
'use strict';
// Hardening of the HOST InfluxDB 1.x (systemd unit "influxdb"), which is not part of SkyHub Next.
// It listens on every interface and answers queries without credentials.
//   node scripts/pi-influxdb-harden.js plan                          what would change (read-only)
//   node scripts/pi-influxdb-harden.js clients [seconds]             who connects to InfluxDB (read-only)
//   node scripts/pi-influxdb-harden.js status                        current effective state (read-only)
//   sudo node scripts/pi-influxdb-harden.js apply --auth [--bind HOST:PORT] [--admin-user NAME]
//   sudo node scripts/pi-influxdb-harden.js apply --bind HOST:PORT   (without --auth: network limit only)
//   sudo node scripts/pi-influxdb-harden.js verify                   re-check the applied state
//   sudo node scripts/pi-influxdb-harden.js rollback [--drop-user]   remove the drop-in, restart, verify
// The change is ONE systemd drop-in (Environment=INFLUXDB_HTTP_*), which InfluxDB lets override
// /etc/influxdb/influxdb.conf. The config file itself is never read or edited, rollback is deleting
// the drop-in. The admin password goes into a root-only file and is never printed.
const fs=require('node:fs');
const os=require('node:os');
const net=require('node:net');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');

const UNIT='influxdb';
const DROPIN_DIR='/etc/systemd/system/'+UNIT+'.service.d';
const DROPIN=DROPIN_DIR+'/skyhub-harden.conf';
const CRED_FILE='/etc/influxdb/skyhub-admin.cred';
const BACKUP_ROOT='/var/backups';
const DEFAULT_BASE=process.env.SKYHUB_INFLUX_URL||'http://127.0.0.1:8086';
const DEFAULT_ADMIN='skyhub_admin';
const MARKER='# SkyHub Next - managed by scripts/pi-influxdb-harden.js';

const sh=(cmd,...args)=>execFileSync(cmd,args,{encoding:'utf8'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');

function validateBind(value){
  const m=/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})$/.exec(value||'');
  const ok=m&&m[1].split('.').every(n=>Number(n)<=255)&&Number(m[2])>=1&&Number(m[2])<=65535;
  if(!ok)throw new Error('--bind erwartet IPv4:Port, z. B. 127.0.0.1:8086');
  return {host:m[1],port:Number(m[2])};
}
function parseArgs(argv){
  const [command,...rest]=argv;
  const opts={command,auth:false,bind:null,adminUser:DEFAULT_ADMIN,dropUser:false,seconds:60};
  for(let i=0;i<rest.length;i++){
    const arg=rest[i];
    if(arg==='--auth')opts.auth=true;
    else if(arg==='--drop-user')opts.dropUser=true;
    else if(arg==='--bind'){opts.bind=validateBind(rest[++i]);}
    else if(arg==='--admin-user'){
      opts.adminUser=rest[++i]||'';
      if(!/^[A-Za-z0-9_.-]{1,64}$/.test(opts.adminUser))throw new Error('--admin-user: ungültiger Name');
    }else if(command==='clients'&&/^\d+$/.test(arg)){
      opts.seconds=Math.min(600,Math.max(5,Number(arg)));
    }else throw new Error('Unbekanntes Argument: '+arg);
  }
  if(command==='apply'&&!opts.auth&&!opts.bind)throw new Error('apply braucht --auth und/oder --bind HOST:PORT');
  return opts;
}
function dropInText({auth,bind}){
  const lines=[MARKER,'[Service]'];
  if(auth)lines.push('Environment="INFLUXDB_HTTP_AUTH_ENABLED=true"');
  if(bind)lines.push('Environment="INFLUXDB_HTTP_BIND_ADDRESS='+bind.host+':'+bind.port+'"');
  return lines.join('\n')+'\n';
}
function parseDropIn(text){
  const get=key=>{const m=new RegExp('INFLUXDB_HTTP_'+key+'=([^"\\s]+)').exec(text);return m?m[1]:null;};
  const bind=get('BIND_ADDRESS');
  return {auth:get('AUTH_ENABLED')==='true',bind:bind?validateBind(bind):null};
}
function classifyPeer(ip){
  if(ip==='127.0.0.1'||ip==='::1'||ip==='::ffff:127.0.0.1')return 'lokal';
  const m=/^(?:::ffff:)?(\d+)\.(\d+)\./.exec(ip);
  if(m&&Number(m[1])===172&&Number(m[2])>=16&&Number(m[2])<=31)return 'docker';
  if(m&&(Number(m[1])===10||(Number(m[1])===192&&Number(m[2])===168)))return 'LAN';
  if(m&&Number(m[1])===100&&Number(m[2])>=64&&Number(m[2])<=127)return 'tailscale';
  return 'andere';
}

async function influx(base,{path='/query',method='GET',query,form,user,password}={}){
  const url=new URL(path,base);
  if(query)url.searchParams.set('q',query);
  const headers={};
  if(user)headers.Authorization='Basic '+Buffer.from(user+':'+password).toString('base64');
  let body;
  if(form){body=new URLSearchParams(form);headers['Content-Type']='application/x-www-form-urlencoded';}
  const res=await fetch(url,{method,headers,body,signal:AbortSignal.timeout(5000)});
  const text=await res.text();
  let json=null;try{json=JSON.parse(text);}catch(_){}
  return {status:res.status,json};
}
const ping=async base=>{try{return (await influx(base,{path:'/ping'})).status;}catch(_){return 0;}};
const tcpOpen=(host,port,timeout=2500)=>new Promise(resolve=>{
  const socket=net.connect({host,port,timeout});
  socket.once('connect',()=>{socket.destroy();resolve(true);});
  socket.once('timeout',()=>{socket.destroy();resolve(false);});
  socket.once('error',()=>resolve(false));
});
async function waitForPing(base,seconds=30){
  for(let i=0;i<seconds*2;i++){if(await ping(base)===204)return true;await sleep(500);}
  return false;
}
const lanAddresses=()=>Object.values(os.networkInterfaces()).flat()
  .filter(a=>a&&a.family==='IPv4'&&!a.internal).map(a=>a.address);

function readCred(file=CRED_FILE){
  if(!fs.existsSync(file))return null;
  const m=/^user=(.+)\npassword=(.+)\n?$/.exec(fs.readFileSync(file,'utf8'));
  return m?{user:m[1],password:m[2]}:null;
}
// Creates the admin while auth is still off; the credential file is written before the user exists.
async function ensureAdmin({base,user,credFile=CRED_FILE}){
  const existing=readCred(credFile);
  const list=await influx(base,{query:'SHOW USERS'});
  if(list.status===401){
    if(!existing)throw new Error('Auth ist bereits aktiv und '+credFile+' fehlt: nichts geändert');
    const check=await influx(base,{query:'SHOW USERS',user:existing.user,password:existing.password});
    if(check.status!==200)throw new Error('Auth ist aktiv, die gespeicherten Zugangsdaten werden abgelehnt');
    return {created:false,cred:existing};
  }
  const names=(list.json?.results?.[0]?.series?.[0]?.values||[]).map(row=>row[0]);
  if(names.includes(user)){
    if(!existing||existing.user!==user)throw new Error('Benutzer '+user+' existiert, aber '+credFile+' passt nicht: --admin-user wählen');
    return {created:false,cred:existing};
  }
  const cred={user,password:crypto.randomBytes(24).toString('base64url')};
  fs.mkdirSync(path.dirname(credFile),{recursive:true});
  fs.writeFileSync(credFile,'user='+cred.user+'\npassword='+cred.password+'\n',{mode:0o600});
  fs.chmodSync(credFile,0o600);
  const created=await influx(base,{method:'POST',form:{q:'CREATE USER "'+user+'" WITH PASSWORD \''+cred.password+'\' WITH ALL PRIVILEGES'}});
  if(created.status!==200||created.json?.results?.[0]?.error){
    fs.rmSync(credFile,{force:true});
    throw new Error('Admin anlegen fehlgeschlagen (HTTP '+created.status+')');
  }
  return {created:true,cred};
}

function systemd(...args){return sh('systemctl',...args);}
function requireRoot(){
  if(process.getuid()!==0)throw new Error('Dieser Schritt braucht root: sudo node scripts/pi-influxdb-harden.js '+process.argv.slice(2).join(' '));
}
const baseFor=bind=>bind?'http://'+bind.host+':'+bind.port:DEFAULT_BASE;

// Checks the applied state: returns [{name,pass,value}].
async function verifyState({auth,bind},cred){
  const base=baseFor(bind);
  const checks=[];
  const add=(name,pass,value)=>checks.push({name,pass,value:String(value)});
  const pong=await ping(base);
  add('Dienst antwortet auf /ping (204)',pong===204,pong);
  if(auth){
    const anon=await influx(base,{query:'SHOW DATABASES'}).catch(()=>({status:0}));
    add('Abfrage ohne Anmeldung wird abgelehnt (401)',anon.status===401,anon.status);
    const bad=await influx(base,{query:'SHOW DATABASES',user:cred?.user||'x',password:'falsch-'+'x'.repeat(12)}).catch(()=>({status:0}));
    add('Falsches Passwort wird abgelehnt (401)',bad.status===401,bad.status);
    const good=cred?await influx(base,{query:'SHOW DATABASES',user:cred.user,password:cred.password}).catch(()=>({status:0})):{status:'keine Zugangsdaten'};
    add('Admin-Anmeldung funktioniert (200)',good.status===200,good.status);
  }
  if(bind&&['127.0.0.1'].includes(bind.host)){
    for(const ip of lanAddresses()){
      const open=await tcpOpen(ip,bind.port);
      add('Von außen nicht erreichbar: '+ip+':'+bind.port,!open,open?'OFFEN':'zu');
    }
  }
  return checks;
}
function printChecks(checks){
  for(const c of checks)console.log((c.pass?'  ok   ':'  FEHL ')+c.name.padEnd(52)+c.value);
  return checks.every(c=>c.pass);
}

function removeDropIn(){
  fs.rmSync(DROPIN,{force:true});
  try{fs.rmdirSync(DROPIN_DIR);}catch(_){} // only removed when empty
  systemd('daemon-reload');
}
async function restartAndWait(base){
  systemd('restart',UNIT);
  return waitForPing(base);
}
function readApplied(){
  return fs.existsSync(DROPIN)?parseDropIn(fs.readFileSync(DROPIN,'utf8')):null;
}

async function status(){
  const active=(()=>{try{return systemd('is-active',UNIT).trim();}catch(_){return 'inactive';}})();
  const applied=readApplied();
  console.log('Dienst '+UNIT+': '+active);
  console.log('SkyHub-Drop-in: '+(applied?'vorhanden, Auth '+(applied.auth?'an':'aus')+', Bind '+(applied.bind?applied.bind.host+':'+applied.bind.port:'unverändert (Config-Datei)'):'nicht vorhanden'));
  const base=baseFor(applied?.bind);
  console.log('/ping '+base+': HTTP '+await ping(base));
  const anon=await influx(base,{query:'SHOW DATABASES'}).catch(()=>({status:0}));
  console.log('Abfrage ohne Anmeldung: HTTP '+anon.status+(anon.status===200?'  (OFFEN: jeder im Netz darf lesen und schreiben)':anon.status===401?'  (Anmeldung erforderlich)':''));
  console.log('Admin-Zugangsdaten: '+(fs.existsSync(CRED_FILE)?CRED_FILE+' (nur root)':'keine'));
  console.log('Hört auf: '+sh('ss','-ltnH').split('\n').filter(l=>/:(8086)\s/.test(l)).map(l=>l.trim().split(/\s+/)[3]).join(', '));
}
async function clients(seconds){
  console.log('Beobachte '+seconds+' s Verbindungen zu Port 8086 (nur Adressen, keine Daten) ...');
  const seen=new Map();
  const end=Date.now()+seconds*1000;
  while(Date.now()<end){
    for(const line of sh('ss','-tnH','state','established','( sport = :8086 )').split('\n')){
      const peer=line.trim().split(/\s+/)[3];
      if(!peer)continue;
      const ip=peer.replace(/:\d+$/,'').replace(/^\[|\]$/g,'');
      seen.set(ip,(seen.get(ip)||0)+1);
    }
    await sleep(2000);
  }
  if(!seen.size)console.log('Keine aktiven Verbindungen beobachtet (Clients, die nur kurz verbinden, können durchrutschen).');
  for(const [ip,n] of [...seen].sort((a,b)=>b[1]-a[1]))console.log('  '+ip.padEnd(40)+classifyPeer(ip).padEnd(10)+n+' Messungen');
  console.log('Hinweis: Docker-Adressen (172.16-31.x) sind Container, die über die Bridge zugreifen.');
  console.log('Wer hier steht, braucht nach "--auth" Zugangsdaten und nach "--bind 127.0.0.1:8086" einen anderen Weg.');
}
function plan(opts){
  console.log('Geplante Änderung (nur ein systemd-Drop-in, die Config-Datei bleibt unberührt):');
  console.log('--- '+DROPIN+' ---\n'+dropInText({auth:opts.auth||!opts.bind,bind:opts.bind}));
  console.log('Danach: daemon-reload und "systemctl restart '+UNIT+'" (kurze Unterbrechung, Clients mit Retry holen auf).');
  console.log('--auth   legt Admin "'+opts.adminUser+'" an (Passwort in '+CRED_FILE+', root-only) und verlangt Anmeldung.');
  console.log('--bind   begrenzt die Schnittstelle, z. B. 127.0.0.1:8086 (Container und andere Geräte verlieren den Zugriff!).');
  console.log('Rollback: sudo node scripts/pi-influxdb-harden.js rollback   (löscht das Drop-in; --drop-user entfernt auch den Admin)');
}

async function apply(opts){
  requireRoot();
  const wanted={auth:opts.auth,bind:opts.bind};
  const base=baseFor(opts.bind);
  const currentBase=baseFor(readApplied()?.bind);
  if(await ping(currentBase)!==204)throw new Error('InfluxDB antwortet nicht auf '+currentBase+'/ping: nichts geändert');
  let cred=null;
  console.log('1/4 Vorbedingungen');
  if(opts.auth){
    const result=await ensureAdmin({base:currentBase,user:opts.adminUser});
    cred=result.cred;
    console.log('    Admin "'+cred.user+'": '+(result.created?'angelegt':'vorhanden')+' (Zugangsdaten in '+CRED_FILE+')');
  }
  let backup=null;
  if(fs.existsSync(DROPIN)){
    backup=BACKUP_ROOT+'/skyhub-influxdb-'+stamp();
    fs.mkdirSync(backup,{recursive:true,mode:0o700});
    fs.copyFileSync(DROPIN,backup+'/skyhub-harden.conf');
    console.log('2/4 Vorhandenes Drop-in gesichert: '+backup);
  }else console.log('2/4 Kein vorhandenes Drop-in, nichts zu sichern');
  try{
    console.log('3/4 Drop-in schreiben, systemd neu laden, InfluxDB neu starten');
    fs.mkdirSync(DROPIN_DIR,{recursive:true});
    fs.writeFileSync(DROPIN,dropInText(wanted),{mode:0o644});
    systemd('daemon-reload');
    if(!await restartAndWait(base))throw new Error('InfluxDB antwortet nach dem Neustart nicht auf '+base+'/ping');
    console.log('4/4 Wirkung prüfen');
    if(!printChecks(await verifyState(wanted,cred)))throw new Error('Prüfung fehlgeschlagen');
  }catch(err){
    console.error('FEHLER: '+err.message+' - setze zurück ...');
    if(backup)fs.copyFileSync(backup+'/skyhub-harden.conf',DROPIN);else removeDropIn();
    systemd('daemon-reload');
    const restored=await restartAndWait(baseFor(backup?parseDropIn(fs.readFileSync(DROPIN,'utf8')).bind:null));
    console.error(restored?'Vorheriger Zustand wiederhergestellt, InfluxDB antwortet.':'WARNUNG: InfluxDB antwortet nach dem Zurücksetzen nicht: systemctl status influxdb prüfen');
    process.exitCode=1;return;
  }
  console.log('\nFertig. Clients ohne Zugangsdaten werden jetzt abgelehnt'+(opts.bind?' bzw. erreichen den Dienst nicht mehr':'')+'.');
  console.log('Betroffene Clients (Home Assistant, Grafana, Telegraf ...) bekommen den Benutzer aus '+CRED_FILE+' - oder einen eigenen Benutzer mit eingeschränkten Rechten.');
  console.log('Rückgängig: sudo node scripts/pi-influxdb-harden.js rollback');
}
async function verify(){
  requireRoot();
  const applied=readApplied();
  if(!applied)throw new Error('Kein SkyHub-Drop-in vorhanden: nichts zu prüfen');
  process.exitCode=printChecks(await verifyState(applied,readCred()))?0:1;
}
async function rollback(opts){
  requireRoot();
  const applied=readApplied();
  removeDropIn();
  const ok=await restartAndWait(DEFAULT_BASE);
  console.log('Drop-in entfernt, InfluxDB neu gestartet: '+(ok?'antwortet wieder':'WARNUNG: keine Antwort, systemctl status influxdb prüfen'));
  if(opts.dropUser){
    const cred=readCred();
    if(!cred)console.log('Kein Admin aus diesem Skript bekannt, nichts zu löschen.');
    else{
      let res=await influx(DEFAULT_BASE,{method:'POST',form:{q:'DROP USER "'+cred.user+'"'}});
      if(res.status===401)res=await influx(DEFAULT_BASE,{method:'POST',form:{q:'DROP USER "'+cred.user+'"'},user:cred.user,password:cred.password});
      if(res.status===200){fs.rmSync(CRED_FILE,{force:true});console.log('Admin "'+cred.user+'" und '+CRED_FILE+' entfernt.');}
      else console.log('WARNUNG: Admin konnte nicht gelöscht werden (HTTP '+res.status+'), Zugangsdatei bleibt erhalten.');
    }
  }else if(fs.existsSync(CRED_FILE))console.log('Der Admin-Benutzer und '+CRED_FILE+' bleiben bestehen (--drop-user entfernt beides).');
  if(applied?.auth||applied?.bind){
    const anon=await influx(DEFAULT_BASE,{query:'SHOW DATABASES'}).catch(()=>({status:0}));
    console.log('Abfrage ohne Anmeldung: HTTP '+anon.status+(anon.status===200?' (wie vor der Härtung, offen)':''));
  }
}

async function main(){
  const opts=parseArgs(process.argv.slice(2));
  switch(opts.command){
    case 'plan':return plan(opts);
    case 'clients':return clients(opts.seconds);
    case 'status':return status();
    case 'apply':return apply(opts);
    case 'verify':return verify();
    case 'rollback':return rollback(opts);
    default:
      console.error('Verwendung: node scripts/pi-influxdb-harden.js plan|clients [s]|status|apply --auth [--bind H:P]|verify|rollback [--drop-user]');
      process.exitCode=2;
  }
}
if(require.main===module)main().catch(err=>{console.error('Abbruch: '+err.message);process.exitCode=1;});
module.exports={parseArgs,validateBind,dropInText,parseDropIn,classifyPeer,ensureAdmin,influx,verifyState,readCred};
