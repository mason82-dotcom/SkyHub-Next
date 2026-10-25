'use strict';

const { fresh, serial } = require('./dji');
const {deviceProfile,sanitizeDeviceProperties} = require('./dji-properties');
const { resolveDeviceModel, category } = require('./catalog');
const { describeHms } = require('./hms-catalog');

// DJI aircraft mode_code 14 = "Not connected": Pilot 2 keeps publishing the aircraft's
// last known OSD values after the aircraft is switched off or loses its link.
const AIRCRAFT_NOT_CONNECTED = 14;

// HMS lists are pushed repeatedly while alerts are active; older lists are shown as stale.
const HMS_FRESH_MS = 30000;

// Collect sanitized DJI property paths only; array indexes and payload
// device identifiers are never embedded in the observation-time keys.
function propertyPaths(obj,prefix='',out=new Set()) {
  if (Array.isArray(obj)) {
    for (const value of obj) propertyPaths(value,prefix,out);
    return out;
  }
  if (!obj || typeof obj!=='object') return out;
  for(const [key,value] of Object.entries(obj)) {
    if (prefix==='payload_gimbals' && key==='payload_index') continue;
    const p=prefix ? prefix+'.'+key : key;
    out.add(p);
    propertyPaths(value,p,out);
  }
  return out;
}

// Periodic repeats of the complete HMS list and of AirSense warnings are state, not events.
// An event is recorded only when the set of alerts or the AirSense danger level changes.
function hmsSignature(list) {
  return list.map(a=>[a.code,a.level,a.componentIndex,a.sensorIndex].join(':')).sort().join(',');
}
function airsenseLevel(summary) {
  return summary && summary.count > 0 && summary.maxWarningLevel !== null ? summary.maxWarningLevel : -1;
}
const PERIODIC_EVENT_METHODS = new Set(['hms','airsense_warning']);

