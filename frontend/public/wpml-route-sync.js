'use strict';
/* Explicitly enabled, one-way browser localStorage -> existing MinIO WPML KMZ store.
 * Never dispatches DJI tasks, overwrites browser routes, or deletes remote files.
 * An enabled browser retries unsynced revisions on the next visit/local save.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.SkyHubWpmlRouteSync=factory();
})(typeof globalThis==='object'?globalThis:this,function(){
  const ENABLED_KEY='skyhub.wpml.route-sync.enabled.v1';
  const RECEIPTS_KEY='skyhub.wpml.route-sync.receipts.v1';
  const HEX=/^[0-9a-f]{64}$/;
  function missionName(name,routeId,revision,sha){
    if(!HEX.test(sha)||!Number.isSafeInteger(routeId)||routeId<1||
       !Number.isSafeInteger(revision)||revision<1)throw new TypeError('Invalid sync identity');
    const suffix=' R'+routeId+' V'+revision+' H'+sha.slice(0,16);
    const clean=String(name).replace(/[<>:"/|?*._\\\u0000-\u001f\u007f]/g,' ')
      .replace(/\s+/g,' ').trim();
    const prefix=clean.slice(0,64-suffix.length).trim()||'Route';
    const value=prefix+suffix;
    if(value.length>64)throw new TypeError('Mission name exceeds DJI limit');
    return value;
  }
  function create({storage,library,planner,store,cryptoApi,onStatus=()=>{}}){
    if(!storage||!library||!planner||!store||!cryptoApi?.subtle)
      throw new TypeError('Missing route sync dependencies');
    const enabled=()=>storage.getItem(ENABLED_KEY)==='enabled';
    function setEnabled(value){
      storage.setItem(ENABLED_KEY,value?'enabled':'disabled');
      onStatus({phase:value?'enabled':'disabled'});
    }
    function receipts(){
      let data;
      try{data=JSON.parse(storage.getItem(RECEIPTS_KEY)||'[]');}catch{return new Set();}
      if(!Array.isArray(data)||data.length>library.MAX_ROUTES*library.MAX_REVISIONS||
         data.some(v=>typeof v!=='string'||!HEX.test(v)))return new Set();
      return new Set(data);
    }
    function saveReceipt(sha,previous){
      // Acknowledgement is written ONLY after a successful, validated server response.
      previous.add(sha);
      storage.setItem(RECEIPTS_KEY,JSON.stringify([...previous]));
    }
    async function checksum(bytes){
      const digest=await cryptoApi.subtle.digest('SHA-256',bytes);
      return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    }
    let running=null,pending=null;
    async function onePass(snapshot){
      const db=library.check(snapshot);
      const items=db.routes.flatMap(route=>route.revisions.map(revision=>({route,revision})));
      const done=receipts(),total=items.length;
      let uploaded=0,skipped=0,failed=0,processed=0;
      for(const {route,revision} of items){
        if(!enabled())break;
        try{
          const kmz=planner.build(revision.plan).kmz;
          const sha=await checksum(kmz);
          if(done.has(sha)){skipped++;}
          else{
            const name=missionName(route.name,route.id,revision.revision,sha);
            const result=await store.upload('',kmz,name);
            if(!result||typeof result.id!=='string'||!result.id)
              throw new Error('Invalid mission-store confirmation');
            saveReceipt(sha,done);
            uploaded++;
          }
        }catch(err){
          failed++;
          const detail=String(err?.message||'unbekannter Fehler').slice(0,120);
          // Auth/proxy errors affect all requests; do not hammer the endpoint.
          if(/\b(401|403)\b|Zugriff verweigert|HTTPS-Proxy/.test(detail)){
            onStatus({phase:'blocked',uploaded,skipped,failed,total,processed:processed+1,
              error:'Zugriff verweigert; HTTPS-Heimnetzfreigabe überprüfen'});
            return {uploaded,skipped,failed,total,blocked:true};
          }
        }
        processed++;
        onStatus({phase:'running',uploaded,skipped,failed,total,processed});
      }
      onStatus({phase:enabled()?'complete':'disabled',uploaded,skipped,failed,total,processed});
      return {uploaded,skipped,failed,total,blocked:false};
    }
    function sync(snapshot){
      if(!enabled())return Promise.resolve({disabled:true});
      pending=snapshot; // latest validated local snapshot wins; uploads are immutable.
      if(running)return running;
      running=(async()=>{
        let result;
        while(pending&&enabled()){
          const next=pending;pending=null;
          result=await onePass(next);
          if(result.blocked)break;
        }
        return result||{disabled:true};
      })().finally(()=>{running=null;});
      return running;
    }
    return Object.freeze({enabled,setEnabled,sync});
  }
  return Object.freeze({create,missionName,ENABLED_KEY,RECEIPTS_KEY});
});
