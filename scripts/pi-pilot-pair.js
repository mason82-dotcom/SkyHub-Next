#!/usr/bin/env node
'use strict';
// Approve or manage DJI Pilot 2 device pairings on the local SkyHub Next backend.
//   node scripts/pi-pilot-pair.js            list pending codes and paired devices
//   node scripts/pi-pilot-pair.js 123456     approve the code shown on the RC
//   node scripts/pi-pilot-pair.js --revoke <device-id>
// Reads SKYHUB_VIEW_TOKEN from the environment or ./.env; never prints it.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');

function envValue(name){
  if(process.env[name])return process.env[name];
  try{
    const text=fs.readFileSync(path.resolve(__dirname,'../.env'),'utf8');
    const line=text.split('\n').find(l=>l.startsWith(name+'='));
    return line?line.slice(name.length+1).trim():'';
  }catch(_){return '';}
}
const token=envValue('SKYHUB_VIEW_TOKEN');
const port=Number(envValue('SKYHUB_HTTP_PORT')||4001);
if(!token){console.error('SKYHUB_VIEW_TOKEN nicht gefunden (.env).');process.exit(2);}

function request(method,urlPath,body){
  return new Promise((resolve,reject)=>{
    const data=body?JSON.stringify(body):null;
    const req=http.request({hostname:'127.0.0.1',port,path:urlPath,method,timeout:5000,headers:{
      'Authorization':'Bearer '+token,
      ...(data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{})
    }},res=>{
      let text='';
      res.setEncoding('utf8');
      res.on('data',chunk=>{text+=chunk;});
      res.on('end',()=>{
        let json=null;
        try{json=JSON.parse(text);}catch(_){}
        resolve({status:res.statusCode,json});
      });
    });
    req.on('timeout',()=>req.destroy(new Error('Zeitüberschreitung')));
    req.on('error',reject);
    if(data)req.write(data);
    req.end();
  });
}
const time=value=>Number.isFinite(value)?new Date(value).toLocaleString('de-DE'):'nie';

async function main(){
  const [arg,extra]=process.argv.slice(2);
  if(arg==='--revoke'){
    const res=await request('DELETE','/api/pilot-admin/devices/'+encodeURIComponent(extra||''));
    console.log(res.status===200?'Gerät widerrufen.':'Widerruf fehlgeschlagen (HTTP '+res.status+').');
    process.exitCode=res.status===200?0:1;
    return;
  }
  if(arg){
    const code=arg.replace(/\s/g,'');
    if(!/^\d{6}$/.test(code)){console.error('Code muss sechsstellig sein.');process.exitCode=2;return;}
    const res=await request('POST','/api/pilot-admin/approve',{code});
    console.log(res.status===200?'Code bestätigt. Die RC verbindet sich in wenigen Sekunden.':
      'Kein offener Kopplungscode '+code+' (HTTP '+res.status+').');
    process.exitCode=res.status===200?0:1;
    return;
  }
  const res=await request('GET','/api/pilot-admin/pairings');
  if(res.status!==200 || !res.json){console.error('Abfrage fehlgeschlagen (HTTP '+res.status+').');process.exitCode=1;return;}
  console.log('Offene Kopplungscodes:');
  if(!res.json.pending.length)console.log('  keine');
  for(const p of res.json.pending)
    console.log('  '+p.code+'  '+p.model+'  gültig bis '+time(p.expiresAt)+(p.approved?'  (bestätigt)':''));
  console.log('Gekoppelte Geräte:');
  if(!res.json.devices.length)console.log('  keine');
  for(const d of res.json.devices)
    console.log('  '+d.id+'  '+d.model+'  gekoppelt '+time(d.createdAt)+'  zuletzt '+time(d.lastUsedAt)+
      // Paired before the workspace binding: the RC is asked to pair again; the old entry can then be revoked.
      (d.workspaceId?'':'  OHNE ARBEITSBEREICH: neu koppeln, danach --revoke '+d.id));
}
main().catch(()=>{console.error('Backend auf 127.0.0.1:'+port+' nicht erreichbar.');process.exitCode=1;});
