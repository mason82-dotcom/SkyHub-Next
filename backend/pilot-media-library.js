'use strict';

// Read-only catalog of POSTGRES-PERSISTED, HEAD-confirmed Pilot 2 media.
// Does not read images, XMP/EXIF bytes, S3 listings, or unverified uploads.
// Existing TIFF/XMP/UUID probes are isolated and MUST NOT be re-exposed here.
const crypto=require('node:crypto');
const {workspaceId}=require('./media-upload-contract');
const {identify,inventoryMediaNames}=require('./m3m-media-inventory');
const {headEvidence}=require('./pilot-media-store');

const MAX_PAGE=100,MAX_GROUP=5000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const GROUP=/^[A-Za-z0-9_.:-]{1,128}$/;
const FIELDS='asset_id,object_key,grant_prefix,file_name,file_group_id,size_bytes,etag,'+
  'object_last_modified,verified_at,pilot_metadata';
const SIX_TIME="to_char(verified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS cursor_time";
const BAD='Invalid media library data';
function plain(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function date(v){
  // HEAD evidence uses epoch milliseconds; pg returns Date and JSON may use ISO.
  const n=v instanceof Date?v.getTime():
    typeof v==='string'?Date.parse(v):
      Number.isSafeInteger(v)&&v>=0?v:NaN;
  if(!Number.isFinite(n))throw new TypeError(BAD);
  return new Date(n).toISOString();
}
function nullableNumber(value,limit){
  return typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=limit?value:null;
}
function metadata(value){
  const src=typeof value==='string'?JSON.parse(value):value;
  if(!plain(src))return {};
  const m={};
  for(const name of ['absolute_altitude','relative_altitude','gimbal_yaw_degree']){
    const num=nullableNumber(src[name],100000);
    if(num!==null)m[name]=num;
  }
  if(typeof src.created_time==='string'&&src.created_time.length<=64&&
     Number.isFinite(Date.parse(src.created_time)))
    m.created_time=src.created_time;
  if(plain(src.shoot_position)){
    const lat=nullableNumber(src.shoot_position.lat,90);
    const lng=nullableNumber(src.shoot_position.lng,180);
    if(lat!==null&&lng!==null&&!(lat===0&&lng===0))
      m.shoot_position={lat,lng};
  }
  return m;
}
function asset(row,{detail=false}={}){
  if(!plain(row)||!UUID.test(row.asset_id)||typeof row.file_name!=='string'||
    row.file_name.length>255||!row.file_name.length||
    !Number.isSafeInteger(Number(row.size_bytes))||Number(row.size_bytes)<1||
    typeof row.etag!=='string'||!row.etag||row.etag.length>256)
    throw new TypeError(BAD);
  const hint=identify(row.file_name);
  const record={
    id:row.asset_id,
    fileName:row.file_name,
    fileSizeBytes:Number(row.size_bytes),
    fileGroupId:row.file_group_id??null,
    mediaHint:hint?hint.band==='RGB'?'m3m-rgb-filename':'m3m-multispectral-filename':'unknown',
    bandHint:hint?.band??null,
    hintSource:hint?'filename-only-unverified':'none',
    verifiedAt:date(row.verified_at),
    objectEvidence:{status:detail?'head-rechecked':'head-at-ingestion',
      sizeBytes:Number(row.size_bytes),etag:row.etag,
      lastModified:date(row.object_last_modified)},
    pilotMetadata:{source:'pilot-upload-callback',fields:metadata(row.pilot_metadata)},
    imageInspection:{
      exif:'not-extracted',xmp:'not-extracted',rtk:'not-extracted',
      captureUuidConfirmed:false,m3mSourceVerified:false,
      bandCoregistrationVerified:false,radiometricCalibrationVerified:false,
      reflectanceReady:false,ndviReady:false,ndreReady:false
    }
  };
  if(detail){
    if(typeof row.object_key!=='string'||!row.object_key.length||
      !row.object_key.startsWith(row.grant_prefix+'/'))
      throw new TypeError(BAD);
    record.storage={bucket:'dji-cloud',objectKey:row.object_key};
  }
  return record;
}
function sign(raw,secret){
  return crypto.createHmac('sha256',secret).update(raw).digest('base64url');
}
function encodeCursor(workspace,row,secret){
  const time=row.cursor_time;
  if(!TIME.test(time)||!UUID.test(row.asset_id))throw new TypeError(BAD);
  const value=JSON.stringify([1,workspace,time,row.asset_id]);
  return Buffer.from(value).toString('base64url')+'.'+sign(value,secret);
}
function decodeCursor(token,workspace,secret){
  if(typeof token!=='string'||token.length>512||
     !/^[A-Za-z0-9_-]{10,450}\.[A-Za-z0-9_-]{43}$/.test(token))
    throw new TypeError('Invalid cursor');
  const [encoded,mac]=token.split('.');
  const raw=Buffer.from(encoded,'base64url').toString('utf8');
  const expected=sign(raw,secret);
  const a=Buffer.from(mac),b=Buffer.from(expected);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))
    throw new TypeError('Invalid cursor');
  let fields;
  try{fields=JSON.parse(raw);}catch(_err){throw new TypeError('Invalid cursor');}
  if(!Array.isArray(fields)||fields.length!==4||fields[0]!==1||
    fields[1]!==workspace||!TIME.test(fields[2])||
    !Number.isFinite(Date.parse(fields[2]))||!UUID.test(fields[3]))
    throw new TypeError('Invalid cursor');
  return {time:fields[2],id:fields[3]};
}
function catalog(db,{cursorSecret}={}){
  if(!db||typeof db.query!=='function'||!Buffer.isBuffer(cursorSecret)||
     cursorSecret.length<32)
    throw new TypeError('Workspace library database and private cursor secret required');
  return {
    async list({workspace,limit=30,cursor=null}={}){
      if(!workspaceId(workspace)||!Number.isSafeInteger(limit)||
        limit<1||limit>MAX_PAGE)throw new TypeError('Invalid media list');
      const decoded=cursor===null?null:decodeCursor(cursor,workspace,cursorSecret);
      const params=[workspace,limit+1,decoded?.time??null,decoded?.id??null];
      const sql='SELECT '+FIELDS+','+SIX_TIME+
        ' FROM dji_pilot_media_verified WHERE workspace_id=$1 '+
        'AND ($3::timestamptz IS NULL OR '+
        '(verified_at,asset_id)<($3::timestamptz,$4::uuid)) '+
        'ORDER BY verified_at DESC,asset_id DESC LIMIT $2';
      const {rows}=await db.query(sql,params);
      if(!Array.isArray(rows)||rows.length>limit+1)throw new TypeError(BAD);
      const more=rows.length>limit;
      const visible=rows.slice(0,limit);
      return {
        schema:'skyhub-pilot-media-library-v1',
        verification:'s3-head-at-ingestion-not-rechecked',
        items:visible.map(r=>asset(r)),
        nextCursor:more?encodeCursor(workspace,visible.at(-1),cursorSecret):null
      };
    },
    async detail({workspace,id,headObject}={}){
      if(!workspaceId(workspace)||!UUID.test(id)||typeof headObject!=='function')
        throw new TypeError('Invalid media detail');
      const {rows}=await db.query(
        'SELECT '+FIELDS+' FROM dji_pilot_media_verified '+
        'WHERE workspace_id=$1 AND asset_id=$2::uuid LIMIT 1',[workspace,id]);
      if(rows.length===0)return {status:'not-found'};
      if(rows.length!==1)throw new TypeError(BAD);
      const row=rows[0];
      if(!row.object_key.startsWith(workspace+'/media/')||
        !row.object_key.startsWith(row.grant_prefix+'/'))
        throw new TypeError(BAD);
      const h=headEvidence(await headObject({bucket:'dji-cloud',key:row.object_key}));
      if(!h)return {status:'missing'};
      if(h.size!==Number(row.size_bytes)||h.etag!==row.etag||
         date(h.lastModified)!==date(row.object_last_modified))
        return {status:'changed'};
      return {status:'ok',item:asset(row,{detail:true})};
    },
    async m3mGroup({workspace,groupId}={}){
      if(!workspaceId(workspace)||typeof groupId!=='string'||!GROUP.test(groupId))
        throw new TypeError('Invalid media group');
      // Bounded read. Combine only within identical grant prefixes so two
      // sessions with reused camera filenames cannot create false captures.
      const {rows}=await db.query(
        'SELECT grant_prefix,file_name FROM dji_pilot_media_verified '+
        'WHERE workspace_id=$1 AND file_group_id=$2 '+
        'ORDER BY grant_prefix,file_name LIMIT $3',
        [workspace,groupId,MAX_GROUP+1]);
      if(!Array.isArray(rows)||rows.length>MAX_GROUP)
        return {status:'limit-exceeded'};
      if(!rows.length)return {status:'not-found'};
      const sessions=new Map();
      for(const row of rows){
        if(typeof row.grant_prefix!=='string'||
          !row.grant_prefix.startsWith(workspace+'/media/')||
          typeof row.file_name!=='string')throw new TypeError(BAD);
        const list=sessions.get(row.grant_prefix)||[];
        list.push(row.file_name);
        sessions.set(row.grant_prefix,list);
      }
      const totals={classified:0,unrecognized:0,invalid:0,
        captureGroups:0,spectralSets:0,fiveChannelSets:0,
        partialSets:0,duplicateSets:0};
      const bands={RGB:0,G:0,R:0,RE:0,NIR:0};
      for(const names of sessions.values()){
        const report=inventoryMediaNames(names);
        for(const field of Object.keys(totals))totals[field]+=report[field];
        for(const band of Object.keys(bands))bands[band]+=report.bandCounts[band];
      }
      return {status:'ok',report:{
        schema:'skyhub-m3m-library-hints-v1',classification:'filename-hints-only',
        examined:rows.length,sessionPartitions:sessions.size,
        ...totals,bandCounts:bands,
        captureUuidVerified:false,exifVerified:false,xmpVerified:false,
        bandCoregistrationVerified:false,radiometricCalibrationVerified:false,
        reflectanceReady:false,ndviReady:false,ndreReady:false,
        caveat:'Counts use filename tokens within the same issued STS session; they do not prove Mavic 3M origin, XMP CaptureUUID equality or radiometric alignment.'
      }};
    }
  };
}
function createLibraryAudit(db){
  if(!db||typeof db.query!=='function')throw new TypeError('Library audit database required');
  const actions=new Set(['list','detail','m3m_group']);
  const outcomes=new Set(['ok','denied','invalid','pending','unavailable']);
  return async({workspace,action,outcome})=>{
    if(!workspaceId(workspace)||!actions.has(action)||!outcomes.has(outcome))
      throw new TypeError('Invalid library audit outcome');
    await db.query('INSERT INTO dji_pilot_media_library_audit '+
      '(workspace_id,action,outcome) VALUES ($1,$2,$3)',
    [workspace,action,outcome]);
  };
}
module.exports={createPilotMediaLibrary:catalog,createLibraryAudit,MAX_PAGE,MAX_GROUP};
