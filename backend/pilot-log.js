'use strict';
// DJI Pilot 2 log viewer (DJI Cloud API 1.18 feature-set/pilot-feature-set/pull-pilot-log):
//   JSBridge platformGetLogPath() → the Webview lets the pilot pick the log file and uploads it to SkyHub;
//   platformSetLogEncryptKey / platformClearLogEncryptKey: SkyHub sets NO own key, so logs use DJI's default key.
// Decryption re-implements DJI's PlogDecoder.jar (V1.1, sha256 a65564e8…, read 05.11.2026), line by line:
//   line = Base64(AES-128-CBC(text)), IV 2d8913091b2c491a93253e461d61f3ee,
//   key  = PBKDF2-HMAC-SHA1(password, salt 2b6c8ee4bc1a4ac48ffec65548759c8a, 1000 iterations, 128 bit),
//   password "DJILog@PLogEncryption" by default; a line "#$*&%!!^^&1:<Base64 RSA-PKCS#1 v1.5>" switches the password
//   (empty → default). Without the RSA private key such a switch is ignored (as in the jar) and later lines fail.
// Pilot 2 writes the platformLoadComponent parameters into this log in plain text (MQTT password, device token for api/ws;
// seen on the RC Plus 2 on 05.11.2026). The upload is therefore decoded and redacted on arrival (in a worker thread, the event
// loop keeps serving telemetry) and only the redacted text is kept (gzip, PostgreSQL pilot_logs, 30 days); the encrypted
// original is not stored. Rows from older versions (encrypted original, or redacted with older rules) are rewritten once at start.
// Consequence: lines after an RSA key switch stay unreadable for good. SkyHub never sets its own key (see above), so this only
// happens if someone else did - keeping the original instead would mean keeping the plaintext secrets.
const crypto=require('node:crypto');
const zlib=require('node:zlib');

