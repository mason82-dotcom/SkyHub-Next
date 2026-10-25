'use strict';

// OFFLINE-only trusted policy gate over the existing bounded retention adapter.
// A request cannot choose its own retentionDays or wall-clock to shorten expiry.
// Defaults to no DELETE. Missing policy, explicit workspace hold, non-admin role,
// or untrusted authorization all fail closed.
// The DELETE only ever runs inside createFlighttaskWorkspaceTransactions().run():
// fixed NOBYPASSRLS role plus transaction-local workspace scope. A raw pool or
// client is refused, otherwise the restrictive tenant policy would silently
// match no rows (or, on an owner connection, be bypassed).
const {createFlighttaskRetention,MIN_DAYS,MAX_DAYS,MAX_BATCH}=require('./dji-flighttask-journal-retention');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9_.:@-]{1,128}$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const denied=()=>new Error('Flighttask retention policy access denied');
const unavailable=()=>new Error('Flighttask retention policy unavailable');
const disabled=()=>new Error('Flighttask retention policy not enabled');

function createPolicyBoundFlighttaskRetention(transactions,{authorize,resolvePolicy,clock=Date.now}={}){
  if(!transactions||typeof transactions.run!=='function'||
     typeof transactions.query==='function'||typeof transactions.connect==='function'||
     typeof authorize!=='function'||
     typeof resolvePolicy!=='function'||typeof clock!=='function')
    throw new Error('Flighttask retention policy requires trusted dependencies');
  async function run({workspaceId,principal,execute=false}={}){
    if(typeof workspaceId!=='string'||!UUID.test(workspaceId)||
      !object(principal)||typeof principal.id!=='string'||!ID.test(principal.id)||
      typeof principal.workspaceId!=='string'||
      principal.workspaceId.toLowerCase()!==workspaceId.toLowerCase()||
      principal.role!=='admin'||typeof execute!=='boolean')
      throw denied();
    let granted=false;
    try{granted=(await authorize(principal,workspaceId,'prune'))===true;}
    catch(_error){granted=false;}
    if(!granted)throw denied();
    let policy,now;
    try{
      policy=await resolvePolicy(principal,workspaceId);
      now=clock();
    }catch(_error){throw unavailable();}
    // An explicit, independently governed policy is required. Neither a
    // client-supplied 30-day default nor an advisory/legal-hold override works.
    if(!object(policy)||policy.enabled!==true||policy.legalHold!==false)
      throw disabled();
    if(!Number.isInteger(policy.retentionDays)||policy.retentionDays<MIN_DAYS||
       policy.retentionDays>MAX_DAYS||
       !Number.isInteger(policy.maxBatch)||policy.maxBatch<1||policy.maxBatch>MAX_BATCH||
       !Number.isSafeInteger(now)||now<1e12||now>1e15)
      throw unavailable();

    if(!execute)return Object.freeze({
      executed:false,deletedCount:0,limited:false,
      classification:'policy-checked-no-delete'
    });
    const result=await transactions.run({workspaceId,principal,action:'prune'},client=>
      createFlighttaskRetention(client,{
        // Authorization has already been checked against the trusted identity.
        // The underlying storage adapter must never be called directly by HTTP.
        authorize:async(user,ws)=>user===principal&&ws===workspaceId
      }).prune({
        workspaceId,principal,now,
        retentionDays:policy.retentionDays,maxRows:policy.maxBatch
      }));
    return Object.freeze({
      executed:true,deletedCount:result.deletedCount,limited:result.limited,
      classification:'policy-bound-terminal-snapshots-only'
    });
  }
  return Object.freeze({run});
}
module.exports={createPolicyBoundFlighttaskRetention};
