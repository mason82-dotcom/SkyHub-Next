'use strict';
// DJI Pilot 2 legt Medien als <ws>/media/<sitzung>/org_<fingerprint>_<ms>.jpg ab und meldet den originalen DJI-Namen
// (DJI_20261004172757_0096_V.JPG) nur in der Upload-Bestaetigung. Dieser Baustein benennt bestaetigte Dateien im selben
// Sitzungsordner in den DJI-Namen um (Kopie -> Pruefung -> Datenbank -> Loeschen des Originals) und merkt sich den
// urspruenglichen Schluessel (pilot_object_key, Migration 007), damit wiederholte Bestaetigungen von Pilot 2 erkannt werden.
// Eigenes MinIO-Konto nur fuer dji-cloud/<ws>/media/* (scripts/minio-pilot-media-renamer.sh); opt-in:
//   SKYHUB_PILOT_MEDIA_DJI_NAMES=true, SKYHUB_PILOT_MEDIA_RENAME_S3_ACCESS_KEY/_SECRET_KEY (Endpoint: SKYHUB_S3_ENDPOINT)
const {CopyObjectCommand,DeleteObjectCommand,HeadObjectCommand,S3Client}=require('@aws-sdk/client-s3');

const BUCKET='dji-cloud';
// Nur echte DJI-Kameranamen: Zeitstempel, laufende Nummer, optional Kennung (W, T, Z, V, D, MS_G …), uebliche Endungen.
const DJI_NAME=/^DJI_\d{14}_\d{4}(?:_[A-Za-z0-9]{1,12})*\.(?:jpe?g|dng|mp4|mov|tiff?|srt|mrk|nav|obs|rtk|bin)$/i;
const PREFIX=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/media\/[0-9a-f]{32}$/;

function renameConfig(env=process.env){
  if(env.SKYHUB_PILOT_MEDIA_DJI_NAMES!=='true')return {enabled:false,issue:null};
  const ak=env.SKYHUB_PILOT_MEDIA_RENAME_S3_ACCESS_KEY,sk=env.SKYHUB_PILOT_MEDIA_RENAME_S3_SECRET_KEY;
  if(!env.SKYHUB_S3_ENDPOINT||!ak||!sk)
    return {enabled:false,issue:'SKYHUB_PILOT_MEDIA_DJI_NAMES needs SKYHUB_S3_ENDPOINT and the rename account (scripts/minio-pilot-media-renamer.sh)'};
  if(ak===env.SKYHUB_S3_ACCESS_KEY||ak===env.SKYHUB_PILOT_UPLOAD_S3_ACCESS_KEY)
    return {enabled:false,issue:'the rename account must be separate from the gallery and upload accounts'};
  return {enabled:true,issue:null,endpoint:env.SKYHUB_S3_ENDPOINT,accessKeyId:ak,secretAccessKey:sk};
}

function createRenameS3(cfg){
  return new S3Client({endpoint:cfg.endpoint,region:'us-east-1',forcePathStyle:true,
    credentials:{accessKeyId:cfg.accessKeyId,secretAccessKey:cfg.secretAccessKey}});
}

// Zielschluessel im selben Sitzungsordner oder null (kein DJI-Name, unerwarteter Ordner, schon umbenannt).
function targetKey(row){
  if(!row||typeof row.object_key!=='string'||typeof row.grant_prefix!=='string'||typeof row.file_name!=='string')return null;
  if(!PREFIX.test(row.grant_prefix)||!row.object_key.startsWith(row.grant_prefix+'/'))return null;
  if(!DJI_NAME.test(row.file_name))return null;
  const target=row.grant_prefix+'/'+row.file_name;
  return target===row.object_key?null:target;
}

const copySource=key=>BUCKET+'/'+key.split('/').map(encodeURIComponent).join('/');

