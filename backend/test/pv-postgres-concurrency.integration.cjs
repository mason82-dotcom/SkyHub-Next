'use strict';
/**
 * Disposable PostgreSQL 16 concurrency probe for SkyHub PV job contracts.
 * This is NOT the complete PV job runner and does not activate any SkyHub API.
 * Run only on a dedicated ephemeral PostgreSQL service in GitHub Actions.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {Pool} = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const {createPvJobStore,JobUnavailable}=require('../experimental/pv_job_store.cjs');

const DSN = process.env.PV_CI_DATABASE_URL;
const OPT_IN = process.env.PV_CI_DISPOSABLE;
if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true' ||
    OPT_IN !== 'yes' || process.env.DATABASE_URL || process.env.SKYHUB_TEST_DATABASE_URL) {
  throw new Error('Disposable PostgreSQL CI opt-in required; refusing real SkyHub databases');
}
let parsed;
try { parsed = new URL(DSN); } catch { throw new Error('Invalid test database URL'); }
if (parsed.protocol !== 'postgresql:' || parsed.username !== 'pv_ci' || !parsed.password ||
    parsed.hostname !== '127.0.0.1' || parsed.port !== '55439' ||
    parsed.pathname !== '/skyhub_pv_ci' || parsed.search || parsed.hash) {
  throw new Error('Refusing unexpected database host, role or name');
}

const schema = 'pvci_' + crypto.randomBytes(8).toString('hex');
const quoted = '"' + schema + '"';
const rootPool = new Pool({connectionString: DSN, max: 2, connectionTimeoutMillis: 5000});
const pool = new Pool({connectionString: DSN, max: 8, connectionTimeoutMillis: 5000,
  options: '-c search_path=' + schema + ' -c statement_timeout=12000 -c lock_timeout=5000'});
let keeper, created = false;
const uuid = () => crypto.randomUUID();
const workspace = uuid(), asset = uuid(), otherAsset = uuid(), otherWorkspace=uuid();
let store;
const principal=(workspaceId=workspace,subject='pv-test-operator')=>({role:'operator',workspaceId,subject});
const queue=async({key=uuid(),assetId=asset,workspaceId=workspace,subject}={})=>store.request({workspaceId,assetId,idempotencyKey:key,principal:principal(workspaceId,subject)});
const auditCount=async(id,action)=>Number((await pool.query('SELECT count(*) AS n FROM skyhub_pv_job_audit WHERE job_id=$1 AND action=$2',[id,action])).rows[0].n);
const sha='a'.repeat(64);
const insert = async (key = uuid(), requestedAsset = asset) => {
  const r = await pool.query(
    'INSERT INTO pv_jobs(workspace_id,asset_id,idempotency_key) VALUES($1,$2,$3) RETURNING job_id',
    [workspace, requestedAsset, key]);
  return r.rows[0].job_id;
};
async function claim() {
  const token = uuid();
  const r = await pool.query(`
    WITH selected AS (
      SELECT job_id FROM pv_jobs WHERE state='queued'
      ORDER BY created_at,job_id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE pv_jobs SET state='running',claim_token=$1,
      heartbeat_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '15 minutes'
    WHERE job_id IN (SELECT job_id FROM selected)
    RETURNING job_id,claim_token`, [token]);
  return r.rows[0] || null;
}
async function finish(row) {
  const r = await pool.query(`
    UPDATE pv_jobs SET state='candidate-ready',claim_token=NULL,lease_expires_at=NULL
    WHERE job_id=$1 AND claim_token=$2 AND state='running'
    AND lease_expires_at>clock_timestamp() RETURNING job_id`,
    [row.job_id,row.claim_token]);
  return r.rowCount;
}
test.before(async () => {
  keeper = await rootPool.connect();
  try {
    const identity = await keeper.query(`
      SELECT current_database() AS db, current_user AS name,
        (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS super,
        (SELECT rolcreatedb FROM pg_roles WHERE rolname=current_user) AS createdb,
        (SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user) AS createrole`);
    assert.deepEqual(identity.rows[0],
      {db:'skyhub_pv_ci',name:'pv_ci',super:false,createdb:false,createrole:false});
    const lock = await keeper.query('SELECT pg_try_advisory_lock(83137,23010) AS ok');
    assert.equal(lock.rows[0].ok,true,'Another disposable PV run holds the lock');
    const existing = await keeper.query(`
      SELECT count(*)::integer AS n FROM pg_namespace
      WHERE nspname NOT IN ('public','pg_catalog','information_schema')
      AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp%'`);
    assert.equal(existing.rows[0].n,0,'The disposable cluster must have no user schemas');
    const relations = await keeper.query(`
      SELECT count(*)::integer AS n FROM pg_class c
      JOIN pg_namespace n ON c.relnamespace=n.oid
      WHERE n.nspname='public' AND c.relkind IN('r','p','v','m','S','f')`);
    assert.equal(relations.rows[0].n,0,'The public schema must have no relations');
    await keeper.query('CREATE SCHEMA ' + quoted);
    created = true;
    await pool.query(`
      CREATE TABLE pv_verified_media (
        workspace_id uuid NOT NULL, asset_id uuid NOT NULL,
        PRIMARY KEY(workspace_id,asset_id)
      );
      CREATE TABLE pv_jobs (
        job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL,
        asset_id uuid NOT NULL,
        idempotency_key uuid NOT NULL,
        state text NOT NULL DEFAULT 'queued'
          CHECK (state IN('queued','running','candidate-ready','failed')),
        created_at timestamptz NOT NULL DEFAULT now(),
        claim_token uuid,
        heartbeat_at timestamptz,
        lease_expires_at timestamptz,
        UNIQUE(workspace_id,idempotency_key),
        FOREIGN KEY(workspace_id,asset_id)
          REFERENCES pv_verified_media(workspace_id,asset_id)
      );
      CREATE TABLE pv_audit (
        seq bigserial PRIMARY KEY,
        job_id uuid NOT NULL REFERENCES pv_jobs(job_id),
        action text NOT NULL
      );
      INSERT INTO pv_verified_media VALUES ('${workspace}','${asset}'),
        ('${workspace}','${otherAsset}');
    `);
    assert.equal((await pool.query('SELECT current_schema() AS s')).rows[0].s,schema);
    await pool.query('CREATE TABLE dji_pilot_media_verified(workspace_id uuid NOT NULL,asset_id uuid NOT NULL,PRIMARY KEY(workspace_id,asset_id))');
    await pool.query("CREATE FUNCTION skyhub_dji_pilot_media_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Immutable PV audit'; END; $$");
    await pool.query(fs.readFileSync(path.join(__dirname,'..','experimental','pv_jobs_isolated.sql'),'utf8'));
    await pool.query('INSERT INTO dji_pilot_media_verified(workspace_id,asset_id) VALUES($1,$2),($1,$3),($4,$2)',[workspace,asset,otherAsset,otherWorkspace]);
    store=createPvJobStore({db:pool,authorize:async({operation})=>['pv_job_request','pv_job_read','pv_job_recovery'].includes(operation),auditDenied:async({workspaceId,action})=>{await pool.query('INSERT INTO skyhub_pv_job_denied_audit(workspace_id,action) VALUES($1,$2)',[workspaceId,action]);}});
  } catch (err) {
    throw new Error('Disposable PostgreSQL setup rejected: ' + err.message);
  }
});
test.after(async () => {
  try {
    await pool.end();
    if (keeper && created) await keeper.query('DROP SCHEMA ' + quoted + ' CASCADE');
  } finally {
    if (keeper) {
      try { await keeper.query('SELECT pg_advisory_unlock(83137,23010)'); }
      catch { /* closing the physical connection also releases session locks */ }
      keeper.release();
    }
    await rootPool.end();
  }
});

