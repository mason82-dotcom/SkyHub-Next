'use strict';
// Map elements: write path (DJI Cloud API 1.18, pilot-to-cloud):
//   https/map-elements/create  POST   /map/api/v1/workspaces/{workspace_id}/element-groups/{group_id}/elements  {id,name,resource}
//   https/map-elements/update  PUT    /map/api/v1/workspaces/{workspace_id}/elements/{id}                       {name?,content?}
//   https/map-elements/delete  DELETE /map/api/v1/workspaces/{workspace_id}/elements/{id}
//   → {code:0,message:"success",data:{id}}
//   websocket/map-elements/message-push: map_element_create / map_element_update / map_element_delete / map_group_refresh
//   {biz_code, version:"1.0", timestamp, data:{id, group_id, name, resource:{type, user_name, content}}}
// One shared, distributed and unlocked group per workspace ("SkyHub", group type 2 = shared with Pilot 2) holds the elements.
// Pilot 2 writes only into distributed, unlocked groups (opt-in SKYHUB_DJI_MAP_WRITES_ENABLED); SkyHub's own page writes from the
// home LAN (same-origin gate). Every change is audited (dji_map_element_audit, migration 002) and pushed to all RCs.
const {createMapMutationStore,normalizedElement}=require('./map-element-mutation');

const SHARED_GROUP='skyhub-shared';
const ELEMENT_ID=/^[A-Za-z0-9_.:-]{1,128}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// DJI colour palette (create.html; labels as published, the hex values are what Pilot 2 shows).
const COLORS=Object.freeze({'#2D8CF0':'Blau','#19BE6B':'Grün','#FFBB00':'Gelb','#B620E0':'Orange (DJI: violett)','#E23C39':'Rot','#212121':'Schwarz'});

class MapWriteError extends Error{constructor(message,status=400){super(message);this.status=status;}}

function wireElement(row,userName){
  const properties={};
  if(row.color)properties.color=row.color;
  if(typeof row.clamp_to_ground==='boolean')properties.clampToGround=row.clamp_to_ground;
  if(typeof row.is_3d==='boolean')properties.is3d=row.is_3d;
  return {id:row.element_id,group_id:row.group_id,name:row.name,
    resource:{type:row.resource_type??0,user_name:userName||'',content:{type:'Feature',properties,geometry:row.geometry}}};
}
const resourceTypeOf=g=>g&&g.type==='Point'?0:g&&g.type==='LineString'?1:g&&g.type==='Polygon'?2:null;

