'use strict';

// Explicit opt-in, local/offline encrypted recovery store for ONE synthetic
// flighttask observation. No runtime wiring, MQTT, commands, keys on disk or timers.
// Designed to be used only in a trusted, pre-created mode-0700 directory.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {
  SCHEMA,advanceFlighttaskObservation,summarizeFlighttaskObservation
}=require('./dji-flighttask-observation');
const {
  observeFlighttaskServiceReply,observeFlighttaskProgressEvent
}=require('./dji-flighttask-reply-adapter');

const STORE_SCHEMA='skyhub-flighttask-recovery-v1';
const FILE='flighttask-observation.enc.json';
const LOCK='.flighttask-observation.lock';
const MAX_ON_DISK=16384;
const MAX_PLAINTEXT=8192;
const ID=/^[A-Za-z0-9_.-]{1,100}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHASES=new Set([
  'awaiting_reply','reply_accepted','reply_rejected',
  'reported_sent','reported_in_progress','reported_paused','reported_ok',
  'reported_failed','reported_canceled','conflicting_reports','expired_unverified'
]);
const PROGRESS=new Set(['sent','in_progress','paused','ok','failed','canceled']);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const integer=x=>Number.isSafeInteger(x);
const keys=(x,required)=>object(x)&&Object.keys(x).length===required.length&&
  required.every(k=>Object.hasOwn(x,k));
