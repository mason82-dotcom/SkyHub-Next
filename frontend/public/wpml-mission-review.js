'use strict';
/* Offline geometric review of an UNEXECUTED WPML draft.
 * No route authority, no device limits, no terrain or battery estimate.
 * The result is intentionally aggregate-only; raw GPS values never leave this API.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SkyHubWpmlMissionReview = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const R = 6371008.8; // mean Earth radius in metres (approximate great-circle distance)
  const allowedModels = new Set(['mavic3e','mavic3t','mavic3m','matrice4e','matrice4t']);
  const allowedTriggers = new Set(['reachPoint','multipleDistance','multipleTiming']);
  const longSegmentReviewThresholdMeters = 2000; // UI review hint, NOT a DJI product limit
  const issueDescriptions = Object.freeze({
    'insufficient-waypoints':'Mindestens zwei Wegpunkte erforderlich.',
    'unsupported-model':'Geräteprofil nicht unterstützt.',
    'invalid-speed':'Sollgeschwindigkeit außerhalb des Entwurfsbereichs.',
    'invalid-coordinate':'Ungültige Koordinateneingabe.',
    'duplicate-neighbors':'Direkt aufeinanderfolgende Wegpunkte sind identisch.',
    'invalid-height':'Relative Höhenangabe fehlt oder ist ungültig.',
    'missing-ellipsoid':'Bei individuellen Höhen fehlt eine gültige WGS84-Ellipsoidhöhe.',
    'unknown-photo-trigger':'Unbekannter Kamera-Auslösetyp.',
    'invalid-name':'Missionsname fehlt oder enthält ungültige Zeichen.',
    'invalid-takeoff-height':'Sicherheitssteighöhe außerhalb des Entwurfsbereichs.',
    'invalid-finish-action':'Abschlussaktion nicht unterstützt.',
    'invalid-photo-interval':'Fotointervall außerhalb des Entwurfsbereichs.',
    'invalid-camera-min-interval':'Angegebenes minimales Kameraaufnahmeintervall ist ungültig.',
    'camera-interval-too-short':'Fotoauslöseintervall unterschreitet das angegebene Kameraminimum.',
    'camera-interval-unverified':'Kein Kamera-Minimalintervall angegeben; reale Aufnahmefrequenz ungeprüft.',
    'photo-mode-conflict':'Periodische Fotos dürfen nicht mit Wegpunkt-Einzelbildern kombiniert werden.',
    'long-segment':'Mindestens ein Segment ist über 2 km lang (nur Prüfhinweis, kein DJI-Limit).',
    'antimeridian':'Datumslinie berührt: Kartenlinie könnte den kürzesten Weg falsch darstellen.',
    'high-latitude':'Hohe Breite: Kartendarstellung und Geometrie gesondert prüfen.'
  });
  const known = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const inRange = (v,min,max) => finite(v) && v>=min && v<=max;
  const deg = d => d*Math.PI/180;
  function distance(a,b) {
    // shortest spherical arc, including antimeridian transitions
    const deltaLon = ((b.lon-a.lon+540)%360)-180;
    const h = Math.sin(deg(b.lat-a.lat)/2)**2+
      Math.cos(deg(a.lat))*Math.cos(deg(b.lat))*
      Math.sin(deg(deltaLon)/2)**2;
    return 2*R*Math.asin(Math.min(1,Math.sqrt(Math.max(0,h))));
  }
  function analyze(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new TypeError('review input must be an object');
    if (!Array.isArray(input.waypoints) || input.waypoints.length>500)
      throw new TypeError('invalid waypoint collection');
    const issues = new Set();
    const points = input.waypoints;
    if (points.length<2) issues.add('insufficient-waypoints');
    if (typeof input.name!=='string' || input.name.trim().length===0 ||
        input.name.length>70 || /[\u0000-\u001f\u007f]/.test(input.name))
      issues.add('invalid-name');
    if (!inRange(input.takeoffHeight,1.2,120)) issues.add('invalid-takeoff-height');
    if (input.finishAction!=='goHome' && input.finishAction!=='noAction')
      issues.add('invalid-finish-action');
    if (!allowedModels.has(input.model)) issues.add('unsupported-model');
    if (!inRange(input.speed,0.2,15)) issues.add('invalid-speed');
    if (!allowedTriggers.has(input.photoTrigger)) issues.add('unknown-photo-trigger');
    const localHeights = input.localHeights === true;
    if (!localHeights && !inRange(input.globalHeight,2,120)) issues.add('invalid-height');
    let total=0, largest=0, photoCount=0, allCoordinatesValid=true, heightsValid=true;
    let previous=null;
    for (const point of points) {
      if (!point || typeof point !== 'object' || Array.isArray(point)) {
        allCoordinatesValid=false; heightsValid=false; issues.add('invalid-coordinate');
        issues.add('invalid-height'); previous=null; continue;
      }
      const valid=inRange(point.lat,-90,90)&&inRange(point.lon,-180,180);
      if (!valid) {allCoordinatesValid=false;issues.add('invalid-coordinate');}
      if (localHeights) {
        if (!inRange(point.height,2,120)) {issues.add('invalid-height');heightsValid=false;}
        if (!inRange(point.ellipsoidHeight,-10000,100000)) {
          issues.add('missing-ellipsoid');heightsValid=false;
        }
      }
      if (point.photo === true) photoCount++;
      if (valid && Math.abs(point.lat)>=85) issues.add('high-latitude');
      if (valid && previous) {
        if (point.lat===previous.lat && point.lon===previous.lon)
          issues.add('duplicate-neighbors');
        if (Math.abs(point.lon-previous.lon)>180) issues.add('antimeridian');
        const meters=distance(previous,point);
        total+=meters;
        largest=Math.max(largest,meters);
        if (meters>longSegmentReviewThresholdMeters) issues.add('long-segment');
      }
      previous=valid?{lat:point.lat,lon:point.lon}:null;
    }
    const periodic=input.photoTrigger==='multipleDistance' ||
      input.photoTrigger==='multipleTiming';
    if (periodic) {
      const maxInterval=input.photoTrigger==='multipleDistance'?1000:60;
      if (!inRange(input.photoInterval,1,maxInterval))
        issues.add('invalid-photo-interval');
      if (photoCount>0) issues.add('photo-mode-conflict');
      if (input.cameraMinIntervalSeconds===null) {
        issues.add('camera-interval-unverified');
      } else if (!inRange(input.cameraMinIntervalSeconds,0.1,60)) {
        issues.add('invalid-camera-min-interval');
      } else if (inRange(input.photoInterval,1,maxInterval) &&
        inRange(input.speed,0.2,15)) {
        const seconds=input.photoTrigger==='multipleTiming'?
          input.photoInterval:input.photoInterval/input.speed;
        if (seconds<input.cameraMinIntervalSeconds)
          issues.add('camera-interval-too-short');
      }
    }
    if (!allCoordinatesValid || !heightsValid || issues.has('invalid-speed'))
      total=NaN; // no plausible calculation from incomplete/invalid input
    const issueCodes=Object.freeze([...issues]);
    const errorCodes=new Set([
      'insufficient-waypoints','unsupported-model','invalid-speed',
      'invalid-coordinate','duplicate-neighbors','invalid-height',
      'missing-ellipsoid','unknown-photo-trigger','invalid-name',
      'invalid-takeoff-height','invalid-finish-action','invalid-photo-interval',
      'invalid-camera-min-interval','camera-interval-too-short','photo-mode-conflict'
    ]);
    const hasErrors=issueCodes.some(c=>errorCodes.has(c));
    const result={
      status: points.length<2 ? 'incomplete' : hasErrors?'invalid':'review-only',
      waypointCount:points.length,
      // "photoCount" means only user-flagged waypoint photos, NOT periodic captures.
      waypointPhotoCount:input.photoTrigger==='reachPoint'?photoCount:0,
      periodicPhotoMode:input.photoTrigger==='multipleDistance'||
        input.photoTrigger==='multipleTiming',
      horizontalDistanceMeters:Number.isFinite(total)?Math.round(total):null,
      longestSegmentMeters:Number.isFinite(total)?Math.round(largest):null,
      nominalStraightTravelSeconds:Number.isFinite(total)&&inRange(input.speed,0.2,15)?
        Math.ceil(total/input.speed):null,
      issueCodes,
      flightReady:false,
      hardwareVerified:false,
      flightTimeEstimated:false,
      missionDispatchEnabled:false
    };
    return Object.freeze(result);
  }
  function issueLabel(code) {
    return typeof code==='string'&&known(issueDescriptions,code)?
      issueDescriptions[code]:null;
  }
  return Object.freeze({analyze,issueLabel});
});
