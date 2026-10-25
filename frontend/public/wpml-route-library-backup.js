'use strict';
/* Explicit, local-only waypoint route backups. The JSON contains raw GPS.
 * No cloud, authentication, auto-save, mission upload, or flight controls. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)
    module.exports=factory(require('./wpml-route-library-core'),
      require('./wpml-waylines-reference'));
  else root.SkyHubWpmlRouteBackup=factory(root.SkyHubWpmlRouteLibrary,
    root.SkyHubWpmlWaylinesReference);
})(typeof globalThis==='object'?globalThis:this,function(library,jsonParser){
  const SCHEMA='skyhub-local-waypoint-backup-v1';
  const MAX_SIZE=512*1024;
  function invalid(){throw new TypeError('Ungültige SkyHub-Routensicherung');}
  function strict(obj,keys){
    if(!obj||typeof obj!=='object'||Array.isArray(obj)||
       Object.getPrototypeOf(obj)!==Object.prototype||
       Object.keys(obj).some(k=>!keys.includes(k)))invalid();
  }
  function preview(db){
    const validated=library.check(db);
    const summary=library.list(validated);
    let revisions=0,waypoints=0,actionGroups=0;
    for(const r of validated.routes){
      revisions+=r.revisions.length;
      for(const rev of r.revisions){
        waypoints+=rev.plan.waypoints.length;
        actionGroups+=(rev.plan.actionGroups||[]).length;
      }
    }
    return Object.freeze({
      schema:'skyhub-local-waypoint-backup-preview-v1',
      routeCount:summary.length,revisionCount:revisions,
      waypointOccurrences:waypoints,actionGroupCount:actionGroups,
      containsUnencryptedCoordinates:true,
      verifiedPilot2Hardware:false,flightReady:false,dispatchAllowed:false,
      storageImpact:'replace-all-local-routes-after-explicit-confirmation'
    });
  }
  function byteLength(raw){return new TextEncoder().encode(raw).byteLength;}
  function exportBackup(db){
    const validated=library.check(db);
    const data=JSON.stringify({schema:SCHEMA,library:validated});
    // Guard UTF-8 file size, not just JS UTF-16 code unit length.
    if(byteLength(data)>MAX_SIZE)invalid();
    return {content:data,preview:preview(validated)};
  }
  function inspectBackup(raw){
    if(typeof raw!=='string'||byteLength(raw)>MAX_SIZE||!jsonParser||
       typeof jsonParser.parseJson!=='function')invalid();
    let parsed;
    try{parsed=jsonParser.parseJson(raw,MAX_SIZE);}catch{invalid();}
    strict(parsed,['schema','library']);
    if(parsed.schema!==SCHEMA)invalid();
    let loaded;
    try{loaded=library.load(JSON.stringify(parsed.library));}catch{invalid();}
    // Return detached data; caller must explicitly stage and confirm replacement.
    return {library:loaded,preview:preview(loaded)};
  }
  return Object.freeze({SCHEMA,MAX_SIZE,preview,exportBackup,inspectBackup});
});
