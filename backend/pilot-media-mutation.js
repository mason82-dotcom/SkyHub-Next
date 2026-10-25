'use strict';

// An upload acknowledgement and its audit record share one dedicated
// PostgreSQL connection. A failed audit rolls back the media mutation.
const {createPilotMediaStore}=require('./pilot-media-store');
const {createPilotMediaGroupStore}=require('./pilot-media-groups');
const {createPilotMediaHttpAudit}=require('./pilot-media-http-audit');

function createPilotMediaMutationTransaction(pool,{clock}={}){
  if(!pool||typeof pool.connect!=='function')
    throw new TypeError('Dedicated media PostgreSQL pool required');
  return async function transaction(work){
    if(typeof work!=='function')throw new TypeError('Media transaction work required');
    const client=await pool.connect();
    if(!client||typeof client.query!=='function'||typeof client.release!=='function')
      throw new TypeError('Invalid media PostgreSQL client');
    let begun=false;
    let broken=false;
    try{
      await client.query('BEGIN');
      begun=true;
      const result=await work({
        store:createPilotMediaStore(client,{clock}),
        groups:createPilotMediaGroupStore(client),
        audit:createPilotMediaHttpAudit(client)
      });
      await client.query('COMMIT');
      begun=false;
      return result;
    }catch(err){
      if(begun){
        try{await client.query('ROLLBACK');}catch(_rollbackErr){broken=true;}
      }
      throw err;
    }finally{
      client.release(broken);
    }
  };
}

module.exports={createPilotMediaMutationTransaction};
