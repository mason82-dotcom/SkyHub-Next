'use strict';
const crypto=require('crypto');
const {mapPrincipal}=require('./map-element-permissions');

function tokenMatches(token,expected){
  if(typeof token!=='string'||typeof expected!=='string')return false;
  const a=Buffer.from(token),b=Buffer.from(expected);
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}

// Token checks shared by the Pilot 2 bootstrap, the DJI map endpoint and the situation-awareness
// channel. The shared operator token or a device token paired for this workspace is accepted.
function createPilotAuth({pilot,pairing,redis}){
  // Bootstrap/session access: any valid operator or paired device token.
  async function authorizedToken(token){
    if(typeof token!=='string')return false;
    if(tokenMatches(token,pilot.accessToken))return true;
    if(redis.status!=='ready')return false;
    return Boolean(await pairing.verify(token));
  }
  // Workspace-bound principal. A previously paired RC without a stored workspace binding can
  // still bootstrap, but has no workspace data access until it is paired again.
  async function principal(token){
    if(typeof token!=='string'||!token)return null;
    if(tokenMatches(token,pilot.accessToken))return mapPrincipal('pilot',pilot.workspaceId);
    if(redis.status!=='ready')return null;
    const device=await pairing.verify(token);
    return device&&device.workspaceId===pilot.workspaceId?
      mapPrincipal('pilot',device.workspaceId):null;
  }
  // Bootstrap decision. 'repair': a device paired before the workspace binding. Its bootstrap used to succeed, but every
  // DJI API call afterwards (map, waylines, situation awareness) answered 401, and Pilot 2 then closed the page and dropped
  // the whole cloud login ("Fehler beim Anmelden", RC Pro Enterprise on 05.11.2026). It has to pair again.
  async function bootstrapAccess(token){
    if(!await authorizedToken(token))return 'denied';
    return await principal(token)?'ok':'repair';
  }
  return {authorizedToken,principal,bootstrapAccess};
}
module.exports={createPilotAuth,tokenMatches};
