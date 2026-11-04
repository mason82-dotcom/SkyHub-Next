'use strict';
// Terrain profile client for the WPML editor: the editor's second explicit network path (besides the mission store
// client). One POST to /api/terrain/profile on user request; read-only, nothing is stored on the server.
(function(global){
  async function profile(points){
    const r=await fetch('/api/terrain/profile',{method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({points})});
    const b=await r.json().catch(()=>({}));
    if(r.status===404)throw new Error('Höhendienst ist auf diesem SkyHub nicht eingerichtet');
    if(!r.ok)throw new Error(b.error||('HTTP '+r.status));
    return b;
  }
  global.SkyHubTerrainClient={profile};
})(typeof window!=='undefined'?window:globalThis);