function invalid(){throw new Error('Invalid encrypted flighttask recovery snapshot');}
function validState(s){
  if(!keys(s,['schema','request','phase','reply','progress','flightReady','hardwareVerified'])||
     s.schema!==SCHEMA||!PHASES.has(s.phase)||s.flightReady!==false||
     s.hardwareVerified!==false)invalid();
  const r=s.request,p=s.progress,a=s.reply;
  if(!keys(r,['gatewaySn','tid','bid','method','flightId','sentAt','expiresAt'])||
     !ID.test(r.gatewaySn)||!UUID.test(r.tid)||!UUID.test(r.bid)||
     !ID.test(r.flightId)||r.method!=='flighttask_execute'||
     !integer(r.sentAt)||r.sentAt<1e12||
     !integer(r.expiresAt)||r.expiresAt-r.sentAt<1000||
     r.expiresAt-r.sentAt>3600000)invalid();
  if(!keys(a,['result','timestamp'])||!keys(p,['status','result','timestamp']))
    invalid();
  if((a.result!==null&&(!integer(a.result)||a.result<-2147483648||a.result>2147483647))||
     (a.timestamp!==null&&!integer(a.timestamp))||
     ((a.result===null)!==(a.timestamp===null)))invalid();
  if(p.status!==null&&!PROGRESS.has(p.status))invalid();
  if((p.result!==null&&(!integer(p.result)||p.result<-2147483648||p.result>2147483647))||
     (p.timestamp!==null&&!integer(p.timestamp))||
     ((p.status===null)!==(p.timestamp===null))||
     ((p.status===null)!==(p.result===null)))invalid();
  if(s.phase==='awaiting_reply'&&(a.result!==null||p.status!==null))invalid();
  if(s.phase==='reply_accepted'&&(a.result!==0||p.status!==null))invalid();
  if(s.phase==='reply_rejected'&&(a.result===null||a.result===0||p.status!==null))invalid();
  if(s.phase.startsWith('reported_')&&(a.result!==0||p.status===null))invalid();
  if(p.status!==null&&a.result!==0)invalid();
  return s;
}
function ensureDirectory(directory){
  if(typeof directory!=='string'||!path.isAbsolute(directory))throw new Error('Recovery directory must be absolute');
  const s=fs.lstatSync(directory);
  // No automatic mkdir/chmod. Refuse shared dirs and direct symlinks.
  if(!s.isDirectory()||(s.mode&0o777)!==0o700||
    (typeof process.getuid==='function'&&s.uid!==process.getuid()))
    throw new Error('Recovery directory must be owned and mode 0700');
  return directory;
}
function filePath(dir){return path.join(dir,FILE);}
function safeBase64(text,size){
  if(typeof text!=='string'||text.length>MAX_ON_DISK||
     !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text))invalid();
  const b=Buffer.from(text,'base64');
  if(b.length!==size&&size!==null)invalid();
  return b;
}
function readSnapshot(dir,key){
  const name=filePath(dir);
  let fd;
  try{fd=fs.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
  let content;
  try{
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.size<=0||stat.size>MAX_ON_DISK||
       (stat.mode&0o077)!==0)invalid();
    content=fs.readFileSync(fd,'utf8');
  }finally{fs.closeSync(fd);}
  let payload;
  try{payload=JSON.parse(content);}catch(_error){invalid();}
  if(!keys(payload,['schema','version','iv','tag','ciphertext'])||
     payload.schema!==STORE_SCHEMA||payload.version!==1)invalid();
  const iv=safeBase64(payload.iv,12),tag=safeBase64(payload.tag,16);
  const encrypted=safeBase64(payload.ciphertext,null);
  if(encrypted.length<16||encrypted.length>MAX_PLAINTEXT)invalid();
  let clear;
  try{
    const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);
    decipher.setAAD(Buffer.from(STORE_SCHEMA,'utf8'));
    decipher.setAuthTag(tag);
    clear=Buffer.concat([decipher.update(encrypted),decipher.final()]);
  }catch(_error){invalid();}
  if(clear.length>MAX_PLAINTEXT)invalid();
  let record;
  try{record=JSON.parse(clear.toString('utf8'));}catch(_error){invalid();}
  if(!keys(record,['schema','revision','state'])||
     record.schema!==STORE_SCHEMA||!integer(record.revision)||
     record.revision<0||record.revision>Number.MAX_SAFE_INTEGER-1)invalid();
  validState(record.state);
  return record;
}
function writeSnapshot(dir,key,record){
  const plain=Buffer.from(JSON.stringify(record),'utf8');
  if(plain.length>MAX_PLAINTEXT)invalid();
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(STORE_SCHEMA,'utf8'));
  const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
  const payload=Buffer.from(JSON.stringify({
    schema:STORE_SCHEMA,version:1,iv:iv.toString('base64'),
    tag:cipher.getAuthTag().toString('base64'),
    ciphertext:encrypted.toString('base64')
  })+'\n');
  if(payload.length>MAX_ON_DISK)invalid();
  const temporary=path.join(dir,'.flighttask-'+crypto.randomBytes(12).toString('hex')+'.tmp');
  let fd;
  try{
    fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|
      fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    fs.writeFileSync(fd,payload);
    fs.fsyncSync(fd);
    fs.closeSync(fd);fd=undefined;
    fs.renameSync(temporary,filePath(dir));
    const directoryFd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|
      fs.constants.O_NOFOLLOW);
    try{fs.fsyncSync(directoryFd);}finally{fs.closeSync(directoryFd);}
  }finally{
    if(fd!==undefined)fs.closeSync(fd);
    try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
}
function locked(dir,action){
  const lock=path.join(dir,LOCK);
  let fd;
  try{fd=fs.openSync(lock,fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);}
  catch(error){
    if(error.code==='EEXIST')throw new Error('Flighttask recovery store locked; operator inspection required');
    throw error;
  }
  try{return action();}finally{
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
function publicResult(record,{applied=false,reason='no-change'}={}){
  return Object.freeze({
    schema:STORE_SCHEMA,revision:record.revision,applied,reason,
    summary:summarizeFlighttaskObservation(record.state)
  });
}
function createOfflineFlighttaskRecoveryStore({directory,key}={}){
  const dir=ensureDirectory(directory);
  if(!Buffer.isBuffer(key)||key.length!==32)
    throw new Error('A caller-supplied 32-byte encryption key is required');
  const secret=Buffer.from(key);
  const load=()=>{
    ensureDirectory(dir);
    const record=readSnapshot(dir,secret);
    if(!record)throw new Error('Flighttask recovery not initialized');
    return record;
  };
  const commit=(operation)=>{
    ensureDirectory(dir);
    return locked(dir,()=>{
      const existing=load();
      const answer=operation(existing.state);
      if(!answer||!object(answer.state)||typeof answer.applied!=='boolean'||
         typeof answer.reason!=='string')throw new Error('Invalid flighttask transition');
      if(!answer.applied)return publicResult(existing,answer);
      validState(answer.state);
      const record={schema:STORE_SCHEMA,revision:existing.revision+1,state:answer.state};
      writeSnapshot(dir,secret,record);
      return publicResult(record,answer);
    });
  };
  return Object.freeze({
    initialize(state){
      validState(state);
      return locked(dir,()=>{
        if(fs.existsSync(filePath(dir)))throw new Error('Flighttask recovery already initialized');
        const record={schema:STORE_SCHEMA,revision:0,state};
        writeSnapshot(dir,secret,record);
        return publicResult(record,{applied:true,reason:'initialized'});
      });
    },
    inspect(){return publicResult(load());},
    // Replay is never emitted. On recovery, elapsed observation TTL is
    // materialized durably; no inferred "flight failed" or command retry.
    recover({now=Date.now()}={}){
      return commit(state=>advanceFlighttaskObservation(state,{kind:'clock'},{now}));
    },
    observeServiceReply(topic,payload,options={}){
      return commit(state=>observeFlighttaskServiceReply(state,topic,payload,options));
    },
    observeProgressEvent(topic,payload,options={}){
      return commit(state=>observeFlighttaskProgressEvent(state,topic,payload,options));
    }
  });
}
module.exports={createOfflineFlighttaskRecoveryStore,STORE_SCHEMA};
