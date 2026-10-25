'use strict';

// Metadata extracted from pinned DJI Cloud-API-Doc property tables.
// Only whitelisted, bounded read-only property values are accepted.
// Neither DJI command/set topics nor raw MQTT envelopes are exposed.
const catalog = require('./data/dji-cloud-api-118-fields.json');

function makeTree(fields) {
  const root = {children: Object.create(null)};
  for (const field of fields) {
    const parts = field.path.split('.');
    let node = root;
    for (const part of parts) {
      if (!Object.hasOwn(node.children, part))
        node.children[part] = {children: Object.create(null)};
      node = node.children[part];
    }
    node.type = field.type;
    node.push = field.push;
    node.min = field.min;
    node.max = field.max;
    node.length = field.length;
    node.enum = field.enum;
    node.privacy = field.privacy;
  }
  // A nested property's pushMode column may be 0 even when its
  // containing top-level struct/array is reported on state.
  return root;
}
// A device-specific overlay extends an official family table without
// duplicating/potentially drifting 144 pinned base definitions. Only one
// inheritance level is supported, and duplicate paths are rejected.
function resolveProfile(name) {
  const definition=catalog.profiles[name];
  if (!definition) return null;
  if (!definition.extends) return definition;
  const base=catalog.profiles[definition.extends];
  if (!base || base.extends) throw Error('Invalid DJI profile inheritance');
  const seen=new Set(base.fields.map(item=>item.path));
  for(const item of definition.fields){
    if(seen.has(item.path)) throw Error('Duplicate inherited DJI field: '+item.path);
    seen.add(item.path);
  }
  return {
    ...base,...definition,
    source:base.source,
    sourceBlob:base.sourceBlob,
    fields:[...base.fields,...definition.fields]
  };
}
const resolvedProfiles=Object.fromEntries(Object.keys(catalog.profiles)
  .map(name=>[name,resolveProfile(name)]));
const trees=Object.fromEntries(Object.entries(resolvedProfiles)
  .map(([key,value])=>[key,makeTree(value.fields)]));

function deviceProfile(model) {
  if (!model || typeof model !== 'object') return null;
  const key = [model.domain, model.type, model.subType].join(':');
  const mapping = catalog.devices[key];
  return mapping ? {name:mapping.profile, confidence:mapping.confidence} : null;
}
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function cleanText(value, path, length) {
  if (typeof value !== 'string') return undefined;
  const limit = Math.min(Number.isInteger(length) ? length : 64, 64);
  if (value.length > limit) return undefined;
  if (path.endsWith('firmware_version') && /^[A-Za-z0-9_.-]{1,64}$/.test(value)) return value;
  if (path === 'country' && /^[A-Za-z]{2,3}$/.test(value)) return value;
  // Version only, never arbitrary payload strings or identifiers.
  if (path === 'wpmz_version' && /^\d{1,4}(?:\.\d{1,4}){1,3}$/.test(value)) return value;
  if ((path.endsWith('payload_index') || path.endsWith('camera_index')) &&
      /^\d{1,4}-\d{1,4}-\d{1,2}$/.test(value)) return value;
  if (path.endsWith('.video_index') && /^\d{1,3}$/.test(value)) return value;
  // DJI documents video lens types as finite labels, not user-supplied strings.
  if ((path.endsWith('.video_type') || path.endsWith('.switchable_video_types')) &&
      ['normal','wide','zoom','ir','infrared','thermal','visible','narrow_band','fpv'].includes(value))
    return value;
  // All other text fields can contain SNs, IMEIs, video URLs, arbitrary
  // operator text, network configuration or account identifiers.
  return undefined;
}
const MAX_ARRAY_ITEMS = 8;
const MAX_DEPTH = 7;
const DYNAMIC_PAYLOAD_KEY = /^\d{1,3}-\d{1,3}-\d{1,2}$/;
// The aircraft reference documents this dynamically keyed OSD struct.
// Its key is a payload type index, not an aircraft serial number.
const DYNAMIC_GIMBAL_FIELDS = Object.freeze({
  gimbal_pitch:{type:'double',min:-180,max:180},
  gimbal_roll:{type:'double',min:-180,max:180},
  gimbal_yaw:{type:'double',min:-180,max:180},
  measure_target_longitude:{type:'double',min:-180,max:180},
  measure_target_latitude:{type:'double',min:-90,max:90},
  measure_target_altitude:{type:'double'},
  measure_target_distance:{type:'double',min:0},
  measure_target_error_state:{type:'enum_int',enum:[0,1,2,3]},
  zoom_factor:{type:'double',min:0}
});
function dynamicPayloadEntry(raw,key) {
  if (!DYNAMIC_PAYLOAD_KEY.test(key) || !isObject(raw)) return undefined;
  const out=Object.create(null);
  out.payload_index=key;
  let count=0;
  for (const [field,spec] of Object.entries(DYNAMIC_GIMBAL_FIELDS)) {
    if (!Object.hasOwn(raw,field)) continue;
    const parsed=cleanValue(raw[field],spec,field,1);
    if (parsed!==undefined) {out[field]=parsed;count++;}
  }
  // A key by itself is not an observed gimbal value.
  if (!count) return undefined;
  const lat=out.measure_target_latitude,lon=out.measure_target_longitude;
  // The documented ranging states 1/2/3 mean too close, too far or no signal.
  // Preserve the diagnostic enum but never surface a laser target or range as
  // freshly measured when the sensor reports a ranging error.
  if (out.measure_target_error_state!==undefined && out.measure_target_error_state!==0) {
    delete out.measure_target_latitude;
    delete out.measure_target_longitude;
    delete out.measure_target_altitude;
    delete out.measure_target_distance;
  } else if ((lat!==undefined || lon!==undefined) &&
      (lat===undefined || lon===undefined || (lat===0 && lon===0))) {
    delete out.measure_target_latitude;
    delete out.measure_target_longitude;
  }
  // After rejecting an incomplete target pair, a key alone is not telemetry.
  return Object.keys(out).length>1 ? out : undefined;
}
function dynamicPayloadEntries(data) {
  if (!isObject(data)) return [];
  const out=[];
  for (const key of Object.keys(data)) {
    if (!DYNAMIC_PAYLOAD_KEY.test(key)) continue;
    const valid=dynamicPayloadEntry(data[key],key);
    if (valid) out.push(valid);
    if (out.length>=MAX_ARRAY_ITEMS) break;
  }
  return out;
}

