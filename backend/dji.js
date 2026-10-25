'use strict';

const {sanitizeKnownProperties} = require('./dji-properties');

// DJI Cloud API v1.18: allowlisted read-only parser. Not a write/onboarding implementation.
// Never store, log or forward topology keys or any unrecognized message properties.
function finite(value, min=-Infinity, max=Infinity) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}
function integer(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}
function serial(value) {
  return typeof value === 'string' && /^[\w.-]{1,100}$/.test(value) ? value : null;
}
function domain(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255) return String(value);
  return typeof value === 'string' && /^\d{1,3}$/.test(value) ? value : null;
}
function model(device) {
  return {
    domain: domain(device.domain),
    type: Number.isInteger(device.type) ? device.type : null,
    subType: Number.isInteger(device.sub_type) ? device.sub_type : null,
    // Pilot 2 and dock schemas differ: thing_version or version.
    thingVersion: (() => {
      const version = device.thing_version ?? device.version;
      if (typeof version === 'string' && version.length <= 32) return version;
      if (Number.isInteger(version) && version >= 0 && version < 10000) return String(version);
      return null;
    })()
  };
}
function parseTopic(topic) {
  const match=/^(thing|sys)\/product\/([^/]{1,100})\/(osd|state|events|services_reply|status)$/.exec(topic);
  if (!match || !serial(match[2]) ||
    (match[1] === 'sys' && match[3] !== 'status') ||
    (match[1] === 'thing' && match[3] === 'status')) return null;
  return {source:match[1],sn:match[2],channel:match[3]};
}
function extractTelemetry(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const battery=p.battery && typeof p.battery === 'object' ? p.battery : {};
  const batteries=Array.isArray(battery.batteries) ? battery.batteries : [];
  const position=p.position_state && typeof p.position_state === 'object' ? p.position_state : {};
  const link=p.wireless_link && typeof p.wireless_link === 'object' ? p.wireless_link : {};
  return {
    latitude:finite(p.latitude,-90,90),
    longitude:finite(p.longitude,-180,180),
    // DJI height = absolute ellipsoid height; elevation = relative to takeoff point.
    altitude:finite(p.elevation ?? p.height_above_takeoff),
    heightEllipsoid:finite(p.height),
    battery:finite(p.battery_percentage ?? p.capacity_percent ?? battery.capacity_percent ??
      batteries[0]?.capacity_percent,0,100),
    heading:finite(p.attitude_head ?? p.heading,-360,360),
    horizontalSpeed:finite(p.horizontal_speed,0),
    verticalSpeed:finite(p.vertical_speed),
    attitudePitch:finite(p.attitude_pitch,-180,180),
    attitudeRoll:finite(p.attitude_roll,-180,180),
    homeDistance:finite(p.home_distance,0),
    remainingFlightTime:integer(battery.remain_flight_time,0,86400),
    // GNSS quality as reported by DJI; satellite counts are not an accuracy guarantee.
    gpsSatellites:integer(position.gps_number,0,255),
    rtkSatellites:integer(position.rtk_number,0,255),
    rtkFixState:integer(position.is_fixed,0,3),
    positionQuality:integer(position.quality,0,10),
    // RC (gateway) OSD: SDR video/control link quality, 0-5.
    linkQuality:integer(link.sdr_quality,0,5),
    // Additional read-only DJI OSD fields. Missing values stay null.
    windSpeed:finite(p.wind_speed,0),
    // DJI defines eight compass sectors, not degrees.
    windDirectionCode:integer(p.wind_direction,1,8),
    totalFlightTime:finite(p.total_flight_time,0),
    totalFlightDistance:finite(p.total_flight_distance,0),
    // Gateway wireless_link: 65535 is an invalid/unavailable sentinel.
    sdrLinkState:integer(link.sdr_link_state,0,1),
    fourGLinkState:integer(link['4g_link_state'],0,1),
    fourGLinkQuality:integer(link['4g_quality'],0,5)
  };
}
function extractState(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return {
    // According to DJI, mode_code usually has pushMode=0 (OSD), not only state.
    modeCode:Number.isInteger(data.mode_code) ? data.mode_code : null,
    firmwareVersion:typeof data.firmware_version === 'string' && data.firmware_version.length <= 64
      ? data.firmware_version : null
  };
}
function extractTopology(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      !Array.isArray(data.sub_devices)) return null;
  return {
    model:model(data),
    children:data.sub_devices.slice(0,100).filter(d=>d && serial(d.sn)).map(d=>({
      sn:d.sn,
      model:model(d),
      index:(typeof d.index==='string' && d.index.length<=16) ||
        (Number.isInteger(d.index) && d.index>=0 && d.index<1000) ? String(d.index) : null
    }))
  };
}
// HMS code as upper-case 8-digit hex ("0x16100066"); DJI sends a hex string (dock)
// or the same value as a decimal integer (Pilot 2).
function hmsCode(value) {
  if (Number.isSafeInteger(value) && value >= 0 && value <= 0xFFFFFFFF)
    return '0x'+value.toString(16).toUpperCase().padStart(8,'0');
  if (typeof value === 'string' && /^0x[0-9a-f]{1,8}$/i.test(value))
    return '0x'+value.slice(2).toUpperCase().padStart(8,'0');
  return null;
}
function hmsItem(code, item, args) {
  return {
    code,
    level:Number.isInteger(item.level) && item.level>=0 && item.level<=2 ? item.level : null,
    module:Number.isInteger(item.module) ? item.module : null,
    deviceType:typeof item.device_type === 'string' && /^\d{1,3}-\d{1,4}-\d{1,3}$/.test(item.device_type)
      ? item.device_type : null,
    imminent:item.imminent===0 || item.imminent===1 ? item.imminent : null,
    componentIndex:integer(args.component_index,0,255),
    sensorIndex:integer(args.sensor_index,0,255)
  };
}
// Two shapes: dock {method:'hms', data:{list:[{code:'0x..',args:{...}}]}} and
// Pilot 2 {data:{event:'hms', method:'hms', output:{codes:[{id:<int>,...}]}}}.
// Only allowlisted fields are kept; unknown args never leave the parser.
function extractHms(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const pilot = data.event === 'hms' && data.method === 'hms' && data.output &&
    typeof data.output === 'object' && Array.isArray(data.output.codes);
  const list = pilot ? data.output.codes : data.list;
  if (!Array.isArray(list)) return null;
  return list.slice(0,50).filter(x=>x && typeof x === 'object').map(item=>{
    // Each shape has exactly one valid code type: integer id (Pilot) or hex string (dock).
    const code = pilot ? (Number.isSafeInteger(item.id) ? hmsCode(item.id) : null)
      : (typeof item.code === 'string' ? hmsCode(item.code) : null);
    if (!code) return null;
    const args = !pilot && item.args && typeof item.args === 'object' ? item.args : item;
    return hmsItem(code, item, args);
  }).filter(Boolean);
}
function isHms(method, data) {
  return method === 'hms' ||
    Boolean(data && typeof data === 'object' && data.event === 'hms' && data.method === 'hms');
}
// Field names only (never values) to compare real firmware payloads with the parser.
// DJI AirSense (thing/product/{gateway}/events, method airsense_warning): the data is an
// array of nearby manned aircraft. Only an aggregate is kept. The ICAO address, position and
// heading of third parties are never copied out of the raw message.
const MAX_AIRSENSE_ENTRIES = 50;
function extractAirsense(data) {
  if (!Array.isArray(data)) return null;
  let count = 0, maxWarningLevel = null, nearestDistanceM = null;
  for (const item of data.slice(0,MAX_AIRSENSE_ENTRIES)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const level = item.warning_level;
    if (!Number.isInteger(level) || level < 0 || level > 4) continue;
    count++;
    maxWarningLevel = maxWarningLevel === null ? level : Math.max(maxWarningLevel,level);
    const distance = item.distance;
    if (Number.isInteger(distance) && distance >= 0 && distance <= 1e7)
      nearestDistanceM = nearestDistanceM === null ? distance : Math.min(nearestDistanceM,distance);
  }
  return {count,maxWarningLevel,nearestDistanceM};
}
function dataKeys(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  return Object.keys(data).filter(key=>/^[A-Za-z0-9_]{1,48}$/.test(key)).sort().slice(0,64);
}
function parseMessage(topic,raw) {
  const meta=parseTopic(topic);
  if (!meta) return null;
  if (!raw || raw.length>131072) throw new Error('Invalid MQTT payload length');
  const envelope=JSON.parse(raw.toString('utf8'));
  if (!envelope || typeof envelope!=='object' || Array.isArray(envelope))
    throw new Error('Invalid DJI envelope');
  const hasTimestamp=Object.prototype.hasOwnProperty.call(envelope,'timestamp');
  if (hasTimestamp && (!Number.isSafeInteger(envelope.timestamp) ||
      envelope.timestamp < 1e12 || envelope.timestamp > 1e15)) {
    throw new Error('Invalid DJI timestamp');
  }
  const data=envelope.data;
  // Pilot 2 HMS carries its method inside data; expose it as 'hms' for events and shapes.
  const method=typeof envelope.method==='string' ? envelope.method.slice(0,80) :
    meta.channel==='events' && isHms(null,data) ? 'hms' : null;
  return {
    ...meta,method,
    timestamp:hasTimestamp ? envelope.timestamp : null,
    gatewaySn:serial(envelope.gateway),
    needReply:envelope.need_reply===1,
    dataKeys:dataKeys(data),
    // Bounded, field-allowlisted values only; never expose raw DJI data.
    propertyValues:['osd','state'].includes(meta.channel) ?
      sanitizeKnownProperties(data,meta.channel) : null,
    telemetry:meta.channel==='osd' ? extractTelemetry(data) : null,
    state:meta.channel==='state' || meta.channel==='osd' ? extractState(data) : null,
    topology:meta.channel==='status' && method==='update_topo' ? extractTopology(data) : null,
    hms:meta.channel==='events' && isHms(method,data) ? extractHms(data) : null,
    airsense:meta.channel==='events' && method==='airsense_warning' ? extractAirsense(data) : null
  };
}
function fresh(last,now=Date.now()) {
  return Number.isFinite(last) && last<=now && now-last<15000;
}
module.exports={finite,integer,dataKeys,extractAirsense,serial,domain,model,parseTopic,extractTelemetry,extractState,extractTopology,extractHms,hmsCode,parseMessage,fresh};