function createMapElementWriter({pool,workspaceId,publish=()=>{},clock=Date.now,log=console}){
  if(!pool||typeof pool.query!=='function')throw new TypeError('Database pool required');
  if(typeof workspaceId!=='string'||!UUID.test(workspaceId))throw new TypeError('Workspace UUID required');
  const mutations=createMapMutationStore(pool,{clock});
  const message=(biz,data)=>({biz_code:biz,version:'1.0',timestamp:clock(),data});

  async function ensureGroup(){
    await pool.query('INSERT INTO dji_map_element_groups (workspace_id,group_id,name,group_type,is_locked,is_distributed,create_time) '+
      'VALUES ($1,$2,$3,2,false,true,$4) ON CONFLICT DO NOTHING',[workspaceId,SHARED_GROUP,'SkyHub',clock()]);
  }
  async function group(groupId){
    const {rows}=await pool.query('SELECT group_id,is_locked,is_distributed FROM dji_map_element_groups WHERE workspace_id=$1 AND group_id=$2',
      [workspaceId,groupId]);
    return rows[0]||null;
  }
  async function current(elementId){
    const {rows}=await pool.query('SELECT e.*,g.is_distributed,g.is_locked FROM dji_map_elements e JOIN dji_map_element_groups g '+
      'ON g.workspace_id=e.workspace_id AND g.group_id=e.group_id WHERE e.workspace_id=$1 AND e.element_id=$2',[workspaceId,elementId]);
    if(rows.length>1)throw new MapWriteError('Element-ID mehrdeutig',409);
    return rows[0]||null;
  }
  // actor: {kind:'pilot'|'skyhub', id, name}. Pilot 2 may only touch distributed groups.
  const mutationActor=actor=>({role:'operator',workspaceId,id:(actor.kind+':'+actor.id).slice(0,128)});
  function check(status){
    if(status==='ok')return;
    const map={denied:[403,'Keine Schreibberechtigung'],invalid:[400,'Element ungültig (Geometrie, Name oder Farbe)'],
      not_found:[404,'Gruppe nicht gefunden'],locked:[423,'Gruppe ist gesperrt'],conflict:[409,'Element wurde gleichzeitig geändert']};
    const [code,text]=map[status]||[500,'Speicherfehler'];
    throw new MapWriteError(text,code);
  }
  async function create(actor,groupId,input){
    if(!input||typeof input!=='object')throw new MapWriteError('Element fehlt');
    if(typeof input.id!=='string'||!ELEMENT_ID.test(input.id))throw new MapWriteError('Element-ID ungültig');
    const g=await group(groupId);
    if(!g)throw new MapWriteError('Gruppe nicht gefunden',404);
    if(actor.kind==='pilot'&&g.is_distributed!==true)throw new MapWriteError('Gruppe ist nicht für Pilot 2 freigegeben',403);
    const el={id:input.id,name:input.name,resource:input.resource};
    const r=await mutations.mutate({actor:mutationActor(actor),workspaceId,groupId,elementId:input.id,action:'create',element:el});
    if(r.status==='conflict')throw new MapWriteError('Element-ID existiert bereits',409);
    check(r.status);
    const row=await current(input.id);
    publish(message('map_element_create',wireElement(row,actor.name)));
    return {id:input.id,revision:r.revision};
  }
  async function update(actor,elementId,input){
    if(typeof elementId!=='string'||!ELEMENT_ID.test(elementId))throw new MapWriteError('Element-ID ungültig');
    for(let attempt=0;attempt<2;attempt++){
      const row=await current(elementId);
      if(!row)throw new MapWriteError('Element nicht gefunden',404);
      if(actor.kind==='pilot'&&row.is_distributed!==true)throw new MapWriteError('Gruppe ist nicht für Pilot 2 freigegeben',403);
      const old=wireElement(row);
      const content=input&&input.content&&typeof input.content==='object'?input.content:old.resource.content;
      const geometryType=resourceTypeOf(content.geometry)??row.resource_type;
      const el={id:elementId,name:input&&typeof input.name==='string'?input.name:row.name,resource:{type:geometryType,content}};
      if(!normalizedElement(row.group_id,elementId,el))throw new MapWriteError('Element ungültig (Geometrie, Name oder Farbe)');
      const r=await mutations.mutate({actor:mutationActor(actor),workspaceId,groupId:row.group_id,elementId,action:'update',
        expectedRevision:Number(row.revision),element:el});
      if(r.status==='conflict'&&attempt===0)continue;             // one retry against a concurrent edit
      check(r.status);
      publish(message('map_element_update',wireElement(await current(elementId),actor.name)));
      return {id:elementId,revision:r.revision};
    }
    throw new MapWriteError('Element wurde gleichzeitig geändert',409);
  }
  async function remove(actor,elementId){
    if(typeof elementId!=='string'||!ELEMENT_ID.test(elementId))throw new MapWriteError('Element-ID ungültig');
    const row=await current(elementId);
    if(!row)throw new MapWriteError('Element nicht gefunden',404);
    if(actor.kind==='pilot'&&row.is_distributed!==true)throw new MapWriteError('Gruppe ist nicht für Pilot 2 freigegeben',403);
    const r=await mutations.mutate({actor:mutationActor(actor),workspaceId,groupId:row.group_id,elementId,action:'delete',
      expectedRevision:Number(row.revision)});
    check(r.status);
    publish(message('map_element_delete',{id:elementId,group_id:row.group_id}));
    return {id:elementId};
  }
  async function list(){
    const {rows}=await pool.query('SELECT e.*,g.name AS group_name FROM dji_map_elements e JOIN dji_map_element_groups g '+
      'ON g.workspace_id=e.workspace_id AND g.group_id=e.group_id WHERE e.workspace_id=$1 ORDER BY e.update_time DESC NULLS LAST LIMIT 500',[workspaceId]);
    return rows.map(r=>({...wireElement(r),groupName:r.group_name,revision:Number(r.revision),updateTime:r.update_time!==null?Number(r.update_time):null}));
  }
  return {ensureGroup,create,update,remove,list,SHARED_GROUP};
}

