'use strict';

// Persist a Pilot media-group report only after the reported uploads already
// exist in SkyHub's HEAD-verified single-media table for the same workspace.
const {parseGroupUploadCallback,workspaceId}=require('./media-upload-contract');

function createPilotMediaGroupStore(db){
  if(!db||typeof db.query!=='function')throw new TypeError('Media database required');
  return {
    async report({workspace,body}={}){
      if(!workspaceId(workspace))throw new TypeError('Invalid media workspace');
      const item=parseGroupUploadCallback(body);
      if(!item)throw new TypeError('Invalid DJI group upload callback');
      // No reliable group correlation for anonymous/empty groups; do not claim
      // completion or fabricate a group from client-only counts.
      if(!item.fileGroupId||item.fileCount<1||item.fileUploadedCount<1)
        return {status:'unverifiable'};
      // Atomic statement: records a report only if the DB count of separately
      // HEAD-verified files equals the reported successful upload count.
      const inserted=await db.query(
        'INSERT INTO dji_pilot_media_group_reports '+
        '(workspace_id,file_group_id,file_count,file_uploaded_count,verified_count) '+
        'SELECT $1::uuid,$2::varchar,$3::integer,$4::integer,count(*)::integer '+
        'FROM dji_pilot_media_verified '+
        'WHERE workspace_id=$1 AND file_group_id=$2 '+
        'HAVING count(*)=$4::bigint '+
        'ON CONFLICT DO NOTHING RETURNING file_group_id',
        [workspace,item.fileGroupId,item.fileCount,item.fileUploadedCount]);
      if(inserted.rows.length===1)return {status:'recorded'};
      const existing=await db.query(
        'SELECT file_count,file_uploaded_count FROM dji_pilot_media_group_reports '+
        'WHERE workspace_id=$1 AND file_group_id=$2',
        [workspace,item.fileGroupId]);
      if(existing.rows.length===1){
        const row=existing.rows[0];
        return {status:Number(row.file_count)===item.fileCount &&
          Number(row.file_uploaded_count)===item.fileUploadedCount?'duplicate':'conflict'};
      }
      return {status:'pending'};
    }
  };
}

module.exports={createPilotMediaGroupStore};
