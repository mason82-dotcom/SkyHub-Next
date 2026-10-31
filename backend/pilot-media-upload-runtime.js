'use strict';

// DJI Pilot 2 media synchronisation (opt-in: SKYHUB_PILOT_MEDIA_UPLOAD_ENABLED=true).
// Pilot 2 on the RC asks for temporary credentials (STS), uploads photos/videos straight into
// MinIO through the narrow S3 proxy, and reports each file with an upload callback. The callback
// is only accepted after a server-side S3 HEAD of the object below the issued prefix.
const express=require('express');
const {createMinioStsIssuer}=require('./minio-sts');
const {createPilotMediaStsHandler}=require('./pilot-media-sts');
const {createPilotMediaRouter}=require('./pilot-media-http');
const {createPilotMediaStore,createRegisteredStsIssuer}=require('./pilot-media-store');
const {createPilotMediaGroupStore}=require('./pilot-media-groups');
const {createPilotMediaHttpAudit}=require('./pilot-media-http-audit');
const {createPilotMediaMutationTransaction}=require('./pilot-media-mutation');
const {createPilotMediaRateLimiter}=require('./pilot-media-rate-limit');
const {createS3UploadProxy}=require('./s3-upload-proxy');

const STS_PATH='/storage/api/v1/workspaces/:workspaceId/sts';

function createPilotMediaUploadRuntime({env,pool,redis,authorize,storage,pilot,trustedProxyIps,
  fetchImpl,log=console.log}={}){
  if(env?.SKYHUB_PILOT_MEDIA_UPLOAD_ENABLED!=='true')return null;
  if(env.SKYHUB_MEDIA_ENABLED!=='true'||!pilot?.ready||!pool||typeof pool.connect!=='function'||
     !redis||typeof authorize!=='function'||!storage||typeof storage.headObject!=='function')
    throw new Error('Pilot media upload prerequisites unavailable (media API, Pilot 2, PostgreSQL, Redis)');
  const workspace=pilot.workspaceId;
  const issuer=createMinioStsIssuer({
    endpoint:env.SKYHUB_S3_ENDPOINT,
    publicEndpoint:env.SKYHUB_PILOT_MEDIA_S3_PUBLIC_ENDPOINT,
    accessKeyId:env.SKYHUB_PILOT_UPLOAD_S3_ACCESS_KEY,
    secretAccessKey:env.SKYHUB_PILOT_UPLOAD_S3_SECRET_KEY,
    ...(fetchImpl?{fetchImpl}:{})
  });
  if(env.SKYHUB_PILOT_UPLOAD_S3_ACCESS_KEY===env.SKYHUB_S3_ACCESS_KEY)
    throw new Error('Pilot uploads need their own MinIO account, not the read-only gallery account');
  const limiter=createPilotMediaRateLimiter(redis);
  const store=createPilotMediaStore(pool);
  const stats={grants:0,grantFailures:0};
  const registered=createRegisteredStsIssuer({issueGrant:issuer.issueGrant,store});
  const sts=createPilotMediaStsHandler({
    workspace,authorize,storage:issuer.config,
    allowIssuance:({workspace:ws,principal})=>limiter({workspace:ws,principal,operation:'sts_issue'}),
    issueGrant:async args=>{
      try{const grant=await registered(args);stats.grants++;return grant;}
      catch(err){stats.grantFailures++;log('[pilot media] STS grant failed');throw err;}
    }
  });
  const router=express.Router();
  router.post(STS_PATH,express.json({limit:'4kb',strict:true}),sts);
  router.use(createPilotMediaRouter({
    workspace,authorize,allowRequest:limiter,
    audit:createPilotMediaHttpAudit(pool),store,
    groups:createPilotMediaGroupStore(pool),
    headObject:storage.headObject,
    transaction:createPilotMediaMutationTransaction(pool)
  }));
  const proxy=createS3UploadProxy({target:env.SKYHUB_S3_ENDPOINT,workspace,trustedProxyIps,log});
  const proxyPort=Number(env.SKYHUB_S3_UPLOAD_PROXY_PORT||4002);
  if(!Number.isInteger(proxyPort)||proxyPort<1024||proxyPort>65535)
    throw new Error('SKYHUB_S3_UPLOAD_PROXY_PORT must be 1024-65535');
  let server=null;
  return {
    router,
    // The DJI api/media modules need the HTTPS origin of SkyHub (same as the pilot-login page).
    endpoint:issuer.config.endpoint,
    start(){if(!server)server=proxy.listen(proxyPort);return server;},
    stop(){if(server){server.close();server=null;}},
    stats:()=>({...stats,proxy:proxy.stats()})
  };
}

module.exports={createPilotMediaUploadRuntime,STS_PATH};