// DJI HTTPS responses: {code, message, data}. DJI defines no error codes for map elements; non-zero code + HTTP status.
const djiOk=(res,data)=>res.json({code:0,message:'success',data});
const djiFail=(res,err)=>res.status(err.status||500).json({code:err.status||500,message:err instanceof MapWriteError?err.message:'Speicherfehler',data:{}});

function registerPilotMapWrites(app,{writer,workspaceId,authorize,log=console}){
  const auth=async(req,res)=>{
    if(!req.secure){res.status(403).json({code:403,message:'HTTPS required',data:{}});return null;}
    if(req.params.workspaceId!==workspaceId){res.status(404).json({code:404,message:'Workspace not found',data:{}});return null;}
    let p=null;
    try{p=await authorize(req.headers['x-auth-token']);}catch{res.status(503).json({code:503,message:'Authorization unavailable',data:{}});return null;}
    if(!p||p.workspaceId!==workspaceId||p.role!=='pilot'){res.status(401).json({code:401,message:'Unauthorized',data:{}});return null;}
    return {kind:'pilot',id:'rc',name:'Pilot 2'};
  };
  const wrap=fn=>async(req,res)=>{
    const actor=await auth(req,res);if(!actor)return;
    try{djiOk(res,await fn(actor,req));}
    catch(err){if(!(err instanceof MapWriteError))log.error('[map elements]',err.message);djiFail(res,err);}
  };
  const body=req=>req.body&&typeof req.body==='object'?req.body:{};
  app.post('/map/api/v1/workspaces/:workspaceId/element-groups/:groupId/elements',wrap(async(a,req)=>{
    const b=body(req);
    // map module elementPreName/userName: Pilot 2 sends user_name in resource; keep it for the push to the other RCs.
    if(typeof b.resource?.user_name==='string')a.name=b.resource.user_name.slice(0,64);
    return {id:(await writer.create(a,req.params.groupId,b)).id};
  }));
  app.put('/map/api/v1/workspaces/:workspaceId/elements/:id',wrap(async(a,req)=>({id:(await writer.update(a,req.params.id,body(req))).id})));
  app.delete('/map/api/v1/workspaces/:workspaceId/elements/:id',wrap(async(a,req)=>({id:(await writer.remove(a,req.params.id)).id})));
}

// SkyHub page (home LAN): list, create, update, delete in the shared group.
function createMapElementRouter({express,writer,log=console}){
  const router=express.Router();
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
  const actor=req=>({kind:'skyhub',id:String(req.ip||'lan').replace(/[^\w.:-]/g,'').slice(0,64)||'lan',name:'SkyHub'});
  const act=fn=>async(req,res)=>{
    try{res.json(await fn(req));}
    catch(err){if(!(err instanceof MapWriteError))log.error('[map elements]',err.message);
      res.status(err.status||500).json({error:err instanceof MapWriteError?err.message:'Speicherfehler'});}
  };
  router.get('/',act(async()=>({group:writer.SHARED_GROUP,colors:COLORS,elements:await writer.list()})));
  router.post('/',act(async req=>{
    const b=req.body||{};
    const id=require('node:crypto').randomUUID();
    return writer.create(actor(req),writer.SHARED_GROUP,{id,name:b.name,resource:{type:resourceTypeOf(b.geometry)??0,
      content:{type:'Feature',properties:{color:b.color,clampToGround:true},geometry:b.geometry}}});
  }));
  router.put('/:id',act(async req=>{
    const b=req.body||{};
    return writer.update(actor(req),req.params.id,{name:b.name,...(b.geometry?{content:{type:'Feature',
      properties:{color:b.color,clampToGround:true},geometry:b.geometry}}:{})});
  }));
  router.delete('/:id',act(async req=>writer.remove(actor(req),req.params.id)));
  return router;
}

module.exports={createMapElementWriter,registerPilotMapWrites,createMapElementRouter,wireElement,COLORS,SHARED_GROUP,MapWriteError};
