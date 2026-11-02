'use strict';

// Opt-in wiring only. The caller must provision migrations 003-005 and
// independently authenticate the view token and Pilot token before use.
const {createPilotMediaLibrary,createLibraryAudit}=require('./pilot-media-library');
const {createPilotMediaLibraryRouter}=require('./pilot-media-library-http');
const {createPilotMediaRateLimiter}=require('./pilot-media-rate-limit');

function createPilotMediaLibraryRuntime({env,db,redis,authorize,storage,pilot}={}){
  if(env?.SKYHUB_MEDIA_LIBRARY_ENABLED!=='true')return null;
  if(env.SKYHUB_MEDIA_ENABLED!=='true'||!pilot?.ready||!db||
    typeof db.query!=='function'||!redis||typeof authorize!=='function'||
    !storage||typeof storage.headObject!=='function')
    throw new Error('Pilot media library prerequisites unavailable');
  const key=env.SKYHUB_MEDIA_LIBRARY_CURSOR_SECRET;
  if(typeof key!=='string'||!/^[0-9a-f]{64}$/i.test(key))
    throw new Error('Pilot media library requires a private 32-byte cursor secret');
  if(key===env.SKYHUB_VIEW_TOKEN||key===env.SKYHUB_PILOT_ACCESS_TOKEN)
    throw new Error('Pilot media library cursor secret must be independent');
  return createPilotMediaLibraryRouter({
    workspace:pilot.workspaceId,
    authorize,
    allowRead:createPilotMediaRateLimiter(redis),
    audit:createLibraryAudit(db),
    library:createPilotMediaLibrary(db,{cursorSecret:Buffer.from(key,'hex')}),
    headObject:storage.headObject
  });
}

module.exports={createPilotMediaLibraryRuntime};
