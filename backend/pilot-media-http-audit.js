'use strict';

// Dedicated SQL audit recorder with no object keys, device serials, tokens,
// full fingerprints, or credential material in either columns or arguments.
const {workspaceId}=require('./media-upload-contract');
const ACTIONS=new Set(['tiny_fingerprints','fast_upload','upload_callback','group_upload_callback']);
const OUTCOMES=new Set(['ok','invalid','denied','conflict','pending','unavailable']);

function createPilotMediaHttpAudit(db){
  if(!db||typeof db.query!=='function')throw new TypeError('Media audit database required');
  return async function audit({workspace,operation,outcome}={}){
    if(!workspaceId(workspace)||!ACTIONS.has(operation)||!OUTCOMES.has(outcome))
      throw new TypeError('Invalid Pilot media HTTP audit entry');
    await db.query(
      'INSERT INTO dji_pilot_media_http_audit (workspace_id,operation,outcome) '+
      'VALUES ($1,$2,$3)',[workspace,operation,outcome]);
  };
}
module.exports={createPilotMediaHttpAudit};
