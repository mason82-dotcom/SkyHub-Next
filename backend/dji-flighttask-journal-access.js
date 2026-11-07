'use strict';

// ISOLATED, OFFLINE-ONLY authorization boundary for the flighttask journal.
// Not imported by server.js, not an authentication provider, not a DJI publisher.
// Only a trusted backend context may supply the authenticated principal or the
// authorize callback. Never bind methods directly to untrusted HTTP/MQTT inputs.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9_.:@-]{1,128}$/;
const ROLES=new Set(['viewer','operator','admin']);
const INTERNAL_ACCESS=new Set(['operator','admin']);
const REQUIRED=Object.freeze(['start','read','apply','recover','summary']);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const denied=()=>new Error('Flighttask journal access denied');

function createScopedFlighttaskJournal(journal,{authorize}={}){
  if(!object(journal)||REQUIRED.some(k=>typeof journal[k]!=='function')||
      typeof authorize!=='function')
    throw new Error('Flighttask journal requires a trusted store and authorization');

  async function scope({workspaceId,observationId,principal}={},action){
    // Identifier checks do not confer authorization. Workspace equality only
    // avoids an accidental cross-tenant call from the authenticated backend.
    let valid=false;
    try{
      valid=typeof workspaceId==='string'&&UUID.test(workspaceId)&&
        typeof observationId==='string'&&UUID.test(observationId)&&
        object(principal)&&typeof principal.id==='string'&&ID.test(principal.id)&&
        typeof principal.workspaceId==='string'&&UUID.test(principal.workspaceId)&&
        principal.workspaceId===workspaceId&&ROLES.has(principal.role)&&
        (action==='summary'||INTERNAL_ACCESS.has(principal.role));
    }catch(_error){valid=false;}
    if(!valid)throw denied();

    let granted=false;
    try{
      // The injected gate must resolve privileges from independently trusted
      // session/identity context. A role/UUID from a client is never proof.
      granted=(await authorize(principal,workspaceId,action))===true;
    }catch(_error){granted=false;}
    if(!granted)throw denied();
    return {workspaceId,observationId};
  }

  return Object.freeze({
    async start({workspaceId,observationId,principal,request,ttlMs}={}){
      const key=await scope({workspaceId,observationId,principal},'create');
      return journal.start({...key,request,...(ttlMs===undefined?{}:{ttlMs})});
    },
    async read({workspaceId,observationId,principal}={}){
      const key=await scope({workspaceId,observationId,principal},'read_internal');
      return journal.read(key);
    },
    async apply({workspaceId,observationId,principal,kind,topic,payload,now,retained}={}){
      const key=await scope({workspaceId,observationId,principal},'observe');
      return journal.apply(key,kind,{topic,payload,now,retained});
    },
    async recover({workspaceId,observationId,principal,now}={}){
      const key=await scope({workspaceId,observationId,principal},'recover');
      return journal.recover(key,{now});
    },
    async summary({workspaceId,observationId,principal}={}){
      const key=await scope({workspaceId,observationId,principal},'summary');
      return journal.summary(key);
    }
  });
}

module.exports={createScopedFlighttaskJournal};