function cleanValue(value, node, path, depth) {
  if (depth > MAX_DEPTH) return undefined;
  // Fields the schema marks as redacted never leave the parser, whatever their type.
  if (node.privacy === 'redacted') return undefined;
  const type = node.type;
  if (type === 'struct') {
    if (!isObject(value)) return undefined;
    const result = Object.create(null);
    for (const [key, child] of Object.entries(node.children)) {
      if (!Object.hasOwn(value, key)) continue;
      const cleaned = cleanValue(value[key], child, path+'.'+key, depth+1);
      if (cleaned !== undefined) result[key] = cleaned;
    }
    return Object.keys(result).length ? result : undefined;
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return undefined;
    // DJI's documented switchable_video_types array consists of lens labels.
    // Do not enable arbitrary primitive arrays in other schema locations.
    if (path.endsWith('.switchable_video_types')) {
      const labels = value.slice(0, MAX_ARRAY_ITEMS)
        .map(item => cleanText(item, path, 24))
        .filter(item => item !== undefined);
      return labels.length ? labels : undefined;
    }
    if (!Object.keys(node.children).length) return undefined;
    const items = value.slice(0, MAX_ARRAY_ITEMS)
      .map(item => cleanValue(item, {type:'struct',children:node.children}, path, depth+1))
      .filter(item => item !== undefined &&
        // An index without a numeric widget value is not a measurement.
        // Other arrays (cameras, batteries, PSDK readiness) may legitimately
        // carry identifiers/indexes without every optional field.
        (path !== 'psdk_widget_values.values' || Object.hasOwn(item,'value')));
    return items.length ? items : undefined;
  }
  if (type === 'bool') {
    if (typeof value === 'boolean') return value;
    return value === 0 ? false : value === 1 ? true : undefined;
  }
  if (type === 'text') return cleanText(value, path, node.length);
  if (type === 'enum_string') {
    return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value) ? value : undefined;
  }
  if (['int','enum_int','enum','date','float','double'].includes(type)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    if (['int','enum_int','enum','date'].includes(type) && !Number.isSafeInteger(value)) return undefined;
    // DJI's older Mavic 3/aircraft documents use a positive float-machine
    // bound (-1.4E-45) for GPS longitude/latitude. It is not a valid WGS84
    // geographic bound and would reject the entire Western/Southern world.
    // Validate geographical coordinates explicitly instead.
    if (['latitude','home_latitude','measure_target_latitude'].includes(path))
      return value >= -90 && value <= 90 ? value : undefined;
    if (['longitude','home_longitude','measure_target_longitude'].includes(path))
      return value >= -180 && value <= 180 ? value : undefined;
    if (Number.isFinite(node.min) && value < node.min) return undefined;
    if (Number.isFinite(node.max) && value > node.max) return undefined;
    // Where DJI explicitly enumerates values, do not treat unknown codes
    // (including 65535 link sentinels) as a valid property state.
    // A future firmware may add codes: update the pinned schema after review.
    if (['enum_int','enum','enum_string'].includes(type) &&
        Array.isArray(node.enum) && node.enum.length && !node.enum.includes(value))
      return undefined;
    if (Math.abs(value) > 1e15) return undefined;
    return value;
  }
  return undefined;
}
function sanitizeProfile(data, tree, channel) {
  if (!isObject(data) || !['osd','state'].includes(channel)) return {};
  const result = Object.create(null);
  for (const [key, node] of Object.entries(tree.children)) {
    if (node.push !== (channel === 'state' ? 1 : 0) || !Object.hasOwn(data, key)) continue;
    const cleaned = cleanValue(data[key], node, key, 0);
    if (cleaned !== undefined) result[key] = cleaned;
  }
  return result;
}
// Preserve distinct documented children when two official aircraft families
// share the same top-level struct/array. Never merge unsanitized raw objects.
function mergeKnown(target, source) {
  for (const [key, value] of Object.entries(source)) {
    const prior = target[key];
    if (Array.isArray(value) && Array.isArray(prior)) {
      value.forEach((item,index) => {
        if (isObject(item) && isObject(prior[index])) mergeKnown(prior[index],item);
        else if (prior[index] === undefined) prior[index] = item;
      });
    } else if (isObject(value) && isObject(prior)) {
      mergeKnown(prior,value);
    } else if (prior === undefined) target[key] = value;
  }
  return target;
}
// Superset is built before lookup because update_topo and OSD may arrive
// in different orders. All unrecognized keys and untrusted strings are discarded.
function sanitizeKnownProperties(data, channel) {
  const out = Object.create(null);
  for (const tree of Object.values(trees))
    mergeKnown(out, sanitizeProfile(data, tree, channel));
  // Only a documented aircraft model may expose this later; the superset
  // is still sanitized and never forwards arbitrary numeric-looking keys.
  if (channel==='osd') {
    const payloads=dynamicPayloadEntries(data);
    if (payloads.length) out.payload_gimbals=payloads;
  }
  return out;
}
function sanitizeDeviceProperties(known, channel, model) {
  const profile = deviceProfile(model);
  if (!profile) return {};
  const result=sanitizeProfile(known, trees[profile.name], channel);
  if (channel==='osd' && profile.name==='matrice4T' &&
      Array.isArray(known?.payload_gimbals)) {
    // Defend the public helper against unsanitized direct callers as well.
    const items=known.payload_gimbals.slice(0,MAX_ARRAY_ITEMS)
      .map(item=>dynamicPayloadEntry(item,item?.payload_index))
      .filter(Boolean);
    if (items.length) result.payload_gimbals=items;
  }
  return result;
}
// Field inventory must not report intentionally censored identifiers as
// missing telemetry. This reports capability, never an observed field value.
function fieldAvailabilityPolicy(field, profileFields) {
  if (!field || typeof field.path !== 'string') return 'unavailable';
  if (field.privacy === 'redacted') return 'redacted';
  if (field.type === 'text') {
    const p=field.path;
    const safe=p === 'country' || p.endsWith('firmware_version') ||
      p.endsWith('.payload_index') || p.endsWith('.camera_index') ||
      p.endsWith('.video_index') || p.endsWith('.video_type');
    return safe ? 'inspectable' : 'redacted';
  }
  if (field.type === 'array') {
    if (field.path.endsWith('.switchable_video_types')) return 'inspectable';
    // DJI's legacy spec leaves the item schema out for these arrays.
    // A raw, untyped array must never be forwarded.
    if (!profileFields.some(other=>other.path.startsWith(field.path+'.')))
      return 'unsupported-array';
  }
  return 'inspectable';
}
function fieldDefinitions(model) {
  const profile = deviceProfile(model);
  if (!profile) return null;
  const source = resolvedProfiles[profile.name];
  return {profile:profile.name,confidence:profile.confidence,
    source:source.source,
    sourceEdition:source.sourceEdition??null,
    extensionSource:source.extensionSource??null,
    extensionSourceEdition:source.extensionSourceEdition??null,
    extensionVerifiedAt:source.extensionVerifiedAt??null,
    provenance:source.provenance??null,
    extensionEvidence:source.extensionEvidence??null,
    extensionStatus:source.extensionStatus??null,
    inheritedFrom:source.extends??null,
    fields:source.fields,
    dynamicPayload:source.dynamicPayload??null};
}
module.exports = {deviceProfile,fieldDefinitions,fieldAvailabilityPolicy,
  sanitizeKnownProperties,sanitizeDeviceProperties,MAX_ARRAY_ITEMS,
  dynamicPayloadEntries};
