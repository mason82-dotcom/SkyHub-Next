'use strict';
// ISOLATED P0 CONTRACT — deliberately NOT required by backend/server.js.
// Do not mount it until an independent human-operator IdP, a non-BYPASSRLS
// database role, reviewed RLS policies, audit retention and deployment
// controls have separately passed security review.
const crypto=require('node:crypto');
const local=require('../frontend/public/wpml-route-library-core');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REVISIONS=12,MAX_ROUTES=32;
class RouteError extends Error {
  constructor(code){
    super('WPML route operation '+code);
    this.name='RouteError';this.code=code;
  }
}
function requireId(x){if(typeof x!=='string'||!UUID.test(x))throw new RouteError('invalid');return x;}
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function validatePlan(name,plan){
  // Reject unknown fields BEFORE the normalizer could discard them. This is
  // critical for untrusted API input with forged dispatch/security fields.
  const allowed=['name','model','speed','transitionSpeed','takeoffHeight',
    'finishAction','timestamp','waypoints','intervalPhotos','actionGroups'];
  const keys=(v,whitelist)=>{
    if(!v||typeof v!=='object'||Array.isArray(v)||
       Object.getPrototypeOf(v)!==Object.prototype||
       Object.keys(v).some(k=>!whitelist.includes(k)))
      throw new RouteError('invalid');
  };
  keys(plan,allowed);
  if(!Array.isArray(plan.waypoints))throw new RouteError('invalid');
  for(const waypoint of plan.waypoints)
    keys(waypoint,['lat','lon','height','photo','ellipsoidHeight']);
  if(plan.intervalPhotos!==undefined)keys(plan.intervalPhotos,
    ['type','interval','cameraMinIntervalSeconds']);
  if(plan.actionGroups!==undefined){
    if(!Array.isArray(plan.actionGroups))throw new RouteError('invalid');
    for(const group of plan.actionGroups){
      keys(group,['index','actions']);
      if(!Array.isArray(group.actions))throw new RouteError('invalid');
      for(const action of group.actions)
        keys(action,['type','seconds','degrees']);
    }
  }
  // Reuse the exact offline allowlist and bounded waypoint/action model.
  try{
    const a=local.save(local.blank(),{name,plan,savedAt:1});
    return a.library.routes[0].revisions[0].plan;
  }catch{throw new RouteError('invalid');}
}
function hash(plan){return crypto.createHash('sha256').update(canonical(plan)).digest();}
function verifyPlan(name,plan,digest){
  const checked=validatePlan(name,plan);
  if(!Buffer.isBuffer(digest)||digest.length!==32||
     !crypto.timingSafeEqual(hash(checked),digest))
    throw new RouteError('unavailable');
  return checked;
}
function validateActor(actor,workspaceId){
  // Never derive these fields from HTTP headers, DJI pairing tokens,
  // dashboard-view tokens, or request bodies. Only a separately verified
  // resolver may return this server-side principal.
  return !!actor&&Object.getPrototypeOf(actor)===Object.prototype&&
    actor.kind==='human'&&actor.source==='independent-operator-auth'&&
    ['operator','admin'].includes(actor.role)&&
    typeof actor.workspaceId==='string'&&actor.workspaceId===workspaceId&&
    UUID.test(actor.workspaceId)&&typeof actor.id==='string'&&UUID.test(actor.id);
}
function createWpmlRouteStore(pool){
  if(!pool||typeof pool.connect!=='function')throw new TypeError('PostgreSQL pool required');
  async function transaction(callback){
    let client,started=false;
    try{
      client=await pool.connect();
      await client.query('BEGIN');
      started=true;
      const out=await callback(client);
      await client.query('COMMIT');started=false;
      return out;
    }catch(err){
      if(started){try{await client.query('ROLLBACK');}catch{}}
      // Never expose driver errors: SQL text, GPS/route names and database
      // topology may appear in their message/detail fields.
      if(err instanceof RouteError)throw err;
      throw new RouteError('unavailable');
    }finally{
      if(client){try{client.release();}catch{}}
    }
  }
  return Object.freeze({
    async create({workspaceId,actorId,routeId,name,plan}){
      requireId(workspaceId);requireId(actorId);requireId(routeId);
      const normalized=validatePlan(name,plan);
      name=normalized.name;
      return transaction(async client=>{
        // Serialize new-route creation within each workspace so the
        // 32-route limit cannot be bypassed by concurrent transactions.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
          [workspaceId]);
        const existing=await client.query(
          'SELECT COUNT(*)::int AS count FROM skyhub_wpml_routes '+
          'WHERE workspace_id=$1 AND archived_at IS NULL',[workspaceId]);
        if(existing.rows[0].count>=MAX_ROUTES)throw new RouteError('capacity');
        await client.query(
          'INSERT INTO skyhub_wpml_routes '+
          '(workspace_id,route_id,route_name,created_by,latest_revision) '+
          'VALUES ($1,$2,$3,$4,1)',
          [workspaceId,routeId,name,actorId]);
        await client.query(
          'INSERT INTO skyhub_wpml_route_revisions '+
          '(workspace_id,route_id,revision,plan,plan_sha256,author_id) '+
          'VALUES ($1,$2,1,$3::jsonb,$4,$5)',
          [workspaceId,routeId,JSON.stringify(normalized),hash(normalized),actorId]);
        // The audit entry MUST commit in the same transaction as the route
        // and immutable revision. An audit failure rolls everything back.
        await client.query(
          'INSERT INTO skyhub_wpml_route_audit '+
          '(workspace_id,route_id,revision,actor_id,event_type) '+
          "VALUES ($1,$2,1,$3,'created')",
          [workspaceId,routeId,actorId]);
        return Object.freeze({routeId,revision:1,flightReady:false,dispatchAllowed:false});
      });
    },
    async append({workspaceId,actorId,routeId,expectedRevision,plan}){
      requireId(workspaceId);requireId(actorId);requireId(routeId);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1||
         expectedRevision>=MAX_REVISIONS)throw new RouteError('invalid');
      return transaction(async client=>{
        const row=await client.query(
          'SELECT latest_revision,route_name FROM skyhub_wpml_routes '+
          'WHERE workspace_id=$1 AND route_id=$2 AND archived_at IS NULL FOR UPDATE',
          [workspaceId,routeId]);
        if(row.rowCount!==1)throw new RouteError('not-found');
        const current=Number(row.rows[0].latest_revision);
        if(current!==expectedRevision)throw new RouteError('conflict');
        const normalized=validatePlan(row.rows[0].route_name,plan);
        const revision=current+1;
        const updated=await client.query(
          'UPDATE skyhub_wpml_routes SET latest_revision=$3 '+
          'WHERE workspace_id=$1 AND route_id=$2 AND latest_revision=$4',
          [workspaceId,routeId,revision,expectedRevision]);
        if(updated.rowCount!==1)throw new RouteError('conflict');
        await client.query(
          'INSERT INTO skyhub_wpml_route_revisions '+
          '(workspace_id,route_id,revision,plan,plan_sha256,author_id) '+
          'VALUES ($1,$2,$3,$4::jsonb,$5,$6)',
          [workspaceId,routeId,revision,JSON.stringify(normalized),hash(normalized),actorId]);
        await client.query(
          'INSERT INTO skyhub_wpml_route_audit '+
          '(workspace_id,route_id,revision,actor_id,event_type) '+
          "VALUES ($1,$2,$3,$4,'revision_appended')",
          [workspaceId,routeId,revision,actorId]);
        return Object.freeze({routeId,revision,flightReady:false,dispatchAllowed:false});
      });
    },
    async list({workspaceId}){
      requireId(workspaceId);
      return transaction(async client=>{
        const data=await client.query(
          'SELECT route_id,route_name,latest_revision FROM skyhub_wpml_routes '+
          'WHERE workspace_id=$1 AND archived_at IS NULL ORDER BY route_id LIMIT 32',
          [workspaceId]);
        return data.rows.map(row=>Object.freeze({
          routeId:row.route_id,name:row.route_name,
          latestRevision:Number(row.latest_revision),
          flightReady:false,dispatchAllowed:false
        }));
      });
    },
    async read({workspaceId,routeId,revision}){
      requireId(workspaceId);requireId(routeId);
      if(!Number.isSafeInteger(revision)||revision<1||revision>MAX_REVISIONS)
        throw new RouteError('invalid');
      return transaction(async client=>{
        const result=await client.query(
          'SELECT r.route_name,v.plan,v.plan_sha256 FROM skyhub_wpml_routes r '+
          'JOIN skyhub_wpml_route_revisions v ON '+
          'v.workspace_id=r.workspace_id AND v.route_id=r.route_id '+
          'WHERE r.workspace_id=$1 AND r.route_id=$2 AND '+
          'r.archived_at IS NULL AND v.revision=$3',
          [workspaceId,routeId,revision]);
        if(result.rowCount!==1)throw new RouteError('not-found');
        const row=result.rows[0];
        return Object.freeze({routeId,revision,plan:verifyPlan(row.route_name,
          row.plan,row.plan_sha256),flightReady:false,dispatchAllowed:false,
          previewOnly:true});
      });
    }
  });
}
function createWpmlRouteService({pool,authorize}={}){
  if(typeof authorize!=='function')throw new TypeError('Independent operator resolver required');
  const store=createWpmlRouteStore(pool);
  async function permitted({credential,workspaceId}){
    requireId(workspaceId);
    // The credential is opaque to this module, never included in SQL/logs.
    let actor;
    try{actor=await authorize(credential);}catch{throw new RouteError('unauthorized');}
    if(!validateActor(actor,workspaceId))throw new RouteError('unauthorized');
    return actor;
  }
  return Object.freeze({
    async createRoute(req){
      const actor=await permitted(req);
      return store.create({workspaceId:req.workspaceId,actorId:actor.id,
        routeId:crypto.randomUUID(),name:req.name,plan:req.plan});
    },
    async appendRevision(req){
      const actor=await permitted(req);
      return store.append({workspaceId:req.workspaceId,actorId:actor.id,
        routeId:req.routeId,expectedRevision:req.expectedRevision,plan:req.plan});
    },
    async listRoutes(req){
      await permitted(req);
      return store.list({workspaceId:req.workspaceId});
    },
    async readRevision(req){
      await permitted(req);
      return store.read({workspaceId:req.workspaceId,routeId:req.routeId,
        revision:req.revision});
    }
  });
}
module.exports={createWpmlRouteStore,createWpmlRouteService,RouteError,
  validateActor,validatePlan,canonical};
