'use strict';

// OFFLINE ONLY. No server route, scheduler, Pi connection or DJI command sender.
// Guarantees one connection and transaction-local tenant scope per trusted call.
// IMPORTANT: RLS GUCs are not authentication. The injected authorize callback
// must resolve a trusted identity, and all SQL callbacks must be trusted code.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9_.:@-]{1,128}$/;
const ROLE=/^[a-z][a-z0-9_]{0,62}$/;
const ALL=new Set(['create','read_internal','observe','recover','summary','route_observation','prune']);
const INTERNAL=new Set(['create','read_internal','observe','recover','route_observation']);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const deny=()=>new Error('Flighttask workspace access denied');
const storage=()=>new Error('Flighttask workspace transaction unavailable');

function createFlighttaskWorkspaceTransactions(pool,{authorize,dbRole}={}){
  if(!pool||typeof pool.connect!=='function'||typeof authorize!=='function'||
      typeof dbRole!=='string'||!ROLE.test(dbRole)||dbRole.startsWith('pg_'))
    throw new Error('Flighttask workspace requires trusted pool, authorization and fixed database role');

  async function run({workspaceId,principal,action}={},work){
    if(typeof workspaceId!=='string'||!UUID.test(workspaceId)||
       !object(principal)||typeof principal.id!=='string'||!ID.test(principal.id)||
       typeof principal.workspaceId!=='string'||principal.workspaceId.toLowerCase()!==workspaceId.toLowerCase()||
       !['viewer','operator','admin'].includes(principal.role)||
       !ALL.has(action)||typeof work!=='function'||
       (INTERNAL.has(action)&&principal.role==='viewer')||
       (action==='prune'&&principal.role!=='admin')||
       (action==='route_observation'&&principal.role==='viewer'))
      throw deny();
    let allowed=false;
    try{allowed=(await authorize(principal,workspaceId,action))===true;}
    catch(_error){allowed=false;}
    if(!allowed)throw deny();

    let client,started=false,broken=false;
    try{
      client=await pool.connect();
      if(!client||typeof client.query!=='function'||typeof client.release!=='function')
        throw storage();
      await client.query('BEGIN');
      started=true;
      // dbRole is constructor-injected and strictly identifier-validated.
      await client.query('SET LOCAL ROLE "'+dbRole+'"');
      const check=await client.query(
        'SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=CURRENT_USER'
      );
      if(!Array.isArray(check?.rows)||check.rows.length!==1||
         check.rows[0]?.rolname!==dbRole||
         check.rows[0]?.rolsuper!==false||check.rows[0]?.rolbypassrls!==false)
        throw storage();
      await client.query("SELECT set_config('skyhub.workspace_id',$1,true)",[workspaceId.toLowerCase()]);
      // Work is a trusted, backend-internal callback, NEVER arbitrary client SQL.
      const value=await work(client);
      await client.query('COMMIT');
      started=false;
      return value;
    }catch(_error){
      if(started&&client&&typeof client.query==='function'){
        try{await client.query('ROLLBACK');}catch(_rollbackError){broken=true;}
      }
      throw storage();
    }finally{
      // A failed ROLLBACK leaves the session in an unknown state: discard it, never pool it.
      if(client&&typeof client.release==='function')client.release(broken||undefined);
    }
  }
  return Object.freeze({run});
}
module.exports={createFlighttaskWorkspaceTransactions};
