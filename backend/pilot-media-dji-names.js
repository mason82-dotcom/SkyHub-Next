'use strict';
// Einmaliges Nachziehen: bereits bestaetigte Pilot-2-Medien im Bucket in ihre originalen DJI-Namen umbenennen.
// Laeuft im Backend-Container (gleiche Umgebung wie der Server). Standard ist ein Probelauf.
//   docker compose exec backend node pilot-media-dji-names.js                      Probelauf (aendert nichts)
//   docker compose exec backend node pilot-media-dji-names.js --apply --confirm UMBENENNEN
// Voraussetzungen: Migration 007 angewandt, SKYHUB_PILOT_MEDIA_DJI_NAMES=true und das Umbenenn-Konto
// (scripts/minio-pilot-media-renamer.sh). Ausgabe ohne Zugangsdaten; je Datei nur alter und neuer Name.
const {Pool}=require('pg');
const {renameConfig,createRenameS3,createPilotMediaRenamer}=require('./pilot-media-rename');

async function main(argv){
  const apply=argv.includes('--apply');
  if(apply&&argv[argv.indexOf('--confirm')+1]!=='UMBENENNEN'){
    console.error('Zum Umbenennen zusätzlich --confirm UMBENENNEN angeben.');return 2;
  }
  const cfg=renameConfig(process.env);
  if(!cfg.enabled){console.error('DJI-Namen nicht eingerichtet: '+(cfg.issue||'SKYHUB_PILOT_MEDIA_DJI_NAMES ist nicht true'));return 2;}
  const workspace=process.env.SKYHUB_PILOT_WORKSPACE_ID;
  if(!process.env.DATABASE_URL||!/^[0-9a-f-]{36}$/.test(workspace||'')){console.error('DATABASE_URL oder SKYHUB_PILOT_WORKSPACE_ID fehlt');return 2;}
  const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});
  try{
    const col=await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='dji_pilot_media_verified' AND column_name='pilot_object_key'");
    if(!col.rows.length){console.error('Migration 007 fehlt (Spalte pilot_object_key).');return 2;}
    const renamer=createPilotMediaRenamer({s3:createRenameS3(cfg),db:pool,workspace,log:m=>console.log(m)});
    let shown=0;
    const summary=await renamer.backfill({apply,onResult:r=>{
      if((r.status==='plan'||r.status==='renamed')&&shown<15){shown++;console.log((apply?'umbenannt  ':'würde      ')+r.from.split('/').pop()+'  ->  '+r.to.split('/').pop());}
      if(r.status==='error')console.log('FEHLER     '+r.from.split('/').pop()+': '+r.reason);
    }});
    console.log('\n'+(apply?'Umbenannt':'Probelauf')+': '+summary.total+' Einträge geprüft, '+
      (apply?summary.renamed+' umbenannt':summary.planned+' würden umbenannt')+', '+summary.errors+' Fehler');
    for(const [reason,n] of Object.entries(summary.skipped))console.log('  übersprungen ('+reason+'): '+n);
    if(!apply)console.log('\nNichts geändert. Umbenennen: node pilot-media-dji-names.js --apply --confirm UMBENENNEN');
    return summary.errors?1:0;
  }finally{await pool.end();}
}

main(process.argv.slice(2)).then(code=>process.exit(code),err=>{console.error('Abbruch: '+(err?.message||err));process.exit(1);});
