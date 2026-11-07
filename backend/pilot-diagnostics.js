'use strict';
// Diagnostics relay for the Pilot 2 web page (pilot-login.js). DJI Pilot 2 blocks WebView debugging (no devtools socket,
// no console in logcat; checked on the RC Plus 2 on 04.11.2026), so the page reports its own steps to the SkyHub log.
// Opt-in: SKYHUB_PILOT_DIAGNOSTICS_ENABLED=true. The page sends only short texts (bridge method + result code, own requests
// + HTTP status, JS errors); bridge arguments (license, MQTT password, tokens) are never sent. The server additionally
// redacts anything that looks like a secret, caps size and rate, and writes one log line per entry.
const LEVELS=new Set(['info','warn','error']);
const KINDS=new Set(['step','bridge','callback','fetch','js']);
const MAX_ENTRIES=40,MAX_TEXT=300;
const RATE={windowMs:60000,max:30};          // batches per client and minute

function redact(text){
  return String(text)
    .replace(/[\u0000-\u001f\u007f]+/g,' ')
    .replace(/\b(password|passwd|secret|token|license|licence|app_?key|authorization|bearer)\b\s*[:=]?\s*\S+/gi,'$1=<…>')
    .replace(/\b[0-9a-f]{24,}\b/gi,'<hex>')
    .replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g,'<geheim?>')
    .replace(/https?:\/\/[^\s?#]+\?[^\s]*/g,m=>m.split('?')[0]+'?<…>')
    .slice(0,MAX_TEXT);
}

function parseBatch(body){
  if(!body||typeof body!=='object'||!Array.isArray(body.entries)||body.entries.length>MAX_ENTRIES)return null;
  const out=[];
  for(const e of body.entries){
    if(!e||typeof e!=='object')return null;
    const level=LEVELS.has(e.level)?e.level:'info',kind=KINDS.has(e.kind)?e.kind:'step';
    const t=Number.isSafeInteger(e.t)&&e.t>1e12&&e.t<4e12?e.t:null;
    if(typeof e.msg!=='string'||!e.msg)continue;
    out.push({t,level,kind,msg:redact(e.msg)});
  }
  const page=typeof body.page==='string'?redact(body.page).slice(0,40):null;
  return {entries:out,page};
}

function createPilotDiagnostics({enabled=false,log=m=>console.log(m),now=()=>Date.now()}={}){
  const recent=new Map();
  function allow(key){
    const t=now(),list=(recent.get(key)||[]).filter(x=>t-x<RATE.windowMs);
    if(list.length>=RATE.max){recent.set(key,list);return false;}
    list.push(t);recent.set(key,list);
    if(recent.size>100)for(const [k,v] of recent)if(!v.some(x=>t-x<RATE.windowMs))recent.delete(k);
    return true;
  }
  // handler(req,res,{paired}) – the route decides HTTPS and pairing; unpaired clients share one stricter bucket.
  async function receive(req,res,{paired}){
    if(!enabled)return res.status(404).json({error:'Diagnostics disabled'});
    const key=paired?'paired:'+String(req.ip||'?'):'unpaired';
    if(!allow(key))return res.status(429).json({error:'Too many diagnostics'});
    const batch=parseBatch(req.body);
    if(!batch)return res.status(400).json({error:'Invalid diagnostics'});
    const who=(paired?'gekoppelt':'NICHT gekoppelt')+' '+String(req.ip||'?').slice(0,40);
    for(const e of batch.entries){
      const at=e.t?new Date(e.t).toISOString().slice(11,23):'--:--:--.---';
      log('[pilot diag] '+at+' '+who+' '+e.level+' '+e.kind+': '+e.msg);
    }
    res.json({ok:true,received:batch.entries.length});
  }
  return {enabled,receive};
}

module.exports={createPilotDiagnostics,parseBatch,redact};
