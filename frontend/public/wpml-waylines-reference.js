'use strict';
/* Independent, fail-closed JSON import of the small supported field subset of
 * motecshine/dji-waylines-sdk Waylines JSON into SkyHub's OFFLINE editor.
 * Both generators differ in RC-loss behavior and are NOT semantically equivalent.
 * No third-party code included; no mission dispatch or hardware validation.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SkyHubWpmlWaylinesReference = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const PROFILES = Object.freeze({
    '77:66': 'mavic3e', '77:67': 'mavic3t',
    '99:88': 'matrice4e', '99:89': 'matrice4t'
  });
  const TOP_KEYS = ['name', 'drone_model', 'payload_model', 'payload_position_index',
    'template_type', 'global_height', 'global_speed', 'safe_height',
    'height_type', 'finish_action', 'waypoints'];
  const POINT_KEYS = ['latitude', 'longitude', 'height', 'speed', 'trigger_type', 'actions'];
  const ACTION_KEYS = ['type', 'params', 'action'];
  const PARAM_KEYS = ['payload_position_index', 'payloadPositionIndex',
    'use_global_payload_lens_index', 'useGlobalPayloadLensIndex'];
  const has = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
  function fail(code) { throw new TypeError('Waylines-Referenzimport abgelehnt: ' + code); }
  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) fail(label + ': Objekt erforderlich');
    return value;
  }
  function allowed(value, keys, label) {
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) fail(label + ': nicht unterstütztes Feld ' + key);
    }
  }
  function number(value, label, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
      fail(label + ': ungültiger Zahlenwert');
    return value;
  }
  // JSON.parse by itself silently accepts repeated object keys. For mission
  // parameters this is ambiguous and must fail rather than prefer the last one.
  function parseJson(raw,maxLength=128*1024) {
    // Existing Waylines imports keep their original 128 KiB limit. The
    // separate local library-backup importer may request up to 512 KiB.
    if(!Number.isSafeInteger(maxLength)||maxLength<1||maxLength>512*1024)
      fail('ungültige JSON-Größenbeschränkung');
    if (typeof raw !== 'string' || raw.length > maxLength)
      fail(maxLength===128*1024 ?
        'JSON muss eine Textdatei bis 128 KiB sein' :
        'JSON überschreitet die zulässige Dateigröße');
    let result;
    try { result = JSON.parse(raw); }
    catch { fail('ungültiges JSON'); }
    const stack=[];
    for (let i=0; i<raw.length; i++) {
      const token=raw[i];
      if (token==='{' || token==='[') {
        if (stack.length>=32) fail('JSON-Verschachtelung zu tief');
        stack.push(token==='{' ? new Set() : null);
        continue;
      }
      if (token==='}' || token===']') {
        stack.pop();
        continue;
      }
      if (token!=='"') continue;
      const start=i;
      for (i++; i<raw.length; i++) {
        if (raw[i]==='\\') { i++; continue; }
        if (raw[i]==='"') break;
      }
      let next=i+1;
      while (next<raw.length && /\s/.test(raw[next])) next++;
      if (raw[next]!==':' || stack.length===0) continue;
      const keys=stack[stack.length-1];
      if (!(keys instanceof Set)) fail('ungültige JSON-Objektstruktur');
      const key=JSON.parse(raw.slice(start,i+1));
      if (keys.has(key)) fail('doppelter JSON-Schlüssel');
      keys.add(key);
    }
    return result;
  }
  // Plan geometry for local review only: mean-Earth spherical approximation,
  // never a flight duration, geofence, airspace or energy feasibility check.
  function reviewPlan(plan) {
    const earthRadiusMeters = 6371008.8;
    const rad = degrees => degrees * Math.PI / 180;
    let total = 0, longest = 0;
    for (let i=1; i<plan.waypoints.length; i++) {
      const a = plan.waypoints[i-1], b = plan.waypoints[i];
      const dLat=rad(b.lat-a.lat), dLon=rad(b.lon-a.lon);
      const x=Math.sin(dLat/2)**2 +
        Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
      const leg=2*earthRadiusMeters*Math.asin(Math.sqrt(Math.min(1,Math.max(0,x))));
      total+=leg;
      longest=Math.max(longest,leg);
    }
    return Object.freeze({
      waypointCount:plan.waypoints.length,
      photoActionCount:plan.waypoints.filter(p=>p.photo).length,
      horizontalRouteMeters:Math.round(total*10)/10,
      longestLegMeters:Math.round(longest*10)/10,
      nominalStraightCruiseSeconds:Math.ceil(total/plan.speed),
      distanceMethod:'spherical-haversine-mean-earth',
      estimateExcludes:'takeoff,climb,turns,wind,terrain,obstacles,airspace,battery',
      sdkMissionSemanticallyEquivalent:false,
      pilot2ImportVerified:false,
      flightReady:false
    });
  }
  function convert(input) {
    object(input, 'Mission');
    allowed(input, TOP_KEYS, 'Mission');
    if (typeof input.name !== 'string' || !input.name.trim() ||
      input.name.length > 70 || /[\u0000-\u001f\u007f]/.test(input.name))
      fail('Missionsname muss 1–70 Zeichen haben');
    if (input.template_type !== 'waypoint') fail('nur template_type=waypoint');
    if (has(input, 'height_type') && input.height_type !== 'relativeToStartPoint')
      fail('nur height_type=relativeToStartPoint');
    const drone = number(input.drone_model, 'drone_model (numerischer DJI-Enum)', 1, 65535);
    const payload = number(input.payload_model, 'payload_model (numerischer DJI-Enum)', 1, 65535);
    if (!Number.isInteger(drone) || !Number.isInteger(payload)) fail('Geräte-IDs müssen ganzzahlig sein');
    const model = PROFILES[drone + ':' + payload];
    if (!model) fail('Gerät/Last-Kombination nicht für Referenzimport freigegeben');
    if (has(input, 'payload_position_index') && input.payload_position_index !== 0)
      fail('nur Payload-Position 0');
    const speed = number(input.global_speed, 'global_speed', 1, 15);
    const finishAction = input.finish_action === undefined ? 'goHome' : input.finish_action;
    if (finishAction !== 'goHome' && finishAction !== 'noAction')
      fail('nicht unterstützte Abschlussaktion');
    const takeoffHeight = has(input, 'safe_height') ?
      number(input.safe_height, 'safe_height', 20, 120) : 20;
    if (!Array.isArray(input.waypoints) || input.waypoints.length < 2 ||
      input.waypoints.length > 500) fail('2–500 Wegpunkte erforderlich');
    const waypoints = input.waypoints.map((raw, i) => {
      const label = 'Wegpunkt ' + (i + 1);
      object(raw, label);
      allowed(raw, POINT_KEYS, label);
      if (has(raw, 'trigger_type') && raw.trigger_type !== 'reachPoint')
        fail(label + ': nur reachPoint-Aktionen');
      if (has(raw, 'speed') && raw.speed !== speed)
        fail(label + ': individuelle Geschwindigkeit wird nicht übertragen');
      const point = {
        lat: number(raw.latitude, label + ' latitude', -90, 90),
        lon: number(raw.longitude, label + ' longitude', -180, 180),
        height: number(raw.height, label + ' height', 5, 120),
        photo: false
      };
      if (raw.actions !== undefined) {
        if (!Array.isArray(raw.actions) || raw.actions.length > 1)
          fail(label + ': maximal eine Fotoaktion');
        for (const rawAction of raw.actions) {
          object(rawAction, label + ' Aktion');
          allowed(rawAction, ACTION_KEYS, label + ' Aktion');
          if (rawAction.type !== 'takePhoto') fail(label + ': nur takePhoto');
          if (has(rawAction, 'params') && has(rawAction, 'action'))
            fail(label + ': action und params dürfen nicht gleichzeitig vorkommen');
          const params = has(rawAction, 'params') ? rawAction.params :
            (has(rawAction, 'action') ? rawAction.action : {});
          object(params, label + ' Aktionsparameter');
          allowed(params, PARAM_KEYS, label + ' Aktionsparameter');
          if (has(params, 'payload_position_index') && has(params, 'payloadPositionIndex'))
            fail(label + ': doppelte Payload-Position');
          const position = has(params, 'payload_position_index') ? params.payload_position_index :
            (has(params, 'payloadPositionIndex') ? params.payloadPositionIndex : 0);
          if (position !== 0) fail(label + ': Foto nur über Payload 0');
          if ((has(params, 'use_global_payload_lens_index') &&
              params.use_global_payload_lens_index !== false) ||
              (has(params, 'useGlobalPayloadLensIndex') &&
              params.useGlobalPayloadLensIndex !== false))
            fail(label + ': Linsenauswahl nicht unterstützt');
          point.photo = true;
        }
      }
      return point;
    });
    const constantHeight = waypoints[0].height;
    if (waypoints.some(p => p.height !== constantHeight))
      fail('unterschiedliche Wegpunkthöhen ohne WGS84-Ellipsoidhöhen');
    if (has(input, 'global_height') && input.global_height !== constantHeight)
      fail('global_height weicht von Wegpunkthöhe ab');
    for (let i = 1; i < waypoints.length; i++) {
      if (waypoints[i].lat === waypoints[i - 1].lat &&
          waypoints[i].lon === waypoints[i - 1].lon)
        fail('aufeinanderfolgende identische Wegpunkte');
    }
    const plan={name: input.name.trim(), model, speed, transitionSpeed: speed,
      takeoffHeight, finishAction, waypoints};
    return Object.freeze({
      plan,
      review: reviewPlan(plan),
      source: 'motecshine/dji-waylines-sdk Waylines JSON subset',
      flightReady: false,
      hardwareVerified: false,
      conversionScope: 'offline-strict-subset-not-semantic-equivalence'
    });
  }
  return Object.freeze({convert, parseJson, PROFILES});
});
