'use strict';
// PPK geotagging (dji-geotagger, geo-raypan, BSD-2-Clause) through the internal ppk service (docker/ppk/ppk_server.py).
// The browser uploads one ZIP (flights/<folder>/{*.MRK, *_PPKRAW.bin, photo headers}, base/<SAPOS RINEX obs + nav>);
// the backend streams it to the service without buffering, then relays status and the result CSV.
// Opt-in: SKYHUB_PPK_URL (internal http://ppk:8090) + SKYHUB_PPK_TOKEN (min. 32 characters).
const express=require('express');
const http=require('node:http');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createZipWriter}=require('./thermal-export');

const MAX_UPLOAD=3*1024**3;
const JOB=/^[0-9a-f]{24}$/;

function ppkConfig(env=process.env){
  if(!env.SKYHUB_PPK_URL)return {enabled:false};
  let u;try{u=new URL(env.SKYHUB_PPK_URL);}catch{return {enabled:false,issue:'SKYHUB_PPK_URL ist keine URL'};}
  if(u.protocol!=='http:'||u.username||u.password||u.search||u.hash)return {enabled:false,issue:'SKYHUB_PPK_URL: internes http:// ohne Zugangsdaten'};
  const token=env.SKYHUB_PPK_TOKEN||'';
  if(token.length<32||/\s/.test(token))return {enabled:false,issue:'SKYHUB_PPK_TOKEN (min. 32 Zeichen) fehlt'};
  return {enabled:true,url:u,token};
}

function validParams(raw){
  let p;try{p=JSON.parse(raw||'');}catch{return null;}
  const b=p&&p.base;
  if(!b||!['header','manual'].includes(b.mode))return null;
  const n=(v,lo,hi)=>v===undefined||v===null||v===''||(Number.isFinite(Number(v))&&Number(v)>=lo&&Number(v)<=hi);
  if(!n(b.sigma_e,0.001,1)||!n(b.sigma_n,0.001,1)||!n(b.sigma_u,0.001,1))return null;
  if(b.mode==='manual'&&(!n(b.lat,-90,90)||!n(b.lon,-180,180)||!n(b.height,-500,9000)||[b.lat,b.lon,b.height].some(v=>v===undefined||v==='')))return null;
  const clean={mode:b.mode};
  for(const k of ['lat','lon','height','sigma_e','sigma_n','sigma_u'])if(b[k]!==undefined&&b[k]!=='')clean[k]=Number(b[k]);
  if(typeof b.frame==='string'&&/^[\w ().,+-]{1,40}$/.test(b.frame))clean.frame=b.frame;
  if(typeof b.epoch==='string'&&/^\d{4}(\.\d{1,4})?$/.test(b.epoch))clean.epoch=b.epoch;
  return JSON.stringify({base:clean});
}

