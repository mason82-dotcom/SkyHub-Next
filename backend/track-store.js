'use strict';

// PostGIS track history: additive migration, insert, bounded query, retention.
// schema.sql only runs on a fresh database, so new columns are added at startup.
const MIGRATION=[
  `ALTER TABLE drone_telemetry
     ADD COLUMN IF NOT EXISTS source_ts TIMESTAMPTZ,
     ADD COLUMN IF NOT EXISTS time_verified BOOLEAN,
     ADD COLUMN IF NOT EXISTS height_ellipsoid DOUBLE PRECISION,
     ADD COLUMN IF NOT EXISTS gps_satellites SMALLINT,
     ADD COLUMN IF NOT EXISTS rtk_satellites SMALLINT,
     ADD COLUMN IF NOT EXISTS rtk_fix_state SMALLINT,
     ADD COLUMN IF NOT EXISTS position_quality SMALLINT`,
  `CREATE INDEX IF NOT EXISTS idx_telemetry_device_time ON drone_telemetry (device_sn, created_at DESC)`,
  // Hourly retention deletes filter on created_at alone; PostgreSQL 15 cannot skip-scan the index above.
  `CREATE INDEX IF NOT EXISTS idx_telemetry_created_at ON drone_telemetry (created_at)`
];
const MAX_POINTS=5000;
const MAX_MINUTES=1440;

function retentionDays(value){
  if(value===undefined || value==='')return 30;
  const days=Number(value);
  if(!Number.isInteger(days) || days<1 || days>3650)
    throw new Error('SKYHUB_TRACK_RETENTION_DAYS must be an integer from 1 to 3650');
  return days;
}

function createTrackStore(pool){
  return {
    async migrate(){
      if(!pool)return;
      for(const sql of MIGRATION)await pool.query(sql);
    },
    async insert(p){
      if(!pool)return;
      await pool.query(
        'INSERT INTO drone_telemetry (gateway_sn,device_sn,latitude,longitude,altitude,battery_percentage,'+
        'source_ts,time_verified,height_ellipsoid,gps_satellites,rtk_satellites,rtk_fix_state,position_quality,geom) '+
        'VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7::double precision/1000),$8,$9,$10,$11,$12,$13,'+
        'ST_SetSRID(ST_MakePoint($4,$3),4326))',
        [p.gatewaySn,p.deviceSn,p.latitude,p.longitude,p.altitude,p.battery,
          p.sourceTs,p.timeVerified,p.heightEllipsoid,p.gpsSatellites,p.rtkSatellites,
          p.rtkFixState,p.positionQuality]);
    },
    // Newest points first in SQL (so the limit keeps the recent end), returned oldest first.
    async track(deviceSn,minutes){
      if(!pool)return [];
      const span=Math.min(Math.max(Math.trunc(Number(minutes))||60,1),MAX_MINUTES);
      const {rows}=await pool.query(
        'SELECT (extract(epoch FROM coalesce(source_ts,created_at))*1000)::bigint AS t,'+
        ' latitude,longitude,altitude,time_verified FROM drone_telemetry'+
        ' WHERE device_sn=$1 AND created_at > now() - make_interval(mins => $2)'+
        ' AND NOT (latitude=0 AND longitude=0)'+
        ' ORDER BY created_at DESC LIMIT $3',
        [deviceSn,span,MAX_POINTS]);
      return rows.reverse().map(r=>({t:Number(r.t),latitude:r.latitude,longitude:r.longitude,
        altitude:r.altitude,timeVerified:r.time_verified}));
    },
    async prune(days){
      if(!pool)return 0;
      const {rowCount}=await pool.query(
        'DELETE FROM drone_telemetry WHERE created_at < now() - make_interval(days => $1)',[days]);
      return rowCount;
    }
  };
}
module.exports={createTrackStore,retentionDays,MAX_POINTS,MAX_MINUTES};
