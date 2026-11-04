'use strict';
// WPML mission (wayline file) library on MinIO/S3 – opt-in.
// Follows the DJI Cloud API wayline file model (third_party/dji-cloud-api-demo,
// cloud-sdk com.dji.sdk.cloudapi.wayline): UUID ids, unique names without
// <>:"/|?*._\ characters, sign = MD5 hex of the KMZ, drone_model_key
// "0-<type>-<sub>", payload_model_keys ["1-<type>-<sub>"], template_types [0..3].
// Only KMZ files that pass the offline SkyHub WPML validator are stored, write-once.
// This is a file library: it never creates DJI flight tasks, never talks to MQTT
// and never marks a mission as flight-ready.
const crypto=require('node:crypto');
const {
  S3Client,
  HeadObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand
}=require('@aws-sdk/client-s3');
const {inspectKmz}=require('./wpml-kmz');

const MAX_KMZ=12*1024*1024;
const MAX_LIBRARY=500;
const PREFIX='missions/';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BUCKET=/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
// DJI GetWaylineListResponse.name: ^[^<>:"/|?*._\\]+$
const DJI_NAME=/^[^<>:"/|?*._\\]+$/;
const CONTENT_TYPE='application/vnd.google-earth.kmz';
const TEMPLATE_TYPES=Object.freeze({waypoint:0,mapping2d:1,mapping3d:2,mappingStrip:3});

function httpError(status,message,extra){
  const err=new Error(message);
  err.status=status;
  if(extra)err.details=extra;
  return err;
}
function endpointOk(value){return typeof value==='string'&&/^https?:\/\/[^\s/?#]+\/?$/.test(value);}
function storeConfiguration(env=process.env){
  const endpoint=env.SKYHUB_WPML_S3_ENDPOINT||env.SKYHUB_S3_ENDPOINT;
  // Default: the existing backend MinIO account (SKYHUB_S3_*), extended by
  // scripts/pi-minio-wpml-store.sh with rights on skyhub-wpml/missions/ only.
  // A separate account can still be configured with SKYHUB_WPML_S3_ACCESS_KEY/SECRET_KEY.
  const own=Boolean(env.SKYHUB_WPML_S3_ACCESS_KEY);
  const accessKeyId=own?env.SKYHUB_WPML_S3_ACCESS_KEY:env.SKYHUB_S3_ACCESS_KEY;
  const secretAccessKey=own?env.SKYHUB_WPML_S3_SECRET_KEY:env.SKYHUB_S3_SECRET_KEY;
  const bucket=env.SKYHUB_WPML_S3_BUCKET||'skyhub-wpml';
  // Endpoint the DJI RC can reach for presigned downloads (same Caddy front as Pilot media).
  const publicEndpoint=env.SKYHUB_WPML_S3_PUBLIC_ENDPOINT||env.SKYHUB_PILOT_MEDIA_S3_PUBLIC_ENDPOINT||null;
  if(!endpointOk(endpoint))throw new Error('WPML store: S3 endpoint missing or invalid');
  if(publicEndpoint!==null&&!endpointOk(publicEndpoint))throw new Error('WPML store: invalid public S3 endpoint');
  if(!accessKeyId||!secretAccessKey||secretAccessKey.startsWith('REPLACE_'))
    throw new Error('WPML store: S3 credentials missing');
  // The Pilot 2 upload key is handed to RCs via STS; it must never write mission files.
  if(accessKeyId===env.SKYHUB_PILOT_UPLOAD_S3_ACCESS_KEY)
    throw new Error('WPML store: the Pilot 2 upload account must not be used');
  if(!BUCKET.test(bucket))throw new Error('WPML store: invalid bucket name');
  return {endpoint,accessKeyId,secretAccessKey,bucket,publicEndpoint};
}
// Deterministic RFC 9562 version-8 UUID from the content hash: identical files
// get the same wayline id, so uploads are idempotent and write-once.
function waylineId(sha256){
  const h=sha256.slice(0,32).split('');
  h[12]='8';
  h[16]=((parseInt(h[16],16)&0x3)|0x8).toString(16);
  const s=h.join('');
  return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20,32);
}
function validName(raw){
  if(typeof raw!=='string')throw httpError(400,'Mission name required');
  const name=raw.trim();
  if(!name||name.length>64||/[\u0000-\u001f\u007f]/.test(name)||!DJI_NAME.test(name))
    throw httpError(400,'Mission name must be 1-64 characters without < > : " / | ? * . _ \\');
  return name;
}
const enc=v=>encodeURIComponent(String(v));
const dec=v=>{try{return typeof v==='string'&&v?decodeURIComponent(v):null;}catch{return null;}};
async function readBody(body,limit){
  if(!body)throw new Error('Empty S3 body');
  if(typeof body.transformToByteArray==='function'){
    const bytes=Buffer.from(await body.transformToByteArray());
    if(bytes.length>limit)throw new Error('S3 object too large');
    return bytes;
  }
  const chunks=[];let size=0;
  for await(const chunk of body){
    size+=chunk.length;
    if(size>limit)throw new Error('S3 object too large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
function summarize(validation){
  const a=validation.aircraft||{};
  const int=v=>Number.isSafeInteger(v)?v:null;
  const droneType=int(a.droneType),droneSub=int(a.droneSubtype)??0,payloadType=int(a.payloadType);
  const templateTypes=[...new Set((validation.templates||[]).map(t=>TEMPLATE_TYPES[t.templateType])
    .filter(v=>v!==undefined))];
  return {
    valid:validation.valid===true,
    wpmlVersion:validation.wpmlVersion||null,
    aircraft:typeof a.model==='string'?a.model:null,
    droneModelKey:droneType===null?null:'0-'+droneType+'-'+droneSub,
    // Integrated cameras: payloadSubEnumValue defaults to 0 as in the DJI sample.
    payloadModelKeys:payloadType===null?[]:['1-'+payloadType+'-0'],
    templateTypes,
    waylineCount:(validation.waylines||[]).length,
    waypointCount:(validation.waylines||[]).reduce((n,w)=>n+(Number(w.waypointCount)||0),0),
    warningCount:(validation.warnings||[]).length,
    flightReady:false,
    validationScope:'offline-partial'
  };
}
function fromMetadata(id,head){
  const m=head.Metadata||{};
  const n=v=>/^\d{1,15}$/.test(v||'')?Number(v):null;
  return {
    id,name:dec(m.name),
    objectKey:PREFIX+id+'.kmz',
    sign:/^[0-9a-f]{32}$/.test(m.sign||'')?m.sign:null,
    sha256:/^[0-9a-f]{64}$/.test(m.sha256||'')?m.sha256:null,
    droneModelKey:/^0-\d{1,5}-\d{1,5}$/.test(m['drone-model-key']||'')?m['drone-model-key']:null,
    payloadModelKeys:(m['payload-model-keys']||'').split(',').filter(k=>/^1-\d{1,5}-\d{1,5}$/.test(k)),
    templateTypes:(m['template-types']||'').split(',').filter(t=>/^[0-3]$/.test(t)).map(Number),
    aircraft:dec(m.aircraft),
    username:dec(m['user-name']),
    origin:m.origin==='pilot2'?'pilot2':null,
    wpmlVersion:/^1\.0\.\d$/.test(m['wpml-version']||'')?m['wpml-version']:null,
    waypointCount:n(m['waypoint-count']),
    createTime:n(m['create-time'])??(head.LastModified?.getTime?.()||null),
    size:Number.isSafeInteger(head.ContentLength)?head.ContentLength:null,
    // Added only by an explicitly linked derivative upload; legacy missions are roots.
    parentId:UUID.test(m['parent-id']||'')?m['parent-id']:null,
    rootId:UUID.test(m['root-id']||'')?m['root-id']:id,
    generation:/^[1-9]\d{0,2}$/.test(m.generation||'')?Number(m.generation):1,
    flightReady:false
  };
}

// AWS Signature V4 query presigning (GET only), per the AWS S3 specification.
function presignGetUrl({endpoint,bucket,key,accessKeyId,secretAccessKey,expiresIn=600,now=new Date(),region='us-east-1'}){
  if(!Number.isInteger(expiresIn)||expiresIn<1||expiresIn>3600)throw new Error('expiresIn');
  const base=new URL(endpoint);
  const amzDate=now.toISOString().replace(/[:-]|\.\d{3}/g,'');
  const day=amzDate.slice(0,8);
  const scope=day+'/'+region+'/s3/aws4_request';
  const uriEncode=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  const path='/'+uriEncode(bucket)+'/'+key.split('/').map(uriEncode).join('/');
  const query={
    'X-Amz-Algorithm':'AWS4-HMAC-SHA256',
    'X-Amz-Credential':accessKeyId+'/'+scope,
    'X-Amz-Date':amzDate,
    'X-Amz-Expires':String(expiresIn),
    'X-Amz-SignedHeaders':'host'
  };
  const canonicalQuery=Object.keys(query).sort().map(k=>uriEncode(k)+'='+uriEncode(query[k])).join('&');
  const canonical=['GET',path,canonicalQuery,'host:'+base.host+'\n','host','UNSIGNED-PAYLOAD'].join('\n');
  const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
  const hmac=(k,s)=>crypto.createHmac('sha256',k).update(s).digest();
  const toSign=['AWS4-HMAC-SHA256',amzDate,scope,sha(canonical)].join('\n');
  let k=hmac('AWS4'+secretAccessKey,day);
  k=hmac(k,region);k=hmac(k,'s3');k=hmac(k,'aws4_request');
  const signature=crypto.createHmac('sha256',k).update(toSign).digest('hex');
  return base.origin+path+'?'+canonicalQuery+'&X-Amz-Signature='+signature;
}

function createWpmlMissionStore({env=process.env,client,now=()=>new Date(),cacheMs=30000}={}){
  const config=client?{bucket:env.SKYHUB_WPML_S3_BUCKET||'skyhub-wpml',
    publicEndpoint:env.SKYHUB_WPML_S3_PUBLIC_ENDPOINT||null,
    accessKeyId:env.SKYHUB_WPML_S3_ACCESS_KEY,secretAccessKey:env.SKYHUB_WPML_S3_SECRET_KEY}:
    storeConfiguration(env);
  if(!BUCKET.test(config.bucket))throw new Error('WPML store: invalid bucket name');
  const s3=client||new S3Client({
    endpoint:config.endpoint,region:'us-east-1',forcePathStyle:true,
    credentials:{accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey},
    maxAttempts:2
  });
  const bucket=config.bucket;
  const keyFor=id=>PREFIX+id+'.kmz';
  let cache=null,cacheAt=0;
  let queue=Promise.resolve();
  // Serialize writes in this process so the name-uniqueness check cannot race.
  const serialized=task=>{const run=queue.then(task,task);queue=run.catch(()=>{});return run;};

  async function status(){
    try{
      // The writer policy only allows listing below missions/; HeadBucket would be denied.
      await s3.send(new ListObjectsV2Command({Bucket:bucket,Prefix:PREFIX,MaxKeys:1}));
      return {status:'online',bucket,pilotDownloads:Boolean(config.publicEndpoint)};
    }catch(err){
      const code=err.$metadata?.httpStatusCode;
      return {status:code===404||err.name==='NoSuchBucket'||err.name==='NotFound'?'bucket-missing':
        code===403?'forbidden':'unavailable',bucket};
    }
  }
  async function describe(id){
    if(typeof id!=='string'||!UUID.test(id))throw httpError(400,'Invalid wayline id');
    try{return fromMetadata(id,await s3.send(new HeadObjectCommand({Bucket:bucket,Key:keyFor(id)})));}
    catch(err){
      if(err.$metadata?.httpStatusCode===404||err.name==='NotFound')throw httpError(404,'Wayline not found');
      throw err;
    }
  }
  // Full catalogue (bounded). Cached briefly; every write invalidates it.
  async function catalog({fresh=false}={}){
    if(!fresh&&cache&&now().getTime()-cacheAt<cacheMs)return cache;
    const ids=[];let token;
    do{
      const r=await s3.send(new ListObjectsV2Command({Bucket:bucket,Prefix:PREFIX,MaxKeys:1000,
        ...(token?{ContinuationToken:token}:{})}));
      if(!r||typeof r.IsTruncated!=='boolean'||(r.IsTruncated&&typeof r.NextContinuationToken!=='string'))
        throw new Error('Invalid S3 listing response');
      for(const item of r.Contents||[]){
        const key=item?.Key;
        if(typeof key==='string'&&key.startsWith(PREFIX)&&key.endsWith('.kmz')){
          const id=key.slice(PREFIX.length,-4);
          if(UUID.test(id))ids.push(id);
        }
      }
      token=r.IsTruncated?r.NextContinuationToken:undefined;
      if(ids.length>MAX_LIBRARY)throw new Error('WPML library exceeds supported size');
    }while(token);
    const entries=[];
    for(const id of ids){
      try{entries.push(await describe(id));}
      catch(err){if(err.status!==404)throw err;}
    }
    entries.sort((a,b)=>(b.createTime||0)-(a.createTime||0));
    cache=Object.freeze(entries);cacheAt=now().getTime();
    return cache;
  }
  async function list({page=1,pageSize=50,key,templateTypes,droneModelKeys}={}){
    if(!Number.isInteger(page)||page<1||page>10000||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)
      throw httpError(400,'Invalid pagination');
    let all=await catalog();
    if(typeof key==='string'&&key)all=all.filter(w=>(w.name||'').toLowerCase().includes(key.toLowerCase()));
    if(templateTypes?.length)all=all.filter(w=>w.templateTypes.some(t=>templateTypes.includes(t)));
    if(droneModelKeys?.length)all=all.filter(w=>droneModelKeys.includes(w.droneModelKey));
    return {list:all.slice((page-1)*pageSize,page*pageSize),
      pagination:{page,page_size:pageSize,total:all.length}};
  }
  async function duplicateNames(names){
    const wanted=new Set(names.map(n=>String(n)));
    return [...new Set((await catalog({fresh:true})).map(w=>w.name).filter(n=>wanted.has(n)))];
  }
  function put(buffer,{name,username,parentId,origin}={}){
    if(!Buffer.isBuffer(buffer)||buffer.length<22)return Promise.reject(httpError(400,'KMZ body required'));
    if(buffer.length>MAX_KMZ)return Promise.reject(httpError(413,'KMZ exceeds 12 MiB'));
    let missionName;
    try{missionName=validName(name);}catch(err){return Promise.reject(err);}
    // Never infer ancestry from a similar filename or client-provided metadata.
    if(parentId!==undefined&&(typeof parentId!=='string'||!UUID.test(parentId)))
      return Promise.reject(httpError(400,'Invalid parent wayline id'));
    return serialized(async()=>{
      let validation;
      try{validation=inspectKmz(buffer,{cameraDecides:origin==='pilot2'});}
      catch(err){throw httpError(422,'KMZ archive rejected',{errors:[{path:'kmz',
        message:String(err.message||'invalid archive').slice(0,160)}]});}
      if(!validation.valid){
        throw httpError(422,'WPML validation failed',{
          errors:(validation.errors||[]).slice(0,25).map(e=>({
            path:String(e.path||'').slice(0,200),message:String(e.message||'').slice(0,200)}))
        });
      }
      const summary=summarize(validation);
      if(!summary.droneModelKey||!summary.payloadModelKeys.length||!summary.templateTypes.length)
        throw httpError(422,'KMZ lacks DJI drone, payload or template type information');
      const sha256=crypto.createHash('sha256').update(buffer).digest('hex');
      const id=waylineId(sha256);
      const sign=crypto.createHash('md5').update(buffer).digest('hex');
      const existing=(await catalog({fresh:true}));
      const parent=parentId===undefined?null:existing.find(w=>w.id===parentId);
      if(parentId!==undefined&&!parent)throw httpError(404,'Parent wayline not found');
      if(parent&&parent.droneModelKey!==summary.droneModelKey)
        throw httpError(422,'Derived wayline must retain its parent aircraft model');
      if(parent&&parent.id===id)throw httpError(409,'A wayline cannot be its own parent');
      const same=existing.find(w=>w.id===id);
      if(same){
        // Do not falsely acknowledge a requested lineage that the immutable object lacks.
        if(parentId!==undefined&&same.parentId!==parentId)
          throw httpError(409,'Existing wayline has different lineage');
        return {...same,created:false,validation:summary,dispatched:false};
      }
      // DJI requires unique wayline names in a workspace.
      if(existing.some(w=>w.name===missionName))
        throw httpError(409,'A different wayline with this name already exists');
      const createTime=now().getTime();
      const metadata={
        name:enc(missionName),sign,sha256,
        'drone-model-key':summary.droneModelKey,
        'payload-model-keys':summary.payloadModelKeys.join(','),
        'template-types':summary.templateTypes.join(','),
        aircraft:summary.aircraft?enc(summary.aircraft):'',
        'user-name':typeof username==='string'&&username?enc(username.slice(0,64)):'',
        'wpml-version':summary.wpmlVersion||'',
        'waypoint-count':String(summary.waypointCount),
        'create-time':String(createTime),
        // Immutable, S3-native ancestry. Root is inherited only from a validated parent.
        ...(parent?{'parent-id':parent.id,'root-id':parent.rootId,
          generation:String(parent.generation+1)}:{}),
        'flight-ready':'false',
        ...(origin==='pilot2'?{origin:'pilot2'}:{})
      };
      let created=true;
      try{
        // Write-once (atomic conditional write); an existing object is never overwritten.
        await s3.send(new PutObjectCommand({
          Bucket:bucket,Key:keyFor(id),Body:buffer,ContentType:CONTENT_TYPE,
          ContentLength:buffer.length,
          ContentMD5:Buffer.from(sign,'hex').toString('base64'),
          IfNoneMatch:'*',Metadata:metadata
        }));
      }catch(err){
        const code=err.$metadata?.httpStatusCode;
        if(code===412||err.name==='PreconditionFailed'||(code===409&&err.name==='ConditionalRequestConflict'))
          created=false;
        else throw err;
      }finally{cache=null;}
      return {...fromMetadata(id,{Metadata:metadata,ContentLength:buffer.length}),
        created,validation:summary,
        warnings:(validation.warnings||[]).slice(0,25).map(w=>String(w).slice(0,200)),
        dispatched:false};
    });
  }
  async function get(id){
    if(typeof id!=='string'||!UUID.test(id))throw httpError(400,'Invalid wayline id');
    let result;
    try{result=await s3.send(new GetObjectCommand({Bucket:bucket,Key:keyFor(id)}));}
    catch(err){
      if(err.$metadata?.httpStatusCode===404||err.name==='NoSuchKey'||err.name==='NotFound')
        throw httpError(404,'Wayline not found');
      throw err;
    }
    const bytes=await readBody(result.Body,MAX_KMZ);
    // Content addressing doubles as an integrity check of the stored object.
    if(waylineId(crypto.createHash('sha256').update(bytes).digest('hex'))!==id)
      throw httpError(502,'Stored wayline failed integrity check');
    return {bytes,name:dec(result.Metadata?.name)};
  }
  // Short-lived presigned GET on the RC-reachable endpoint (DJI: redirect to object URL).
  async function downloadUrl(id,{expiresIn=600}={}){
    await describe(id);
    if(!config.publicEndpoint)throw httpError(503,'No public S3 endpoint configured for Pilot 2 downloads');
    return presignGetUrl({endpoint:config.publicEndpoint,bucket,key:keyFor(id),
      accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey,expiresIn,now:now()});
  }
  return {status,put,list,all:()=>catalog(),get,describe,duplicateNames,downloadUrl,bucket};
}

function createWpmlMissionRouter({express,store}){
  if(!express||!store)throw new Error('WPML mission router needs express and store');
  const router=express.Router();
  const raw=express.raw({type:[CONTENT_TYPE,'application/octet-stream','application/zip'],
    limit:MAX_KMZ});
  const fail=(res,err)=>{
    if(err.type==='entity.too.large')return res.status(413).json({error:'KMZ exceeds 12 MiB'});
    if(err.status&&err.status<500||err.status===502){
      return res.status(err.status).json({error:err.message,...(err.details||{})});
    }
    // Never leak S3 endpoints, keys or stack traces.
    console.error('[wpml store]',err.name||'error');
    return res.status(503).json({error:'WPML storage unavailable'});
  };
  router.get('/status',async(req,res)=>{
    try{res.json({...(await store.status()),flightReady:false,dispatch:false});}
    catch(err){fail(res,err);}
  });
  router.get('/',async(req,res)=>{
    try{
      const page=req.query.page===undefined?1:Number(req.query.page);
      const pageSize=req.query.page_size===undefined?50:Number(req.query.page_size);
      const key=typeof req.query.key==='string'?req.query.key.slice(0,64):undefined;
      res.json(await store.list({page,pageSize,key}));
    }catch(err){fail(res,err);}
  });
  router.post('/',(req,res,next)=>raw(req,res,err=>err?fail(res,err):next()),async(req,res)=>{
    try{
      if(!Buffer.isBuffer(req.body)||!req.body.length)
        return res.status(415).json({error:'Send the KMZ as application/vnd.google-earth.kmz'});
      const header=req.get('X-SkyHub-Mission-Name');
      let name;
      try{name=header===undefined?undefined:decodeURIComponent(header);}
      catch{return res.status(400).json({error:'Invalid mission name'});}
      const parentId=req.get('X-SkyHub-Parent-Mission-Id');
      const stored=await store.put(req.body,{name,username:'SkyHub',
        ...(parentId===undefined?{}:{parentId})});
      res.status(stored.created?201:200).json(stored);
    }catch(err){fail(res,err);}
  });
  router.get('/:id/kmz',async(req,res)=>{
    try{
      const {bytes}=await store.get(req.params.id);
      res.set('Content-Type',CONTENT_TYPE);
      res.set('Content-Disposition','attachment; filename="skyhub-wayline-'+req.params.id.slice(0,8)+'.kmz"');
      res.send(bytes);
    }catch(err){fail(res,err);}
  });
  router.get('/:id',async(req,res)=>{
    try{res.json(await store.describe(req.params.id));}
    catch(err){fail(res,err);}
  });
  return router;
}

module.exports={createWpmlMissionStore,createWpmlMissionRouter,storeConfiguration,
  presignGetUrl,waylineId,MAX_KMZ,PREFIX,CONTENT_TYPE,DJI_NAME};
