'use strict';

// Workspace-anchored, evidence-based Pilot 2 media catalogue.
// Not imported by server.js; no HTTP route or migration at startup.
const {parseUploadCallback,parseTinyFingerprintRequest,parseFastUploadRequest,
  objectKeyUnderPrefix,workspaceId}=require('./media-upload-contract');

const BUCKET='dji-cloud';
const SESSION=/^[0-9a-f]{32}$/;
const FINGERPRINT=/^[A-Za-z0-9_.-]{1,128}$/;
const GRACE_MS=900000;
const SKEW_MS=30000;
function object(v){return !!v&&typeof v==='object'&&!Array.isArray(v);}
function stamp(value){
  if(value instanceof Date && Number.isFinite(value.getTime()))return value.getTime();
  if(typeof value==='string' && Number.isFinite(Date.parse(value)))return Date.parse(value);
  return null;
}
function scope(workspace,prefix){
  return workspaceId(workspace) && typeof prefix==='string' &&
    prefix.startsWith(workspace+'/media/') &&
    SESSION.test(prefix.slice((workspace+'/media/').length));
}
function prefixForKey(workspace,key){
  if(!workspaceId(workspace)||typeof key!=='string')return null;
  const root=workspace+'/media/';
  if(!key.startsWith(root))return null;
  const rest=key.slice(root.length);
  const session=rest.split('/')[0];
  const prefix=root+session;
  return scope(workspace,prefix)&&objectKeyUnderPrefix(key,prefix)?prefix:null;
}
function requireDb(db){
  if(!db||typeof db.query!=='function')throw new TypeError('Dedicated media database required');
}
function requireWorkspace(workspace){
  if(!workspaceId(workspace))throw new TypeError('Invalid Pilot media workspace');
}
function validFingerprint(value){
  return typeof value==='string'&&FINGERPRINT.test(value);
}
function headEvidence(v){
  if(!object(v)||!Number.isSafeInteger(v.size)||v.size<1||
    typeof v.etag!=='string'||!/^[\x21-\x7e]{1,256}$/.test(v.etag))
    return null;
  const at=stamp(v.lastModified);
  return at===null?null:{size:v.size,etag:v.etag,lastModified:at};
}
function createPilotMediaStore(db,{clock=()=>Date.now()}={}){
  requireDb(db);
  if(typeof clock!=='function')throw new TypeError('Media clock required');
  function now(){
    const at=clock();
    if(!Number.isSafeInteger(at)||at<1e12)throw new TypeError('Invalid media clock');
    return at;
  }
  return {
    async registerGrant({workspace,grant}={}){
      requireWorkspace(workspace);
      if(!object(grant)||grant.provider!=='minio'||grant.bucket!==BUCKET||
        !scope(workspace,grant.objectKeyPrefix)||
        !object(grant.credentials)||
        !Number.isSafeInteger(grant.credentials.expire)||
        grant.credentials.expire<1||grant.credentials.expire>900)
        throw new TypeError('Invalid media grant');
      const issued=now();
      // Store ONLY the scope and time window. STS keys and session tokens are discarded.
      const {rows}=await db.query(
        'INSERT INTO dji_pilot_media_grants '+
        '(workspace_id,object_key_prefix,bucket,issued_at,expires_at) '+
        'VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING object_key_prefix',
        [workspace,grant.objectKeyPrefix,BUCKET,new Date(issued),
          new Date(issued+grant.credentials.expire*1000)]);
      if(rows.length!==1)throw new Error('Duplicate or unavailable STS grant scope');
      return {registered:true};
    },

    // Only a database-registered grant may confirm a callback.
    async verifyCallback({workspace,callback,headObject}={}){
      requireWorkspace(workspace);
      const item=parseUploadCallback(callback);
      if(!item)throw new TypeError('Invalid Pilot media callback');
      if(!item.uploaded)return {status:'failed-upload'};
      if(typeof headObject!=='function')throw new TypeError('Object verifier required');
      const prefix=prefixForKey(workspace,item.objectKey);
      if(!prefix)return {status:'unregistered'};
      const {rows}=await db.query(
        'SELECT issued_at,expires_at FROM dji_pilot_media_grants '+
        'WHERE workspace_id=$1 AND object_key_prefix=$2 AND bucket=$3',
        [workspace,prefix,BUCKET]);
      if(rows.length!==1)return {status:'unregistered'};
      const issuedAt=stamp(rows[0].issued_at);
      const expiresAt=stamp(rows[0].expires_at);
      const current=now();
      if(issuedAt===null||expiresAt===null||expiresAt<=issuedAt||
        current<issuedAt-SKEW_MS||current>expiresAt+GRACE_MS)
        return {status:'expired'};

      // HEAD under trusted bucket and the issued key. 404 is not object evidence.
      // Callback metadata, supplied size and supplied checksum are NOT trusted.
      const evidence=headEvidence(await headObject({bucket:BUCKET,key:item.objectKey}));
      if(!evidence||evidence.lastModified<issuedAt-SKEW_MS||
        evidence.lastModified>expiresAt+SKEW_MS)
        return {status:'unverified'};
      const tiny=item.ext.tinny_fingerprint??null;
      const group=item.ext.file_group_id??null;
      const metadata=JSON.stringify(item.metadata??{});
      const values=[workspace,item.objectKey,prefix,item.name,item.fingerprint,tiny,
        group,evidence.size,evidence.etag,new Date(evidence.lastModified),metadata];
      // A single INSERT with two unique constraints provides idempotency across
      // concurrent callbacks and fail-closed collision handling.
      const inserted=await db.query(
        'INSERT INTO dji_pilot_media_verified '+
        '(workspace_id,object_key,grant_prefix,file_name,fingerprint,tiny_fingerprint,'+
        'file_group_id,size_bytes,etag,object_last_modified,pilot_metadata) '+
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) '+
        'ON CONFLICT DO NOTHING RETURNING object_key',[...values]);
      if(inserted.rows.length===1)return {status:'verified'};
      const existing=await db.query(
        'SELECT object_key,grant_prefix,file_name,fingerprint,tiny_fingerprint,'+
        'file_group_id,size_bytes,etag,object_last_modified FROM dji_pilot_media_verified '+
        'WHERE workspace_id=$1 AND (object_key=$2 OR '+
        '($3::varchar IS NOT NULL AND fingerprint=$3))',
        [workspace,item.objectKey,item.fingerprint]);
      const compatible=existing.rows.length===1 && (row=>{
        return row.object_key===item.objectKey && row.grant_prefix===prefix &&
          row.file_name===item.name &&
          row.fingerprint===(item.fingerprint??null) &&
          row.tiny_fingerprint===tiny && row.file_group_id===group &&
          Number(row.size_bytes)===evidence.size && row.etag===evidence.etag &&
          stamp(row.object_last_modified)===evidence.lastModified;
      })(existing.rows[0]);
      return {status:compatible?'duplicate':'conflict'};
    },

    async existingTinyFingerprints({workspace,body}={}){
      requireWorkspace(workspace);
      const parsed=parseTinyFingerprintRequest(body);
      if(!parsed)throw new TypeError('Invalid tiny fingerprints request');
      if(parsed.tinyFingerprints.length===0)return [];
      const {rows}=await db.query(
        'SELECT DISTINCT tiny_fingerprint AS fingerprint FROM dji_pilot_media_verified '+
        'WHERE workspace_id=$1 AND tiny_fingerprint = ANY($2::varchar[])',
        [workspace,parsed.tinyFingerprints]);
      const existing=new Set(rows.map(r=>r.fingerprint));
      return parsed.tinyFingerprints.filter(v=>existing.has(v));
    },

    async verifiedFingerprint({workspace,body}={}){
      requireWorkspace(workspace);
      const parsed=parseFastUploadRequest(body);
      if(!parsed)throw new TypeError('Invalid fast upload request');
      const {rows}=await db.query(
        'SELECT 1 FROM dji_pilot_media_verified '+
        'WHERE workspace_id=$1 AND fingerprint=$2 LIMIT 1',
        [workspace,parsed.fingerprint]);
      // Pilot supplied fingerprint is an identifier, NOT a cryptographic checksum
      // of S3 content, and must not be advertised as such.
      return {exists:rows.length===1};
    }
  };
}

function createRegisteredStsIssuer({issueGrant,store}={}){
  if(typeof issueGrant!=='function'||!store||typeof store.registerGrant!=='function')
    throw new TypeError('STS issuer and durable media store required');
  return async args=>{
    if(!object(args)||!workspaceId(args.workspace)||!object(args.principal)||
      args.principal.role!=='pilot'||args.principal.workspaceId!==args.workspace||
      args.maxSeconds!==900)throw new TypeError('Invalid registered issuer context');
    const grant=await issueGrant(args);
    // A usable token must NEVER be returned unless its scope is durable.
    await store.registerGrant({workspace:args.workspace,grant});
    return grant;
  };
}

module.exports={createPilotMediaStore,createRegisteredStsIssuer,prefixForKey,
  headEvidence,GRACE_MS};
