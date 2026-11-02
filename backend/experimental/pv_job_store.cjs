'use strict';

// Opt-in PV job-store prototype. Never loaded by server.js.
// Designed to be used only with explicit migration and separate access control.
const crypto = require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBJECT=/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
const SHA=/^[0-9a-f]{64}$/;
const STATES=new Set(['queued','running','candidate-ready','failed']);
class JobUnavailable extends Error {constructor(){super('PV offline job unavailable');this.name='JobUnavailable';}}
function guard(v){if(!v)throw new JobUnavailable();}
function valid(v,pattern){return typeof v==='string'&&pattern.test(v);}
function operator(p,workspace){return p&&typeof p==='object'&&!Array.isArray(p)&&p.role==='operator'&&p.workspaceId===workspace&&valid(p.subject,SUBJECT);}
function publicJob(row){
  guard(row&&valid(row.job_id,UUID)&&valid(row.workspace_id,UUID)&&valid(row.asset_id,UUID)&&STATES.has(row.state));
  const data={schema:'skyhub-pv-job-preview-v1',jobId:row.job_id,assetId:row.asset_id,state:row.state,analysisType:'rjpeg-candidate-preview',radiometryVerified:false,defectVerified:false,flightReady:false};
  if(row.state==='candidate-ready'){
    guard(valid(row.source_sha256,SHA));
    data.sourceSha256=row.source_sha256;
    data.candidateProduced=true;
    data.hardwareValidated=false;
  }
  if(row.state==='failed')data.failureCode='unavailable';
  return Object.freeze(data);
}
async function tx(db,fn){
  const c=await db.connect();guard(c&&typeof c.query==='function'&&typeof c.release==='function');
  let opened=false;
  try{
    await c.query('BEGIN');opened=true;
    const result=await fn(c);
    await c.query('COMMIT');opened=false;
    return result;
  }catch(e){
    if(opened){try{await c.query('ROLLBACK');}catch(_ignored){}}
    throw e;
  }finally{c.release();}
}
const FIELDS='job_id,workspace_id,asset_id,state,source_sha256';
function createPvJobStore({db,authorize,auditDenied}={}){
  guard(db&&typeof db.connect==='function'&&typeof authorize==='function'&&typeof auditDenied==='function');
  async function request({workspaceId,assetId,idempotencyKey,principal}={}){
    try{
      guard(valid(workspaceId,UUID)&&valid(assetId,UUID)&&valid(idempotencyKey,UUID)&&operator(principal,workspaceId));
      guard(await authorize({workspaceId,assetId,principal,operation:'pv_job_request'})===true);
      return await tx(db,async c=>{
        const insert=await c.query(
          "INSERT INTO skyhub_pv_jobs (workspace_id,asset_id,idempotency_key,requested_by,state) VALUES($1,$2,$3,$4,'queued') ON CONFLICT(workspace_id,idempotency_key) DO NOTHING RETURNING "+FIELDS,
          [workspaceId,assetId,idempotencyKey,principal.subject]);
        guard(Array.isArray(insert.rows)&&insert.rows.length<=1);
        let row=insert.rows[0], action='requested';
        if(!row){
          const old=await c.query('SELECT '+FIELDS+',requested_by FROM skyhub_pv_jobs WHERE workspace_id=$1 AND idempotency_key=$2',[workspaceId,idempotencyKey]);
          guard(old.rows.length===1);
          row=old.rows[0];
          guard(row.asset_id===assetId&&row.requested_by===principal.subject);
          action='replayed';
        }
        await c.query('INSERT INTO skyhub_pv_job_audit(workspace_id,job_id,action) VALUES($1,$2,$3)',[workspaceId,row.job_id,action]);
        return publicJob(row);
      });
    }catch(_e){
      try{await auditDenied({workspaceId:valid(workspaceId,UUID)?workspaceId:null,action:'request_denied'});}catch(_ignored){}
      throw new JobUnavailable();
    }
  }
  async function claimNext(){
    try{return await tx(db,async c=>{
      const token=crypto.randomUUID();
      const r=await c.query(
        "UPDATE skyhub_pv_jobs SET state='running',claim_token=$1,started_at=now(),heartbeat_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '15 minutes' WHERE job_id=(SELECT job_id FROM skyhub_pv_jobs WHERE state='queued' ORDER BY created_at,job_id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING "+FIELDS+",requested_by,claim_token",[token]);
      guard(Array.isArray(r.rows)&&r.rows.length<=1);
      if(!r.rows.length)return null;
      const row=r.rows[0];
      guard(valid(row.claim_token,UUID)&&row.claim_token===token&&valid(row.requested_by,SUBJECT));
      await c.query('INSERT INTO skyhub_pv_job_audit(workspace_id,job_id,action) VALUES($1,$2,$3)',[row.workspace_id,row.job_id,'claimed']);
      return Object.freeze({jobId:row.job_id,workspaceId:row.workspace_id,assetId:row.asset_id,requestedBy:row.requested_by,claimToken:token});
    });}catch(_e){throw new JobUnavailable();}
  }
  async function heartbeat({claim}={}){
    try{
      guard(claim&&valid(claim.jobId,UUID)&&valid(claim.workspaceId,UUID)&&valid(claim.claimToken,UUID));
      return await tx(db,async c=>{
        const r=await c.query(
          "UPDATE skyhub_pv_jobs SET heartbeat_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '15 minutes' WHERE job_id=$1 AND workspace_id=$2 AND claim_token=$3 AND state='running' AND lease_expires_at>clock_timestamp() RETURNING "+FIELDS,
          [claim.jobId,claim.workspaceId,claim.claimToken]);
        guard(Array.isArray(r.rows)&&r.rows.length===1);
        await c.query('INSERT INTO skyhub_pv_job_audit(workspace_id,job_id,action) VALUES($1,$2,$3)',[claim.workspaceId,claim.jobId,'heartbeat']);
        return Object.freeze({status:'lease-extended',jobId:claim.jobId});
      });
    }catch(_e){throw new JobUnavailable();}
  }
  async function finish({claim,sourceSha256=null,outcome}={}){
    try{
      guard(claim&&valid(claim.jobId,UUID)&&valid(claim.workspaceId,UUID)&&valid(claim.claimToken,UUID));
      guard(outcome==='candidate-ready'||outcome==='failed');
      guard(outcome==='failed'?sourceSha256===null:valid(sourceSha256,SHA));
      return await tx(db,async c=>{
        const r=await c.query(
          "UPDATE skyhub_pv_jobs SET state=$1,source_sha256=$2,claim_token=NULL,finished_at=now(),heartbeat_at=NULL,lease_expires_at=NULL WHERE job_id=$3 AND workspace_id=$4 AND claim_token=$5 AND state='running' AND lease_expires_at>clock_timestamp() RETURNING "+FIELDS,
          [outcome,sourceSha256,claim.jobId,claim.workspaceId,claim.claimToken]);
        guard(Array.isArray(r.rows)&&r.rows.length===1);
        await c.query('INSERT INTO skyhub_pv_job_audit(workspace_id,job_id,action) VALUES($1,$2,$3)',[claim.workspaceId,claim.jobId,outcome==='failed'?'failed':'candidate_recorded']);
        return publicJob(r.rows[0]);
      });
    }catch(_e){throw new JobUnavailable();}
  }
  async function expireStale({workspaceId,principal,limit=25}={}){
    try{
      guard(valid(workspaceId,UUID)&&operator(principal,workspaceId)&&Number.isSafeInteger(limit)&&limit>=1&&limit<=25);
      guard(await authorize({workspaceId,principal,operation:'pv_job_recovery'})===true);
      return await tx(db,async c=>{
        const r=await c.query(
          "WITH expired AS (SELECT job_id FROM skyhub_pv_jobs WHERE workspace_id=$1 AND state='running' AND lease_expires_at<=clock_timestamp() ORDER BY lease_expires_at,job_id FOR UPDATE SKIP LOCKED LIMIT $2) UPDATE skyhub_pv_jobs j SET state='failed',claim_token=NULL,finished_at=now(),source_sha256=NULL,heartbeat_at=NULL,lease_expires_at=NULL FROM expired WHERE j.job_id=expired.job_id AND j.workspace_id=$1 AND j.state='running' AND j.lease_expires_at<=clock_timestamp() RETURNING j.job_id,j.workspace_id",
          [workspaceId,limit]);
        guard(Array.isArray(r.rows)&&r.rows.length<=limit);
        for(const row of r.rows){
          guard(valid(row.job_id,UUID)&&row.workspace_id===workspaceId);
          await c.query('INSERT INTO skyhub_pv_job_audit(workspace_id,job_id,action) VALUES($1,$2,$3)',[workspaceId,row.job_id,'lease_expired']);
        }
        return Object.freeze({status:'review-required',expiredCount:r.rows.length,automaticRetry:false,cleanupVerified:false});
      });
    }catch(_e){throw new JobUnavailable();}
  }
  async function lookup({workspaceId,jobId,principal}={}){
    try{
      guard(valid(workspaceId,UUID)&&valid(jobId,UUID)&&operator(principal,workspaceId));
      guard(await authorize({workspaceId,principal,jobId,operation:'pv_job_read'})===true);
      return await tx(db,async c=>{
        const r=await c.query('SELECT '+FIELDS+',requested_by FROM skyhub_pv_jobs WHERE workspace_id=$1 AND job_id=$2 LIMIT 1',[workspaceId,jobId]);
        guard(Array.isArray(r.rows)&&r.rows.length===1&&r.rows[0].requested_by===principal.subject);
        await c.query('INSERT INTO skyhub_pv_job_audit(workspace_id,job_id,action) VALUES($1,$2,$3)',[workspaceId,jobId,'read']);
        return publicJob(r.rows[0]);
      });
    }catch(_e){throw new JobUnavailable();}
  }
  return Object.freeze({request,claimNext,heartbeat,finish,expireStale,lookup});
}
module.exports={createPvJobStore,JobUnavailable,publicJob};