function createPpkRouter(config,{log=console,flights=null,tmpDir=path.join(os.tmpdir(),'skyhub-ppk')}={}){
  const router=express.Router();
  const preparing=new Map(); // job id -> {state:'packing'|'sending'|'failed', done, total, error}
  const call=(method,path,{headers={},body=null}={})=>new Promise((resolve,reject)=>{
    const req=http.request({host:config.url.hostname,port:config.url.port||80,path,method,timeout:30000,
      headers:{Authorization:'Bearer '+config.token,...headers}},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
    });
    req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('timeout')));
    if(body)req.end(body);else req.end();
  });
  const relay=(res,r)=>{
    res.status(r.status).set({'Content-Type':r.headers['content-type']||'application/json','Cache-Control':'no-store'}).send(r.body);
  };
  router.post('/jobs',(req,res)=>{
    const length=Number(req.get('Content-Length'));
    if(!Number.isSafeInteger(length)||length<22||length>MAX_UPLOAD)return res.status(413).json({error:'ZIP fehlt oder größer als 3 GiB'});
    if(!/^application\/(zip|octet-stream)\b/.test(req.get('Content-Type')||''))return res.status(415).json({error:'ZIP erwartet'});
    const params=validParams(req.get('X-PPK-Params'));
    if(!params)return res.status(400).json({error:'Parameter der Basisstation ungültig'});
    const id=crypto.randomBytes(12).toString('hex');
    // Stream the body straight through; the service checks size, layout and paths again.
    const up=http.request({host:config.url.hostname,port:config.url.port||80,path:'/jobs?id='+id,method:'POST',
      headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/zip','Content-Length':String(length),'X-PPK-Params':params}},r=>{
      const chunks=[];r.on('data',c=>chunks.push(c));
      r.on('end',()=>{res.status(r.statusCode).set('Cache-Control','no-store').type('application/json').send(Buffer.concat(chunks));
        log.log('[ppk] job '+id+' upload '+r.statusCode+' ('+Math.round(length/1048576)+' MiB)');});
    });
    up.on('error',err=>{log.error('[ppk] upload:',err.code||err.message);if(!res.headersSent)res.status(503).json({error:'PPK-Dienst nicht erreichbar'});});
    req.on('aborted',()=>up.destroy());
    req.pipe(up);
  });
  // --- flights already in MinIO: only the SAPOS files come from the browser -----------------------------------------
  if(flights){
    router.get('/flights',async(_req,res)=>{
      try{res.set('Cache-Control','no-store').json({flights:await flights.list()});}
      catch(err){log.error('[ppk] flights:',err.message);res.status(502).json({error:'Speicher nicht lesbar'});}
    });
    router.post('/jobs/storage',async(req,res)=>{
      const length=Number(req.get('Content-Length'));
      if(!Number.isSafeInteger(length)||length<22||length>MAX_UPLOAD)return res.status(413).json({error:'ZIP fehlt oder größer als 3 GiB'});
      if(!/^application\/(zip|octet-stream)\b/.test(req.get('Content-Type')||''))return res.status(415).json({error:'ZIP erwartet'});
      const params=validParams(req.get('X-PPK-Params'));
      if(!params)return res.status(400).json({error:'Parameter der Basisstation ungültig'});
      let ids;try{ids=JSON.parse(req.get('X-PPK-Flights')||'');}catch{ids=null;}
      let selected;
      try{selected=await flights.resolve(ids);}
      catch(err){req.resume();return res.status(err.status||502).json({error:err.status?err.message:'Speicher nicht lesbar'});}
      const id=crypto.randomBytes(12).toString('hex');
      // Part 1: SAPOS ZIP from the browser, streamed; the service holds the job until part 2 arrives.
      const up=http.request({host:config.url.hostname,port:config.url.port||80,path:'/jobs?id='+id+'&part=base',method:'POST',
        headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/zip','Content-Length':String(length),'X-PPK-Params':params}},r=>{
        const chunks=[];r.on('data',c=>chunks.push(c));
        r.on('end',()=>{
          res.status(r.statusCode).set('Cache-Control','no-store').type('application/json').send(Buffer.concat(chunks));
          if(r.statusCode!==202)return;
          log.log('[ppk] job '+id+' from storage: '+selected.map(f=>f.name).join(', '));
          packAndSend(id,selected).catch(err=>{
            preparing.set(id,{...preparing.get(id),state:'failed',error:String(err.message||err).slice(0,200)});
            log.error('[ppk] job '+id+' flights:',err.message);
            call('DELETE','/jobs/'+id).catch(()=>{});
          });
        });
      });
      up.on('error',err=>{log.error('[ppk] upload:',err.code||err.message);if(!res.headersSent)res.status(503).json({error:'PPK-Dienst nicht erreichbar'});});
      req.on('aborted',()=>up.destroy());
      req.pipe(up);
    });
  }
  // Part 2: flights/ ZIP assembled from MinIO in a temp file, then posted to the waiting job.
  async function packAndSend(id,selected){
    const entry={state:'packing',done:0,total:0,cancel:false};preparing.set(id,entry);
    fs.mkdirSync(tmpDir,{recursive:true,mode:0o700});
    const file=path.join(tmpDir,id+'.zip');
    try{
      const zip=createZipWriter(file);
      let skipped;
      try{({skipped}=await flights.pack(selected,zip,{onStep:(d,t)=>{entry.done=d;entry.total=t;},cancelled:()=>entry.cancel}));}
      finally{try{zip.close();}catch{}}
      entry.state='sending';entry.skipped=skipped;
      const size=fs.statSync(file).size;
      const r=await new Promise((resolve,reject)=>{
        const rq=http.request({host:config.url.hostname,port:config.url.port||80,path:'/jobs?id='+id+'&part=flights',method:'POST',
          headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/zip','Content-Length':String(size)}},rs=>{
          const chunks=[];rs.on('data',c=>chunks.push(c));rs.on('end',()=>resolve({status:rs.statusCode,body:Buffer.concat(chunks)}));
        });
        rq.on('error',reject);
        fs.createReadStream(file).on('error',reject).pipe(rq);
      });
      if(r.status!==202){let m='';try{m=JSON.parse(r.body).error;}catch{}throw new Error(m||'PPK-Dienst HTTP '+r.status);}
      preparing.delete(id);
    }finally{fs.rm(file,{force:true},()=>{});}
  }
  router.get('/jobs/:id',async(req,res)=>{
    if(!JOB.test(req.params.id))return res.status(400).json({error:'ungültig'});
    try{
      const r=await call('GET','/jobs/'+req.params.id);
      const prep=preparing.get(req.params.id);
      if(prep&&r.status===200){
        // Overlay the backend's packing progress (or failure) on the waiting job.
        const s=JSON.parse(r.body.toString('utf8'));
        if(prep.state==='failed')Object.assign(s,{state:'failed',message:'Flugdaten aus dem Speicher: '+prep.error});
        else if(s.state==='staged'||s.state==='receiving')Object.assign(s,{state:'preparing',
          message:prep.state==='packing'?'Flugdaten aus dem Speicher: '+prep.done+' / '+prep.total:'Flugdaten werden übergeben',
          fraction:prep.total?prep.done/prep.total*0.2:0});
        return res.status(200).set('Cache-Control','no-store').json(s);
      }
      relay(res,r);
    }catch{res.status(503).json({error:'PPK-Dienst nicht erreichbar'});}
  });
  router.get('/jobs/:id/result.csv',async(req,res)=>{
    if(!JOB.test(req.params.id))return res.status(400).json({error:'ungültig'});
    try{
      const r=await call('GET','/jobs/'+req.params.id+'/result.csv');
      if(r.status===200)res.set('Content-Disposition','attachment; filename="skyhub-ppk-'+req.params.id.slice(0,8)+'.csv"');
      relay(res,r);
    }catch{res.status(503).json({error:'PPK-Dienst nicht erreichbar'});}
  });
  router.delete('/jobs/:id',async(req,res)=>{
    if(!JOB.test(req.params.id))return res.status(400).json({error:'ungültig'});
    const prep=preparing.get(req.params.id);if(prep)prep.cancel=true;
    try{relay(res,await call('DELETE','/jobs/'+req.params.id));}catch{res.status(503).json({error:'PPK-Dienst nicht erreichbar'});}
  });
  router.get('/health',async(_req,res)=>{
    try{relay(res,await call('GET','/health'));}catch{res.status(503).json({status:'unreachable'});}
  });
  return router;
}

module.exports={ppkConfig,createPpkRouter,validParams};
