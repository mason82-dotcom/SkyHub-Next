'use strict';
/* Browser client for the SkyHub WPML mission library (MinIO/S3).
 * The ONLY network module of the mission editor. It talks exclusively to
 * /api/wpml/missions on the same origin: no DJI, Pilot 2, MQTT or flight-task API.
 * A token is optional on explicitly enabled HTTPS home-LAN origins only.
 * Supplied tokens are kept in memory, never persisted.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(root);
  else root.SkyHubWpmlMissionStore=factory(root);
})(typeof globalThis==='object'?globalThis:this,function(root){
  const STORE='/api/wpml/missions';
  const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  function headers(token,extra){
    if(token===''||token===null||token===undefined)return {...(extra||{})};
    if(typeof token!=='string'||token.length<24||/[\s\u0000-\u001f]/.test(token))
      throw new TypeError('Ungültiger SkyHub-Zugangstoken (min. 24 Zeichen).');
    return {Authorization:'Bearer '+token,...(extra||{})};
  }
  async function problem(response){
    let body=null;
    try{body=await response.json();}catch(_e){}
    if(response.status===401)return new Error('Zugriff verweigert (401): Heimnetzfreigabe aktivieren oder unter „Erweiterter Zugriff“ einen gültigen Zugangstoken eingeben.');
    if(response.status===403)return new Error('Zugriff durch HTTPS-Proxy verweigert (403): Heimnetz und Port 4443 prüfen.');
    if(response.status===404&&!body?.error)return new Error('Missionsbibliothek ist auf diesem Server nicht aktiviert.');
    if(response.status===413)return new Error('KMZ ist größer als 12 MiB.');
    if(response.status===409)return new Error('Name bereits vergeben: DJI verlangt eindeutige Wayline-Namen.');
    if(response.status===400&&typeof body?.error==='string')return new Error(body.error.slice(0,200));
    if(response.status===422){
      const first=(body?.errors||[]).slice(0,3).map(e=>String(e.path||'')+': '+String(e.message||'')).join('; ');
      return new Error('Server-Validierung abgelehnt'+(first?': '+first.slice(0,300):'.'));
    }
    if(response.status===503)return new Error('MinIO-Speicher derzeit nicht erreichbar.');
    return new Error('Missionsbibliothek: HTTP '+response.status+
      (typeof body?.error==='string'?' – '+body.error.slice(0,120):''));
  }
  const request=(url,options)=>root.fetch(url,{cache:'no-store',credentials:'same-origin',...options});
  async function status(token){
    const response=await request(STORE+'/status',{headers:headers(token,{Accept:'application/json'})});
    if(!response.ok)throw await problem(response);
    return response.json();
  }
  async function list(token,{page=1,pageSize=50}={}){
    if(!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)
      throw new TypeError('Ungültige Seitenangabe.');
    const response=await request(STORE+'?page='+page+'&page_size='+pageSize,
      {headers:headers(token,{Accept:'application/json'})});
    if(!response.ok)throw await problem(response);
    const body=await response.json();
    if(!body||!Array.isArray(body.list)||!body.pagination)throw new Error('Ungültige Antwort der Missionsbibliothek.');
    return body;
  }
  async function upload(token,bytes,name){
    if(!(bytes instanceof Uint8Array)||!bytes.length)throw new TypeError('KMZ-Daten fehlen.');
    const extra={'Content-Type':'application/vnd.google-earth.kmz',Accept:'application/json'};
    if(typeof name==='string'&&name.trim())extra['X-SkyHub-Mission-Name']=encodeURIComponent(name.trim().slice(0,70));
    const response=await request(STORE,{method:'POST',headers:headers(token,extra),body:bytes});
    if(!response.ok)throw await problem(response);
    return response.json();
  }
  async function download(token,id){
    if(typeof id!=='string'||!ID.test(id))throw new TypeError('Ungültige Missions-ID.');
    const response=await request(STORE+'/'+id+'/kmz',{headers:headers(token)});
    if(!response.ok)throw await problem(response);
    return new Uint8Array(await response.arrayBuffer());
  }
  return Object.freeze({STORE,status,list,upload,download});
});
