'use strict';

// OFFLINE-only: no scheduler, MQTT, DB pool or server route.
// Caller must inject trusted authorization; only terminal snapshots are deletable.
const PHASES=Object.freeze([
  'reported_ok','reported_failed','reported_canceled',
  'reply_rejected','expired_unverified','conflicting_reports'
]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY_MS=86400000;
const MIN_DAYS=1,MAX_DAYS=3650,MAX_BATCH=500;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);

const DELETE_SQL=[
  'WITH candidates AS (',
  ' SELECT workspace_id,observation_id',
  ' FROM dji_flighttask_observation_snapshots',
  ' WHERE workspace_id=$1',
  ' AND updated_at < to_timestamp($2::double precision / 1000)',
  " AND snapshot->>'phase' = ANY($3::text[])",
  ' ORDER BY updated_at,observation_id',
  ' LIMIT $4 FOR UPDATE SKIP LOCKED',
  ')',
  'DELETE FROM dji_flighttask_observation_snapshots AS journal',
  'USING candidates',
  'WHERE journal.workspace_id=candidates.workspace_id',
  ' AND journal.observation_id=candidates.observation_id',
  'RETURNING journal.observation_id'
].join('\n');

function createFlighttaskRetention(db,{authorize}={}){
  if(!db||typeof db.query!=='function'||typeof authorize!=='function')
    throw new Error('Flighttask retention requires a database and a trusted authorization callback');
  async function prune({workspaceId,principal,now,retentionDays=30,maxRows=100}={}){
    if(typeof workspaceId!=='string'||!UUID.test(workspaceId)||
      !object(principal)||!Number.isSafeInteger(now)||now<1e12||now>1e15||
      !Number.isInteger(retentionDays)||retentionDays<MIN_DAYS||
      retentionDays>MAX_DAYS||!Number.isInteger(maxRows)||maxRows<1||
      maxRows>MAX_BATCH)
      throw new Error('Invalid flighttask retention request');
    let permitted=false;
    try{permitted=(await authorize(principal,workspaceId))===true;}
    catch(_error){permitted=false;}
    if(!permitted)throw new Error('Flighttask retention access denied');
    const cutoff=now-retentionDays*DAY_MS;
    let result;
    try{result=await db.query(DELETE_SQL,[workspaceId,cutoff,PHASES,maxRows]);}
    catch(_error){throw new Error('Flighttask retention storage unavailable');}
    const count=result?.rows?.length;
    if(!Number.isSafeInteger(count)||count<0||count>maxRows)
      throw new Error('Flighttask retention invalid storage response');
    return Object.freeze({deletedCount:count,limited:count===maxRows,
      classification:'isolated-terminal-snapshots-only'});
  }
  return Object.freeze({prune});
}
module.exports={createFlighttaskRetention,DELETE_SQL,PHASES,MIN_DAYS,MAX_DAYS,MAX_BATCH};
