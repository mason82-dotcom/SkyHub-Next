'use strict';
/* Read-only aggregate comparison of two locally parsed WPML KMZ files.
 * No GPS values, names, content hashes or secret data in the rendered summary.
 * A partial editor-model comparison is NOT a DJI semantic equivalence check.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.SkyHubWpmlVersionCompare=factory();
})(typeof globalThis==='object'?globalThis:this,function(){
  const PROFILE=['model','speed','takeoffHeight','rthHeight','finishAction'];
  function compare(before,after){
    if(!before||!after||!Array.isArray(before.plan?.waypoints)||
       !Array.isArray(after.plan?.waypoints)||
       before.plan.waypoints.length>500||after.plan.waypoints.length>500)
      throw new TypeError('Versionsvergleich benötigt zwei geprüfte Wegpunkt-KMZ.');
    const a=before.plan,b=after.plan;
    const overlap=Math.min(a.waypoints.length,b.waypoints.length);
    let positionChanges=0,heightChanges=0,photoChanges=0;
    for(let i=0;i<overlap;i++){
      const x=a.waypoints[i],y=b.waypoints[i];
      if(x.lat!==y.lat||x.lon!==y.lon)positionChanges++;
      if(x.height!==y.height||x.ellipsoidHeight!==y.ellipsoidHeight)heightChanges++;
      if(x.photo!==y.photo)photoChanges++;
    }
    return Object.freeze({
      previousWaypoints:a.waypoints.length,currentWaypoints:b.waypoints.length,
      addedWaypoints:Math.max(0,b.waypoints.length-a.waypoints.length),
      removedWaypoints:Math.max(0,a.waypoints.length-b.waypoints.length),
      positionChanges,heightChanges,photoChanges,
      profileChanges:Object.freeze(PROFILE.filter(k=>a[k]!==b[k])),
      intervalChanged:JSON.stringify(a.intervalPhotos||null)!==JSON.stringify(b.intervalPhotos||null),
      partial:Boolean(before.notes?.length||after.notes?.length),
      flightReady:false,dispatchAllowed:false
    });
  }
  return Object.freeze({compare});
});