function createPilotMediaRenamer({s3,db,workspace,log=m=>console.log(m)}){
  if(!s3||typeof s3.send!=='function'||!db||typeof db.query!=='function'||typeof workspace!=='string')
    throw new TypeError('S3 client, database and workspace required');
  let chain=Promise.resolve();                 // nacheinander: keine zwei Kopien desselben Objekts gleichzeitig
  const serial=fn=>{const run=chain.then(fn,fn);chain=run.catch(()=>{});return run;};

  async function head(key){
    try{
      const r=await s3.send(new HeadObjectCommand({Bucket:BUCKET,Key:key}));
      return {size:r.ContentLength,etag:r.ETag,lastModified:r.LastModified};
    }catch(err){
      if(err?.name==='NotFound'||err?.$metadata?.httpStatusCode===404)return null;
      throw err;
    }
  }

  // A copy may only be removed again when no record points to it (a parallel run may already have taken it over).
  async function dropCopy(key){
    const {rows}=await db.query('SELECT 1 FROM dji_pilot_media_verified WHERE workspace_id=$1 AND object_key=$2',[workspace,key]);
    if(rows.length)return false;
    await s3.send(new DeleteObjectCommand({Bucket:BUCKET,Key:key})).catch(()=>{});
    return true;
  }

  async function renameRow(row,{apply=true}={}){
    const from=row.object_key,to=targetKey(row);
    if(!to)return {status:'skip',from,reason:DJI_NAME.test(row.file_name||'')?'schon umbenannt':'kein DJI-Name'};
    if(!to.startsWith(workspace+'/media/'))return {status:'skip',from,reason:'fremder Arbeitsbereich'};
    if(await head(to))return {status:'skip',from,to,reason:'Zielname existiert schon'};
    if(!apply)return {status:'plan',from,to};
    await s3.send(new CopyObjectCommand({Bucket:BUCKET,Key:to,CopySource:copySource(from),MetadataDirective:'COPY'}));
    const copy=await head(to);
    if(!copy||Number(copy.size)!==Number(row.size_bytes)){
      await dropCopy(to);
      throw new Error('Kopie unvollständig');
    }
    const res=await db.query(
      'UPDATE dji_pilot_media_verified SET object_key=$3,pilot_object_key=$2,etag=$4,object_last_modified=$5 '+
      'WHERE workspace_id=$1 AND object_key=$2 AND pilot_object_key IS NULL',
      [workspace,from,to,copy.etag,copy.lastModified]);
    if(res.rowCount!==1){                      // zwischendurch geaendert: eigene Kopie weg (nie eine referenzierte), Original bleibt
      await dropCopy(to);
      return {status:'skip',from,to,reason:'Eintrag geändert'};
    }
    // Original erst nach der Datenbank loeschen: schlaegt es fehl, bleibt nur eine ueberzaehlige Kopie (erneut ausfuehrbar).
    try{await s3.send(new DeleteObjectCommand({Bucket:BUCKET,Key:from}));}
    catch(err){log('[pilot media] DJI-Name: Original nicht gelöscht ('+(err?.name||'Fehler')+')');}
    return {status:'renamed',from,to};
  }

  const SELECT='SELECT object_key,grant_prefix,file_name,size_bytes FROM dji_pilot_media_verified '+
    'WHERE workspace_id=$1 AND pilot_object_key IS NULL';
  return {
    // nach einer bestaetigten Upload-Meldung (pilot-media-http.js); Fehler nur ins Log, die Meldung ist schon beantwortet
    renameKey(objectKey){
      return serial(async()=>{
        const {rows}=await db.query(SELECT+' AND object_key=$2',[workspace,objectKey]);
        if(rows.length!==1)return {status:'skip',reason:'nicht gefunden'};
        return renameRow(rows[0]);
      }).then(r=>{if(r.status==='renamed')log('[pilot media] DJI-Name: '+r.to.split('/').pop());return r;},
        err=>{log('[pilot media] DJI-Name fehlgeschlagen ('+(err?.name||'Fehler')+')');return {status:'error'};});
    },
    // einmaliges Nachziehen (scripts/pilot-media-dji-names.js); apply=false: nur Plan
    backfill({apply=false,limit=100000,onResult=()=>{}}={}){
      return serial(async()=>{
        const {rows}=await db.query(SELECT+' ORDER BY verified_at LIMIT $2',[workspace,limit]);
        const summary={total:rows.length,renamed:0,planned:0,skipped:{},errors:0};
        for(const row of rows){
          let r;
          try{r=await renameRow(row,{apply});}
          catch(err){r={status:'error',from:row.object_key,reason:err?.message||'Fehler'};}
          if(r.status==='renamed')summary.renamed++;
          else if(r.status==='plan')summary.planned++;
          else if(r.status==='error')summary.errors++;
          else summary.skipped[r.reason]=(summary.skipped[r.reason]||0)+1;
          onResult(r);
        }
        return summary;
      });
    }
  };
}

module.exports={renameConfig,createRenameS3,createPilotMediaRenamer,targetKey,DJI_NAME};