const IV=Buffer.from('2d8913091b2c491a93253e461d61f3ee','hex');
const SALT=Buffer.from('2b6c8ee4bc1a4ac48ffec65548759c8a','hex');
const DEFAULT_PASSWORD='DJILog@PLogEncryption';
const KEY_PREFIX='#$*&%!!^^&1:';
const MAX_BYTES=32*1024*1024,KEEP_DAYS=30,NAME=/^[\w.\- ()]{1,120}$/;
const keyFor=password=>crypto.pbkdf2Sync(password,SALT,1000,16,'sha1');
// Version of the redaction rules below; stored rows with an older version are redacted again at start.
const REDACT_VERSION=2;
// Secret-looking key names: anything ending in password/token/secret/… (mqttPassword, deviceToken, x-auth-token, client_secret).
const KEY='[\\w.-]*?(?:password|passwd|pwd|token|secret|api_?key|credentials?)';
// JSON fields, also with Authorization and with stringified (escaped) JSON: {"password":"x"}, {\"password\":\"x\"}.
const SECRET_FIELD=new RegExp('("(?:'+KEY+'|authorization)"\\s*:\\s*")((?:[^"\\\\\\r\\n]|\\\\.)*)(")','gi');
const SECRET_FIELD_ESC=new RegExp('(\\\\+"(?:'+KEY+'|authorization)\\\\+"\\s*:\\s*\\\\+")((?:(?!\\\\+")[^\\r\\n])*)(\\\\+")','gi');
// Authorization header: the whole credential after an optional scheme (Bearer, Basic, Digest …) up to the end of the line
// (Digest parameters contain quotes, so the line end is the only safe boundary; over-redacting the rest of a line is fine).
const SECRET_HEADER=/\b(authorization\s*[:=]\s*(?:(?:bearer|basic|digest|token|negotiate|ntlm|hmac[\w-]*)\s+)?)([^\r\n]+)/gi;
// key=value / key: value in plain text, URL parameters (?token=, &password=) and headers like X-Auth-Token.
const SECRET_KV=new RegExp('\\b('+KEY+'\\s*[=:]\\s*)([^\\s,;&"\'}\\]]+)','gi');
const isRedacted=v=>/^\[geschwärzt/.test(v)||/^\*+$/.test(v);   // by us, or masked by DJI (****)
// Replaces secret values with [geschwärzt]; returns the text and the count. Idempotent.
function redactSecrets(text){
  let count=0;
  const mark=(m,a,v,b)=>{if(isRedacted(v))return m;count++;return a+'[geschwärzt]'+(typeof b==='string'?b:'');};
  const out=String(text).replace(SECRET_FIELD,mark).replace(SECRET_FIELD_ESC,mark).replace(SECRET_HEADER,mark).replace(SECRET_KV,mark);
  return {text:out,count};
}

function decodePlog(text,{privateKey=null}={}){
  let key=keyFor(DEFAULT_PASSWORD);
  const out=[];let failed=0;
  for(const raw of String(text).split(/\r?\n/)){
    const line=raw.trim();
    if(!line)continue;
    if(line.startsWith(KEY_PREFIX)){
      const rest=line.slice(KEY_PREFIX.length);
      if(!rest){key=keyFor(DEFAULT_PASSWORD);continue;}
      if(!privateKey){out.push({text:null,keyChange:true});continue;}
      try{key=keyFor(crypto.privateDecrypt({key:privateKey,padding:crypto.constants.RSA_PKCS1_PADDING},Buffer.from(rest,'base64')).toString('utf8'));}
      catch{out.push({text:null,keyChange:true});}
      continue;
    }
    try{
      const d=crypto.createDecipheriv('aes-128-cbc',key,IV);
      out.push({text:Buffer.concat([d.update(Buffer.from(line,'base64')),d.final()]).toString('utf8')});
    }catch{failed++;out.push({text:null});}
  }
  return {lines:out,failed};
}
// Counterpart for tests (and to check compatibility with DJI's jar): one encrypted line.
function encodeLine(text,password=DEFAULT_PASSWORD){
  const c=crypto.createCipheriv('aes-128-cbc',keyFor(password),IV);
  return Buffer.concat([c.update(Buffer.from(text,'utf8')),c.final()]).toString('base64');
}

const SCHEMA=`CREATE TABLE IF NOT EXISTS pilot_logs(
  id uuid PRIMARY KEY, received_at timestamptz NOT NULL DEFAULT now(), name text NOT NULL, bytes integer NOT NULL,
  source text NOT NULL, body bytea NOT NULL);
  ALTER TABLE pilot_logs ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'plog';
  ALTER TABLE pilot_logs ADD COLUMN IF NOT EXISTS redacted integer NOT NULL DEFAULT 0;
  ALTER TABLE pilot_logs ADD COLUMN IF NOT EXISTS failed integer NOT NULL DEFAULT 0;
  ALTER TABLE pilot_logs ADD COLUMN IF NOT EXISTS redact_version integer NOT NULL DEFAULT 1`;
const MARK_KEY='[Schlüsselwechsel – ohne privaten Schlüssel nicht lesbar]',MARK_FAIL='[Zeile nicht entschlüsselbar]';
const BASE64_LINE=/^[A-Za-z0-9+/]{16,}={0,2}$/;
// Upload → stored form: decoded (or plain) text, secrets redacted. Undecodable lines become a marker.
// A file whose lines all look like ciphertext but none decodes is an encrypted log we cannot read, not plain text.
function prepareLog(body,{privateKey=null}={}){
  const {lines,failed}=decodePlog(body.toString('latin1'),{privateKey});
  const decoded=lines.filter(l=>l.text!==null).length;
  let raw,plain=false,fails=failed;
  if(decoded)raw=lines.map(l=>l.text!==null?l.text:l.keyChange?MARK_KEY:MARK_FAIL).join('\n');
  else{
    const src=body.toString('utf8').replace(/\r\n?/g,'\n');
    const nonEmpty=src.split('\n').map(s=>s.trim()).filter(Boolean);
    if(nonEmpty.length&&nonEmpty.every(s=>BASE64_LINE.test(s)||s.startsWith(KEY_PREFIX)))
      raw=nonEmpty.map(s=>s.startsWith(KEY_PREFIX)?MARK_KEY:MARK_FAIL).join('\n');
    else{raw=src;plain=true;fails=0;}
  }
  const {text,count}=redactSecrets(raw);
  return {text:Buffer.from(text,'utf8'),redacted:count,failed:fails,plain};
}
// Same as prepareLog, plus gzip, in a worker thread: up to 32 MiB of AES + regex work must not block the event loop.
function prepareLogAsync(body,{privateKey=null}={}){
  const {Worker}=require('node:worker_threads');
  return new Promise((resolve,reject)=>{
    const w=new Worker(__filename,{workerData:{pilotLogJob:true,body,privateKey}});
    w.once('message',m=>m.error?reject(new Error(m.error)):resolve({...m,text:Buffer.from(m.text)}));
    w.once('error',reject);
    w.once('exit',code=>{if(code!==0)reject(new Error('pilot log worker exit '+code));});
  });
}

function createPilotLogStore(pool,{prepare=prepareLogAsync,log=console}={}){
  let ready=null;
  // Rewrites rows stored in an older form (encrypted original, older redaction rules) once, one row at a time.
  async function migrate(){
    const {rows}=await pool.query("SELECT id FROM pilot_logs WHERE format<>'text' OR redact_version<$1",[REDACT_VERSION]);
    for(const {id} of rows){
      try{
        const r=(await pool.query('SELECT body,format,redacted FROM pilot_logs WHERE id=$1',[id])).rows[0];
        if(!r)continue;
        let body,redacted,failed=null;
        if(r.format==='text'){const x=redactSecrets(zlib.gunzipSync(r.body).toString('utf8'));body=zlib.gzipSync(Buffer.from(x.text,'utf8'));redacted=(r.redacted||0)+x.count;}
        else{const p=await prepare(r.body);body=p.gzip?Buffer.from(p.gzip):zlib.gzipSync(p.text);redacted=p.redacted;failed=p.failed;}
        await pool.query("UPDATE pilot_logs SET body=$2,format='text',redacted=$3,failed=COALESCE($4,failed),redact_version=$5 WHERE id=$1",
          [id,body,redacted,failed,REDACT_VERSION]);
      }catch(err){log.error('[pilot log] Nachschwärzen von '+id+' fehlgeschlagen:',err.message);}
    }
    if(rows.length)log.log('[pilot log] '+rows.length+' gespeicherte(s) Protokoll(e) nachgeschwärzt');
  }
  const init=()=>ready||(ready=pool.query(SCHEMA)
    .then(()=>pool.query("DELETE FROM pilot_logs WHERE received_at < now() - interval '"+KEEP_DAYS+" days'"))
    .then(migrate)
    .catch(err=>{ready=null;throw err;}));
  return {
    // body = original upload; only the redacted text form is stored.
    async save({name,body,source,privateKey=null}){
      await init();
      const id=crypto.randomUUID(),p=await prepare(body,{privateKey});
      await pool.query('INSERT INTO pilot_logs(id,name,bytes,source,body,format,redacted,failed,redact_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [id,name,body.length,source,p.gzip?Buffer.from(p.gzip):zlib.gzipSync(p.text),'text',p.redacted,p.failed,REDACT_VERSION]);
      return {id,redacted:p.redacted,failed:p.failed,plain:p.plain};
    },
    async list(){
      await init();
      const {rows}=await pool.query('SELECT id,received_at,name,bytes,source,redacted FROM pilot_logs ORDER BY received_at DESC LIMIT 200');
      return rows.map(r=>({id:r.id,receivedAt:r.received_at,name:r.name,bytes:r.bytes,source:r.source,redacted:r.redacted}));
    },
    async get(id){
      await init();
      const {rows}=await pool.query('SELECT name,body,format,redacted,failed FROM pilot_logs WHERE id=$1',[id]);
      const r=rows[0];
      return r?{name:r.name,body:zlib.gunzipSync(r.body),format:r.format,redacted:r.redacted,failed:r.failed}:null;
    },
    async remove(id){await init();return (await pool.query('DELETE FROM pilot_logs WHERE id=$1',[id])).rowCount;}
  };
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Pilot 2 upload: Bearer device token (same as /api/pilot/bootstrap), raw body, X-Log-Name.
function registerPilotLogUpload(app,{express,store,authorized,log=console}){
  app.post('/api/pilot/logs',express.raw({type:()=>true,limit:MAX_BYTES}),async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(!req.secure)return res.status(403).json({error:'HTTPS required'});
    if(!await authorized(req))return res.status(401).json({error:'Unauthorized'});
    const name=String(req.get('X-Log-Name')||'').replace(/[^\w.\- ()]/g,'_').slice(0,120);
    if(!NAME.test(name))return res.status(400).json({error:'Dateiname fehlt'});
    if(!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({error:'Datei leer'});
    try{
      const r=await store.save({name,body:req.body,source:String(req.ip||'').slice(0,64)});
      log.log('[pilot log] received '+name+' ('+Math.round(req.body.length/1024)+' KiB, '+r.redacted+' Geheimnis(se) geschwärzt)');
      res.status(201).json(r);
    }catch(err){log.error('[pilot log]',err.message);res.status(503).json({error:'Speicher nicht verfügbar'});}
  });
}
// Viewer (home LAN): list, decoded text with filter, download, delete.
function createPilotLogRouter({express,store,privateKey=null,log=console}){
  const router=express.Router();
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.get('/',async(_req,res)=>{try{res.json({logs:await store.list()});}catch(err){log.error('[pilot log]',err.message);res.status(503).json({error:'Speicher nicht verfügbar'});}});
  router.get('/:id/text',async(req,res)=>{
    if(!UUID.test(req.params.id))return res.status(400).json({error:'ungültig'});
    const item=await store.get(req.params.id).catch(()=>null);
    if(!item)return res.status(404).json({error:'nicht gefunden'});
    let text,failed=item.failed||0,plain=false,keyChanges=0,redacted=item.redacted||0;
    // Stored text is already redacted (current rules; older rows are rewritten at start), so no per-request regex pass.
    if(item.format==='text')text=item.body.toString('utf8').split(/\r?\n/);
    else{   // not yet migrated row (encrypted original): redact in the worker before showing anything
      const p=await prepareLogAsync(item.body,{privateKey}).catch(()=>null);
      if(!p)return res.status(503).json({error:'Protokoll nicht lesbar'});
      text=p.text.toString('utf8').split('\n');failed=p.failed;plain=p.plain;redacted=p.redacted;
    }
    keyChanges=text.filter(t=>t.startsWith('[Schlüsselwechsel')).length;
    if(req.query.download==='1'){
      res.set('Content-Disposition','attachment; filename="'+item.name.replace(/[^\w.-]/g,'_')+'.txt"');
      return res.type('text/plain; charset=utf-8').send(text.join('\n'));
    }
    const q=typeof req.query.q==='string'?req.query.q.slice(0,100).toLowerCase():'';
    const filtered=q?text.map((t,i)=>({n:i+1,t})).filter(x=>x.t.toLowerCase().includes(q)):text.map((t,i)=>({n:i+1,t}));
    const offset=Math.max(0,Number(req.query.offset)||0),limit=Math.min(5000,Math.max(1,Number(req.query.limit)||2000));
    res.json({name:item.name,total:text.length,matches:filtered.length,failed,plain,redacted,
      keyChanges,offset,lines:filtered.slice(offset,offset+limit)});
  });
  router.delete('/:id',async(req,res)=>{
    if(!UUID.test(req.params.id))return res.status(400).json({error:'ungültig'});
    res.json({removed:await store.remove(req.params.id).catch(()=>0)});
  });
  return router;
}

module.exports={decodePlog,encodeLine,redactSecrets,prepareLog,prepareLogAsync,createPilotLogStore,registerPilotLogUpload,createPilotLogRouter,
  KEY_PREFIX,DEFAULT_PASSWORD,REDACT_VERSION};

// Worker thread entry (prepareLogAsync): decode + redact + gzip off the main thread.
{
  const wt=require('node:worker_threads');
  if(!wt.isMainThread&&wt.workerData&&wt.workerData.pilotLogJob){
    try{
      const p=prepareLog(Buffer.from(wt.workerData.body),{privateKey:wt.workerData.privateKey});
      const gzip=zlib.gzipSync(p.text);
      wt.parentPort.postMessage({text:p.text,gzip,redacted:p.redacted,failed:p.failed,plain:p.plain});
    }catch(err){wt.parentPort.postMessage({error:String(err&&err.message||err)});}
  }
}
