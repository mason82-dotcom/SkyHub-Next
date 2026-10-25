'use strict';
/* Local, opt-in route library; no backend API, telemetry, or flight dispatch. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)
    module.exports=factory(require('./wpml-editor-core'));
  else root.SkyHubWpmlRouteLibrary=factory(root.SkyHubWpmlPlanner);
})(typeof globalThis==='object'?globalThis:this,function(planner){
  const SCHEMA='skyhub-local-waypoint-library-v1',MAX_ROUTES=32,MAX_REVISIONS=12;
  const MAX_BYTES=512*1024;
  function invalid(){throw new TypeError('Ungültige oder zu große lokale Routenbibliothek');}
  function clone(x){return JSON.parse(JSON.stringify(x));}
  function text(v,max=70){
    if(typeof v!=='string'||!v.trim()||v.length>max||
      /[\u0000-\u001f\u007f]/.test(v))invalid();
    return v.trim();
  }
  function blank(){return {schema:SCHEMA,nextId:1,routes:[]};}
  function onlyKeys(value,allowed){
    if(!value||typeof value!=='object'||Array.isArray(value)||
       Object.keys(value).some(k=>!allowed.includes(k)))invalid();
  }
  function check(db){
    onlyKeys(db,['schema','nextId','routes']);
    if(!db||typeof db!=='object'||Array.isArray(db)||
       db.schema!==SCHEMA||!Number.isSafeInteger(db.nextId)||db.nextId<1||
       !Array.isArray(db.routes)||db.routes.length>MAX_ROUTES)invalid();
    const ids=new Set();
    for(const route of db.routes){
      onlyKeys(route,['id','name','folder','revisions']);
      if(!route||typeof route!=='object'||!Number.isSafeInteger(route.id)||
         route.id<1||route.id>=db.nextId||ids.has(route.id))invalid();
      ids.add(route.id);
      text(route.name);text(route.folder,40);
      if(!Array.isArray(route.revisions)||route.revisions.length<1||
         route.revisions.length>MAX_REVISIONS)invalid();
      for(let i=0;i<route.revisions.length;i++){
        const v=route.revisions[i];
        onlyKeys(v,['revision','savedAt','plan','flightReady']);
        onlyKeys(v.plan,['name','model','speed','transitionSpeed',
          'takeoffHeight','finishAction','timestamp','waypoints',
          'intervalPhotos','actionGroups']);
        if(!Array.isArray(v.plan.waypoints))invalid();
        for(const p of v.plan.waypoints)
          onlyKeys(p,['lat','lon','height','photo','ellipsoidHeight']);
        if(v.plan.intervalPhotos!==undefined)
          onlyKeys(v.plan.intervalPhotos,
            ['type','interval','cameraMinIntervalSeconds']);
        if(!v||v.revision!==i+1||!Number.isSafeInteger(v.savedAt)||
           v.savedAt<0||v.flightReady!==false)invalid();
        try{planner.normalize(v.plan);}catch{invalid();}
        if(v.plan.name!==route.revisions[i].plan.name)invalid();
      }
    }
    if(JSON.stringify(db).length>MAX_BYTES)invalid();
    return clone(db);
  }
  function save(db,options){
    const state=check(db);
    if(!options||typeof options!=='object')invalid();
    const name=text(options.name);
    const folder=text(options.folder||'Allgemein',40);
    let normalized;
    try{normalized=planner.normalize(options.plan);}catch{invalid();}
    // Only the editable subset is persisted. Never store external model objects,
    // KMZ bytes, unknown properties, or execution/flight-ready approval flags.
    const plan={
      name:normalized.name,model:normalized.modelKey,speed:normalized.speed,
      transitionSpeed:normalized.transitionSpeed,takeoffHeight:normalized.takeoffHeight,
      finishAction:normalized.finishAction,timestamp:normalized.timestamp,
      waypoints:normalized.waypoints.map(p=>({
        lat:p.lat,lon:p.lon,height:p.height,photo:p.photo,
        ...(p.ellipsoidHeight===null?{}:{ellipsoidHeight:p.ellipsoidHeight})
      })),
      ...(normalized.intervalPhotos?{intervalPhotos:{
        type:normalized.intervalPhotos.type,interval:normalized.intervalPhotos.interval,
        ...(normalized.intervalPhotos.cameraMinIntervalSeconds===null?{}:
          {cameraMinIntervalSeconds:normalized.intervalPhotos.cameraMinIntervalSeconds})
      }}:{}),
      ...(normalized.actionGroups.length?{actionGroups:normalized.actionGroups}: {})
    };
    const id=options.routeId;
    let route;
    if(id===undefined||id===null){
      if(state.routes.length===MAX_ROUTES)invalid();
      route={id:state.nextId++,name,folder,revisions:[]};
      state.routes.push(route);
    }else{
      if(!Number.isSafeInteger(id))invalid();
      route=state.routes.find(r=>r.id===id);
      if(!route||route.revisions.length>=MAX_REVISIONS)invalid();
      route.name=name;route.folder=folder;
    }
    const now=options.savedAt??Date.now();
    if(!Number.isSafeInteger(now)||now<0||now>9999999999999)invalid();
    route.revisions.push({revision:route.revisions.length+1,savedAt:now,
      plan,flightReady:false});
    const validated=check(state);
    return {library:validated,routeId:route.id,revision:route.revisions.length,flightReady:false};
  }
  function find(db,id,revision){
    const state=check(db);
    const r=state.routes.find(x=>x.id===id);
    if(!r)invalid();
    const v=revision==null?r.revisions[r.revisions.length-1]:
      r.revisions.find(x=>x.revision===revision);
    if(!v)invalid();
    return {id:r.id,name:r.name,folder:r.folder,revision:v.revision,
      savedAt:v.savedAt,plan:clone(v.plan),flightReady:false};
  }
  function list(db){
    return check(db).routes.map(r=>({id:r.id,name:r.name,folder:r.folder,
      revisionCount:r.revisions.length,latestRevision:r.revisions.length,
      latestSavedAt:r.revisions[r.revisions.length-1].savedAt,flightReady:false}));
  }
  function compareRevisions(db,id,leftRevision,rightRevision){
    const left=find(db,id,leftRevision),right=find(db,id,rightRevision);
    const a=left.plan,b=right.plan;
    const n=Math.max(a.waypoints.length,b.waypoints.length);
    let positionChanges=0,heightChanges=0,photoChanges=0;
    for(let i=0;i<n;i++){
      const x=a.waypoints[i],y=b.waypoints[i];
      if(!x||!y||x.lat!==y.lat||x.lon!==y.lon)positionChanges++;
      if(!x||!y||x.height!==y.height||x.ellipsoidHeight!==y.ellipsoidHeight)
        heightChanges++;
      if(!x||!y||x.photo!==y.photo)photoChanges++;
    }
    const actionChanges=JSON.stringify(a.actionGroups||[])!==
      JSON.stringify(b.actionGroups||[]);
    const intervalChanges=JSON.stringify(a.intervalPhotos||null)!==
      JSON.stringify(b.intervalPhotos||null);
    const profileChanges=['model','speed','transitionSpeed','takeoffHeight',
      'finishAction'].filter(k=>a[k]!==b[k]);
    return Object.freeze({
      schema:'skyhub-offline-revision-compare-v1',
      leftRevision:left.revision,rightRevision:right.revision,
      leftWaypointCount:a.waypoints.length,
      rightWaypointCount:b.waypoints.length,
      positionChanges,heightChanges,photoChanges,
      actionGroupsChanged:actionChanges,intervalCaptureChanged:intervalChanges,
      flightProfileFieldsChanged:Object.freeze(profileChanges),
      nameChanged:a.name!==b.name,
      requiresReview:true,flightReady:false,dispatchAllowed:false,
      privacy:'aggregate counts and fixed field names only; no raw GPS or mission values'
    });
  }
  function restoreRevision(db,routeId,revision,savedAt=Date.now()){
    const state=check(db),original=find(state,routeId,revision);
    const route=state.routes.find(r=>r.id===routeId);
    if(route.revisions.length>=MAX_REVISIONS)invalid();
    // Append an independent copy as a new revision; older revisions untouched.
    return save(state,{
      routeId,name:route.name,folder:route.folder,plan:original.plan,savedAt
    });
  }
  function remove(db,id){
    const state=check(db),at=state.routes.findIndex(r=>r.id===id);
    if(at<0)invalid();
    state.routes.splice(at,1);return check(state);
  }
  function copy(db,id,options={}){
    const origin=find(db,id,options.revision);
    return save(db,{name:options.name||origin.name+' Kopie',
      folder:options.folder||origin.folder,plan:origin.plan,savedAt:options.savedAt});
  }
  function taskSnapshot(db,routeId,revision){
    // Not a schedulable task, only a detached immutable reference copy.
    const ref=find(db,routeId,revision);
    const artifact=planner.build(ref.plan);
    const freezeDeep=value=>{
      if(value&&typeof value==='object'){
        Object.values(value).forEach(freezeDeep);
        Object.freeze(value);
      }
      return value;
    };
    return freezeDeep({
      schema:'skyhub-offline-task-snapshot-v1',
      sourceRouteId:ref.id,sourceRevision:ref.revision,
      capturedAt:ref.savedAt,
      plan:ref.plan,
      waypointCount:artifact.summary.waypointCount,
      actionCount:artifact.summary.orderedActionCount,
      previewOnly:true,flightReady:false,hardwareVerified:false,
      dispatchAllowed:false
    });
  }
  function load(raw){
    if(typeof raw!=='string'||raw.length>MAX_BYTES)invalid();
    let obj;
    try{obj=JSON.parse(raw);}catch{invalid();}
    return check(obj);
  }
  function serialize(db){return JSON.stringify(check(db));}
  return Object.freeze({SCHEMA,blank,check,save,find,list,compareRevisions,restoreRevision,remove,copy,taskSnapshot,load,serialize,
    MAX_ROUTES,MAX_REVISIONS});
});