function createRegistry(limit = 200) {
  const devices = new Map();
  const events = [];
  function safeDevice(d, now = Date.now()) {
    return {
      sn: d.sn, role: d.role, gatewaySn: d.gatewaySn,
      model: d.model, modelName: resolveDeviceModel(d.model),
      deviceCategory: category(d.model.domain), topologyOnline: d.topologyOnline,
      // topologyOnline is the last reported topology fact and stays true until a later
      // topology message revokes it. `online` additionally requires fresh OSD telemetry.
      online: d.topologyOnline === true && fresh(d.lastTelemetryAt, now),
      lastTopologyAt: d.lastTopologyAt, topologyTimeVerified: d.topologyTimeVerified,
      topologyRestored: d.topologyRestored, aircraftConnected: d.aircraftConnected,
      children: [...d.children], channel: d.channel,
      modeCode: d.modeCode, firmwareVersion: d.firmwareVersion,
      propertyProfile: deviceProfile(d.model),
      // Values are allowlisted and redacted; per-channel timestamp prevents
      // a state update from masquerading as a fresh OSD measurement.
      deviceProperties: {
        osd: {...d.deviceProperties.osd},
        state: {...d.deviceProperties.state}
      },
      propertyObservedAt: {...d.propertyObservedAt},
      propertyFieldObservedAt: {
        osd: {...d.propertyFieldObservedAt.osd},
        state: {...d.propertyFieldObservedAt.state}
      },
      lastSeenAt: d.lastSeenAt, lastTelemetryAt: d.lastTelemetryAt,
      lastPositionAt: d.lastPositionAt,
      positionUnavailable: d.positionUnavailable,
      telemetryTimeVerified: d.telemetryTimeVerified,
      positionTimeVerified: d.positionTimeVerified,
      fresh: fresh(d.lastTelemetryAt, now),
      // DJI can report 0/0 in fresh OSD without providing a valid GPS fix.
      positionFresh: !d.positionUnavailable && fresh(d.lastPositionAt, now), telemetry: { ...d.telemetry },
      // Per-field timestamps and source-time provenance live only in memory.
      telemetryFieldAt: {...d.telemetryFieldAt},
      telemetryFieldTimeVerified: {...d.telemetryFieldTimeVerified},
      hms: d.hms.map(alert => ({...alert,
        text: describeHms(alert, {domain: d.model.domain, modeCode: d.modeCode})})),
      // Aggregate of nearby manned aircraft (AirSense/ADS-B); no ICAO, position or heading.
      airsense: d.airsense ? {...d.airsense, fresh: fresh(d.airsense.observedAt, now)} : null,
      lastHmsAt: d.lastHmsAt, hmsTimeVerified: d.hmsTimeVerified,
      hmsFresh: Number.isFinite(d.lastHmsAt) && d.lastHmsAt <= now && now - d.lastHmsAt < HMS_FRESH_MS
    };
  }
  // At the limit, make room by evicting the LEAST RECENTLY SEEN device that no gateway has vouched
  // for (no update_topo seen or restored). Topology-confirmed devices (the RC and its aircraft) go
  // only when nothing else is left, so a flood of invented serials cannot push them out. A `gateway`
  // field in an OSD message is NOT a vouch: any publisher can set it.
  function evictOne() {
    let victim = null;
    for (const [sn, d] of devices) {
      const confirmed = Number.isFinite(d.lastTopologyAt) ? 1 : 0;
      const seen = Number.isFinite(d.lastSeenAt) ? d.lastSeenAt : -Infinity;
      if (!victim || confirmed < victim.confirmed || (confirmed === victim.confirmed && seen < victim.seen)) {
        victim = { sn, confirmed, seen };
      }
    }
    if (victim) devices.delete(victim.sn);
  }
  function ensure(sn) {
    if (devices.has(sn)) return devices.get(sn);
    if (devices.size >= limit) evictOne();
    const d = {
      sn, role: 'unknown', gatewaySn: null,
      model: {domain:null,type:null,subType:null,thingVersion:null},
      topologyOnline: null, lastTopologyAt: null, topologyTimeVerified: null,
      topologyRestored: false, aircraftConnected: null,
      children: [], channel: null,
      modeCode: null, firmwareVersion: null, lastSeenAt: null,
      lastTelemetryAt: null, lastPositionAt: null,
      telemetryTimeVerified: null, positionTimeVerified: null,
      positionUnavailable: false,
      telemetryFieldAt: Object.create(null),
      telemetryFieldTimeVerified: Object.create(null),
      hms: [], hmsSignature: '', airsense: null, lastHmsAt: null, hmsTimeVerified: null,
      deviceProperties: {osd: Object.create(null),state: Object.create(null)},
      propertyObservedAt: {osd:null,state:null},
      propertyFieldObservedAt: {osd:Object.create(null),state:Object.create(null)},
      lastByChannel: Object.create(null),
      telemetry: { latitude:null,longitude:null,altitude:null,heightEllipsoid:null,battery:null,
        heading:null,horizontalSpeed:null,verticalSpeed:null,
        attitudePitch:null,attitudeRoll:null,homeDistance:null,remainingFlightTime:null,
        gpsSatellites:null,rtkSatellites:null,rtkFixState:null,positionQuality:null,
        linkQuality:null,windSpeed:null,windDirectionCode:null,
        totalFlightTime:null,totalFlightDistance:null,
        sdrLinkState:null,fourGLinkState:null,fourGLinkQuality:null }
    };
    devices.set(sn, d);
    return d;
  }
  function ingest(message, now = Date.now()) {
    if (!message) return { updates:[], event:null, point:null };
    const existing = devices.get(message.sn);
    const prior = existing?.lastByChannel[message.channel];
    // Retained or delayed MQTT packets must not overwrite later snapshots.
    if (Number.isFinite(prior) && message.timestamp === null) {
      return { updates:[], event:null, point:null, dropReason:'missing_timestamp_after_verified' };
    }
    if (message.timestamp !== null && Number.isFinite(prior) && message.timestamp <= prior) {
      return { updates:[], event:null, point:null, dropReason:'duplicate' };
    }
    const d = ensure(message.sn);
    const updates = new Map();
    d.channel = message.channel;
    d.lastSeenAt = now;
    // Timestamp provenance stays visible: unverified arrival time is not device time.
    const observedAt = message.timestamp === null ? now : Math.min(message.timestamp, now);
    if (message.timestamp !== null) d.lastByChannel[message.channel] = message.timestamp;
    if (message.gatewaySn && message.gatewaySn !== message.sn) {
      d.gatewaySn = message.gatewaySn;
      if (d.role === 'unknown') d.role = 'subdevice';
    }
    let point = null;
    const aircraft = d.model.domain === '0' || (d.model.domain === null && d.role === 'subdevice');
    if (aircraft && message.channel === 'osd' &&
        Number.isInteger(message.state?.modeCode)) {
      // OSD without a mode_code is not proof a previously disconnected
      // aircraft has reconnected. Keep replay protection until a code arrives.
      d.aircraftConnected = message.state.modeCode !== AIRCRAFT_NOT_CONNECTED;
    }
    // Replayed last-known values of a disconnected aircraft are not telemetry.
    if (message.telemetry && d.aircraftConnected !== false) {
      // Only recognized, normalized numeric DJI measurements can influence freshness.
      const values=Object.entries(message.telemetry).filter(
        ([key,value])=>Object.hasOwn(d.telemetry,key)&&Number.isFinite(value));
      // An atomic WGS84 coordinate pair is valid with or without RTK.
      const lat=message.telemetry.latitude,lon=message.telemetry.longitude;
      const hasPair=Number.isFinite(lat)&&Number.isFinite(lon);
      const nullPosition=hasPair&&lat===0&&lon===0;
      if (values.length) {
        // Retain non-position telemetry (battery, radio etc.) even without GPS.
        for (const [key, value] of values) {
          if (key === 'latitude' || key === 'longitude' ||
              !Object.hasOwn(d.telemetry,key) || !Number.isFinite(value)) continue;
          d.telemetry[key] = value;
          d.telemetryFieldAt[key] = observedAt;
          d.telemetryFieldTimeVerified[key] = message.timestamp !== null;
        }
        if (hasPair) {
          d.positionUnavailable=nullPosition;
          if (!nullPosition) {
            d.telemetry.latitude=lat;
            d.telemetry.longitude=lon;
            d.lastPositionAt=observedAt;
            d.positionTimeVerified=message.timestamp!==null;
            // GPS is an atomic pair: 0/0 and partial packets never refresh either field.
            d.telemetryFieldAt.latitude=observedAt;
            d.telemetryFieldAt.longitude=observedAt;
            d.telemetryFieldTimeVerified.latitude=message.timestamp!==null;
            d.telemetryFieldTimeVerified.longitude=message.timestamp!==null;
          }
        }
        // Lone latitude/longitude packets contain no complete GPS measurement.
        // Keep the last actual OSD measurement time unchanged for those packets.
        if(hasPair||values.some(([key])=>key!=='latitude'&&key!=='longitude')){
          d.lastTelemetryAt=observedAt;
          d.telemetryTimeVerified=message.timestamp!==null;
        }
      }
      // Null position never becomes a new track point or a fresh GPS fix.
      if (hasPair&&!nullPosition) {
        point = {
          deviceSn: d.sn, gatewaySn: d.gatewaySn,
          latitude: message.telemetry.latitude,
          longitude: message.telemetry.longitude,
          altitude: message.telemetry.altitude,
          battery: message.telemetry.battery
        };
      }
    }
    // Retain only officially documented, schema-typed read-only fields.
    // Do not update aircraft OSD from Pilot's disconnected replay (mode 14).
    if (message.propertyValues && ['osd','state'].includes(message.channel) &&
        (message.channel !== 'osd' || d.aircraftConnected !== false)) {
      const properties = sanitizeDeviceProperties(message.propertyValues,message.channel,d.model);
      if (message.channel === 'osd' &&
          (d.model.domain === '0' || d.model.domain === '2')) {
        // Keep the raw-property snapshot consistent with the validated GPS
        // adapter: a partial coordinate pair or DJI's (0,0) placeholder
        // must never overwrite the last accepted position.
        const lat=properties.latitude, lon=properties.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
            (lat === 0 && lon === 0) ||
            Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          delete properties.latitude;
          delete properties.longitude;
        }
      }
      if (Object.keys(properties).length) {
        Object.assign(d.deviceProperties[message.channel],properties);
        d.propertyObservedAt[message.channel] = observedAt;
        // A newly reported field does not refresh absent, older fields.
        for(const key of propertyPaths(properties))
          d.propertyFieldObservedAt[message.channel][key]=observedAt;
      }
    }
    // Each HMS message carries the complete list of currently active alerts.
    let hmsChanged = false, airsenseChanged = false;
    if (Array.isArray(message.hms)) {
      const signature = hmsSignature(message.hms);
      hmsChanged = signature !== d.hmsSignature;
      d.hmsSignature = signature;
      d.hms = message.hms.map(alert => ({...alert}));
      d.lastHmsAt = observedAt;
      d.hmsTimeVerified = message.timestamp !== null;
    }
    if (message.airsense) {
      airsenseChanged = airsenseLevel(d.airsense) !== airsenseLevel(message.airsense);
      d.airsense = {...message.airsense, observedAt, timeVerified: message.timestamp !== null};
    }
    if (message.state) {
      if (message.state.modeCode !== null) d.modeCode = message.state.modeCode;
      if (message.state.firmwareVersion !== null) d.firmwareVersion = message.state.firmwareVersion;
    }
    if (message.topology) {
      d.role = 'gateway';
      d.topologyRestored = false;
      d.topologyOnline = true;
      d.lastTopologyAt = observedAt;
      d.topologyTimeVerified = message.timestamp !== null;
      const previousProfile = deviceProfile(d.model)?.name;
      d.model = message.topology.model;
      if (previousProfile !== deviceProfile(d.model)?.name) {
        d.deviceProperties = {osd:Object.create(null),state:Object.create(null)};
        d.propertyObservedAt = {osd:null,state:null};
        d.propertyFieldObservedAt = {osd:Object.create(null),state:Object.create(null)};
      }
      const priorChildren = new Set(d.children);
      const children = message.topology.children.map(x => x.sn).filter(sn => sn !== d.sn);
      const unique = [...new Set(children)];
      d.children = unique;
      for (const sn of priorChildren) {
        if (unique.includes(sn)) continue;
        const child = devices.get(sn);
        if (child && child.gatewaySn === d.sn) {
          child.topologyOnline = false;
          child.topologyRestored = false;
          child.lastTopologyAt = observedAt;
          child.topologyTimeVerified = message.timestamp !== null;
          updates.set(sn, child);
        }
      }
      for (const childData of message.topology.children) {
        if (childData.sn === d.sn) continue;
        const child = ensure(childData.sn);
        child.gatewaySn = d.sn;
        child.role = 'subdevice';
        child.topologyRestored = false;
        child.topologyOnline = true;
        child.lastTopologyAt = observedAt;
        child.topologyTimeVerified = message.timestamp !== null;
        const previousChildProfile = deviceProfile(child.model)?.name;
        child.model = childData.model;
        if (previousChildProfile !== deviceProfile(child.model)?.name) {
          child.deviceProperties = {osd:Object.create(null),state:Object.create(null)};
          child.propertyObservedAt = {osd:null,state:null};
          child.propertyFieldObservedAt = {osd:Object.create(null),state:Object.create(null)};
        }
        updates.set(child.sn, child);
      }
    }
    updates.set(d.sn, d);
    let event = null;
    if (['events','status','services_reply'].includes(message.channel)) {
      const periodic = message.channel === 'events' && PERIODIC_EVENT_METHODS.has(message.method);
      const changed = (Array.isArray(message.hms) && hmsChanged) || (message.airsense && airsenseChanged);
      if (!periodic || changed) {
        event = {sn:d.sn,channel:message.channel,method:message.method,at:now};
        events.unshift(event);
        if (events.length > 100) events.pop();
      }
    }
    return {updates:[...updates.values()].map(device => safeDevice(device,now)),event,point,
      topologyChanged:Boolean(message.topology)};
  }
  // Topology only (never telemetry), for persistence across backend restarts.
  function topologyRecords(sns) {
    const wanted = sns ? new Set(sns) : null;
    return [...devices.values()]
      .filter(d => (!wanted || wanted.has(d.sn)) && Number.isFinite(d.lastTopologyAt) &&
        (d.role === 'gateway' || d.role === 'subdevice'))
      .map(d => ({
        sn:d.sn, role:d.role, gatewaySn:d.gatewaySn, model:{...d.model},
        topologyOnline:d.topologyOnline, lastTopologyAt:d.lastTopologyAt,
        topologyTimeVerified:d.topologyTimeVerified, children:[...d.children],
        statusTimestamp:Number.isFinite(d.lastByChannel.status) ? d.lastByChannel.status : null
      }));
  }
  function validModel(m) {
    return m && typeof m === 'object' &&
      (m.domain === null || (typeof m.domain === 'string' && /^\d{1,3}$/.test(m.domain))) &&
      (m.type === null || Number.isInteger(m.type)) &&
      (m.subType === null || Number.isInteger(m.subType)) &&
      (m.thingVersion === null || (typeof m.thingVersion === 'string' && m.thingVersion.length <= 32));
  }
  // Stored records are untrusted input: validate everything, never overwrite newer live topology.
  function restoreTopology(records, now = Date.now()) {
    let restored = 0;
    for (const r of Array.isArray(records) ? records : []) {
      if (!r || typeof r !== 'object' || !serial(r.sn) || !['gateway','subdevice'].includes(r.role) ||
          (r.gatewaySn !== null && !serial(r.gatewaySn)) || !validModel(r.model) ||
          !Number.isSafeInteger(r.lastTopologyAt) || r.lastTopologyAt > now ||
          typeof r.topologyOnline !== 'boolean' ||
          !Array.isArray(r.children) || r.children.length > 100 || !r.children.every(serial)) continue;
      const existing = devices.get(r.sn);
      if (existing && Number.isFinite(existing.lastTopologyAt) &&
          existing.lastTopologyAt >= r.lastTopologyAt) continue;
      // A gateway's newer live update_topo also decides which children it has.
      const gateway = r.gatewaySn ? devices.get(r.gatewaySn) : null;
      if (gateway && !gateway.topologyRestored && Number.isFinite(gateway.lastTopologyAt) &&
          gateway.lastTopologyAt >= r.lastTopologyAt) continue;
      const d = ensure(r.sn);
      d.role = r.role;
      d.gatewaySn = r.gatewaySn;
      d.model = {domain:r.model.domain,type:r.model.type,subType:r.model.subType,
        thingVersion:r.model.thingVersion};
      d.topologyOnline = r.topologyOnline;
      d.lastTopologyAt = r.lastTopologyAt;
      d.topologyTimeVerified = r.topologyTimeVerified === true;
      d.topologyRestored = true;
      d.children = [...new Set(r.children)].filter(sn => sn !== r.sn);
      // Keep replay protection for update_topo across restarts.
      if (Number.isSafeInteger(r.statusTimestamp) && r.statusTimestamp <= now &&
          !(d.lastByChannel.status >= r.statusTimestamp)) d.lastByChannel.status = r.statusTimestamp;
      restored++;
    }
    return restored;
  }
  return {
    ingest, topologyRecords, restoreTopology,
    snapshot(now = Date.now()) { return [...devices.values()].map(d => safeDevice(d,now)); },
    events() { return events.map(event => ({...event})); },
    get(sn, now = Date.now()) { const d = devices.get(sn); return d ? safeDevice(d,now) : null; },
    count() { return devices.size; }
  };
}
module.exports = { createRegistry,propertyPaths };