test('two independent connections skip a row held by another transaction',async()=>{
  const first=await insert(), second=await insert();
  const locked=await pool.connect();
  const other=await pool.connect();
  try {
    const firstPid=(await locked.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const secondPid=(await other.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    assert.notEqual(firstPid,secondPid);
    await locked.query('BEGIN');
    await locked.query('SELECT job_id FROM pv_jobs WHERE job_id=$1 FOR UPDATE',[first]);
    const result=await claim();
    assert.equal(result.job_id,second);
    assert.equal(await finish(result),1);
  } finally {
    await locked.query('ROLLBACK');locked.release();other.release();
  }
  const result=await claim();assert.equal(result.job_id,first);
  assert.equal(await finish(result),1);
});
test('parallel claims never hand the same job to two workers',async()=>{
  const id=await insert();
  const [a,b]=await Promise.all([claim(),claim()]);
  assert.equal([a,b].filter(Boolean).length,1);
  assert.equal((a||b).job_id,id);
  assert.equal(await finish(a||b),1);
});
test('idempotent media job and verified-asset foreign key constraints',async()=>{
  const key=uuid(), id=await insert(key);
  await assert.rejects(insert(key),e=>e.code==='23505');
  await assert.rejects(insert(uuid(),uuid()),e=>e.code==='23503');
  const active=await claim();assert.equal(active.job_id,id);
  assert.equal(await finish(active),1);
});
test('audit failure rolls back an attempted job transition',async()=>{
  const id=await insert(), running=await claim();assert.equal(running.job_id,id);
  await pool.query(`CREATE FUNCTION reject_candidate_audit() RETURNS trigger
    LANGUAGE plpgsql AS $$BEGIN IF NEW.action='candidate' THEN
      RAISE EXCEPTION 'blocked'; END IF; RETURN NEW;END$$`);
  await pool.query(`CREATE TRIGGER reject_candidate BEFORE INSERT ON pv_audit
    FOR EACH ROW EXECUTE FUNCTION reject_candidate_audit()`);
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    await c.query(`UPDATE pv_jobs SET state='candidate-ready',claim_token=NULL,
      lease_expires_at=NULL WHERE job_id=$1`,[id]);
    await assert.rejects(c.query('INSERT INTO pv_audit(job_id,action) VALUES($1,$2)',[id,'candidate']));
    await c.query('ROLLBACK');
    const r=await pool.query('SELECT state,claim_token FROM pv_jobs WHERE job_id=$1',[id]);
    assert.equal(r.rows[0].state,'running');
    assert.equal(r.rows[0].claim_token,running.claim_token);
  }finally{c.release();await pool.query('DROP TRIGGER reject_candidate ON pv_audit');}
  assert.equal(await finish(running),1);
});
test('heartbeat and finish competition cannot revive a terminal job',async()=>{
  const id=await insert(), current=await claim();assert.equal(current.job_id,id);
  const [heartbeat,done]=await Promise.allSettled([
    pool.query(`UPDATE pv_jobs SET heartbeat_at=clock_timestamp(),
      lease_expires_at=clock_timestamp()+interval '15 minutes'
      WHERE job_id=$1 AND claim_token=$2 AND state='running'
      AND lease_expires_at>clock_timestamp() RETURNING job_id`,
      [id,current.claim_token]),
    finish(current)
  ]);
  assert.equal(done.status,'fulfilled');
  assert.equal(done.value,1);
  const state=await pool.query('SELECT state,claim_token FROM pv_jobs WHERE job_id=$1',[id]);
  assert.equal(state.rows[0].state,'candidate-ready');
  assert.equal(state.rows[0].claim_token,null);
  if(heartbeat.status==='fulfilled')assert.ok(heartbeat.value.rowCount===0||heartbeat.value.rowCount===1);
  assert.equal(await finish(current),0);
});
test('expired claims can be finalized once and cannot finish afterward',async()=>{
  const id=await insert(), token=await claim();assert.equal(token.job_id,id);
  await pool.query("UPDATE pv_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1",[id]);
  assert.equal(await finish(token),0);
  const reap=async()=>pool.query(`
    WITH stale AS (SELECT job_id FROM pv_jobs WHERE state='running'
      AND lease_expires_at<=clock_timestamp()
      FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE pv_jobs SET state='failed',claim_token=NULL,lease_expires_at=NULL
    WHERE job_id IN (SELECT job_id FROM stale) RETURNING job_id`);
  const [x,y]=await Promise.all([reap(),reap()]);
  assert.equal(x.rowCount+y.rowCount,1);
  assert.equal((await pool.query('SELECT state FROM pv_jobs WHERE job_id=$1',[id])).rows[0].state,'failed');
  assert.equal(await finish(token),0);
});


test('real store: two concurrent idempotent requests write one job and two audits',async()=>{
  const key=uuid();
  const [a,b]=await Promise.all([queue({key}),queue({key})]);
  assert.equal(a.jobId,b.jobId);
  assert.equal(await auditCount(a.jobId,'requested'),1);
  assert.equal(await auditCount(a.jobId,'replayed'),1);
  const result=await store.claimNext();
  assert.equal(result.jobId,a.jobId);
  assert.equal((await store.finish({claim:result,outcome:'failed'})).state,'failed');
});
test('real store: cross-asset replay is rejected and denial audit is appended',async()=>{
  const key=uuid(),j=await queue({key});
  const before=Number((await pool.query('SELECT count(*) AS n FROM skyhub_pv_job_denied_audit')).rows[0].n);
  await assert.rejects(queue({key,assetId:otherAsset}),JobUnavailable);
  const after=Number((await pool.query('SELECT count(*) AS n FROM skyhub_pv_job_denied_audit')).rows[0].n);
  assert.equal(after,before+1);
  const found=await pool.query('SELECT asset_id FROM skyhub_pv_jobs WHERE job_id=$1',[j.jobId]);
  assert.equal(found.rows[0].asset_id,asset);
  const claim=await store.claimNext();assert.equal(claim.jobId,j.jobId);
  await store.finish({claim,outcome:'failed'});
});
test('real store: two independent workers skip a locked queued row',async()=>{
  const a=await queue(),b=await queue();
  const lock=await pool.connect();
  try{
    await lock.query('BEGIN');
    await lock.query('SELECT job_id FROM skyhub_pv_jobs WHERE job_id=$1 FOR UPDATE',[a.jobId]);
    const c=await store.claimNext();
    assert.equal(c.jobId,b.jobId);
    await store.finish({claim:c,outcome:'failed'});
  }finally{await lock.query('ROLLBACK');lock.release();}
  const c=await store.claimNext();assert.equal(c.jobId,a.jobId);
  await store.finish({claim:c,outcome:'failed'});
});
test('real store: parallel claim operations never claim the same job twice',async()=>{
  const j=await queue();
  const [a,b]=await Promise.all([store.claimNext(),store.claimNext()]);
  assert.equal([a,b].filter(Boolean).length,1);
  assert.equal((a||b).jobId,j.jobId);
  assert.equal(await auditCount(j.jobId,'claimed'),1);
  await store.finish({claim:a||b,outcome:'failed'});
});
test('real store: audit INSERT error rolls back candidate completion',async()=>{
  const j=await queue(),claim=await store.claimNext();assert.equal(claim.jobId,j.jobId);
  await pool.query("CREATE FUNCTION reject_pv_candidate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='candidate_recorded' THEN RAISE EXCEPTION 'blocked'; END IF; RETURN NEW; END $$");
  await pool.query('CREATE TRIGGER reject_pv_candidate BEFORE INSERT ON skyhub_pv_job_audit FOR EACH ROW EXECUTE FUNCTION reject_pv_candidate()');
  try {
    await assert.rejects(store.finish({claim,outcome:'candidate-ready',sourceSha256:sha}),JobUnavailable);
    const r=await pool.query('SELECT state,claim_token FROM skyhub_pv_jobs WHERE job_id=$1',[j.jobId]);
    assert.equal(r.rows[0].state,'running');
    assert.equal(r.rows[0].claim_token,claim.claimToken);
    assert.equal(await auditCount(j.jobId,'candidate_recorded'),0);
  }finally{await pool.query('DROP TRIGGER reject_pv_candidate ON skyhub_pv_job_audit');}
  const result=await store.finish({claim,outcome:'candidate-ready',sourceSha256:sha});
  assert.equal(result.state,'candidate-ready');
  assert.equal(result.radiometryVerified,false);
  assert.equal(result.hardwareValidated,false);
  assert.equal(await auditCount(j.jobId,'candidate_recorded'),1);
});
test('real store: heartbeat/finish race produces immutable terminal state',async()=>{
  const j=await queue(),claim=await store.claimNext();assert.equal(claim.jobId,j.jobId);
  const outcomes=await Promise.allSettled([
    store.heartbeat({claim}),
    store.finish({claim,outcome:'candidate-ready',sourceSha256:sha})
  ]);
  assert.equal(outcomes[1].status,'fulfilled');
  assert.ok(['fulfilled','rejected'].includes(outcomes[0].status));
  const r=await pool.query('SELECT state,claim_token FROM skyhub_pv_jobs WHERE job_id=$1',[j.jobId]);
  assert.equal(r.rows[0].state,'candidate-ready');
  assert.equal(r.rows[0].claim_token,null);
  await assert.rejects(store.heartbeat({claim}),JobUnavailable);
  await assert.rejects(store.finish({claim,outcome:'failed'}),JobUnavailable);
});
test('real store: expired claims cannot finish; two recovery workers log one expiration',async()=>{
  const j=await queue(),claim=await store.claimNext();assert.equal(claim.jobId,j.jobId);
  await pool.query("UPDATE skyhub_pv_jobs SET heartbeat_at=clock_timestamp()-interval '2 hours',lease_expires_at=clock_timestamp()-interval '1 hour' WHERE job_id=$1",[j.jobId]);
  await assert.rejects(store.heartbeat({claim}),JobUnavailable);
  await assert.rejects(store.finish({claim,outcome:'candidate-ready',sourceSha256:sha}),JobUnavailable);
  const [a,b]=await Promise.all([
    store.expireStale({workspaceId:workspace,principal:principal()}),
    store.expireStale({workspaceId:workspace,principal:principal()})
  ]);
  assert.equal(a.expiredCount+b.expiredCount,1);
  assert.equal(await auditCount(j.jobId,'lease_expired'),1);
  assert.equal((await pool.query('SELECT state FROM skyhub_pv_jobs WHERE job_id=$1',[j.jobId])).rows[0].state,'failed');
});
test('real store: workspace and asset FK prevent unauthorized scheduling',async()=>{
  const key=uuid();
  await assert.rejects(queue({key,assetId:uuid()}),JobUnavailable);
  assert.equal(Number((await pool.query('SELECT count(*) AS n FROM skyhub_pv_jobs WHERE idempotency_key=$1',[key])).rows[0].n),0);
  const j=await queue();
  await assert.rejects(store.lookup({workspaceId:otherWorkspace,jobId:j.jobId,principal:principal(otherWorkspace)}),JobUnavailable);
  const result=await store.lookup({workspaceId:workspace,jobId:j.jobId,principal:principal()});
  assert.equal(result.jobId,j.jobId);
  const claim=await store.claimNext();await store.finish({claim,outcome:'failed'});
});
test('real store: job audit and denied audit are append-only',async()=>{
  await assert.rejects(pool.query("DELETE FROM skyhub_pv_job_audit WHERE action='claimed'"));
  await assert.rejects(pool.query('TRUNCATE skyhub_pv_job_audit'));
  await assert.rejects(pool.query('TRUNCATE skyhub_pv_job_denied_audit'));
});
