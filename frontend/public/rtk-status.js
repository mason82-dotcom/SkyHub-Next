'use strict';
// RTK line on the dashboard card (aircraft only). DJI Cloud API 1.18 aircraft properties: position_state.is_fixed
// 0 = not started, 1 = fixing, 2 = fixed, 3 = fixing failed; rtk_number = RTK satellites. mode_code tells ground from air:
// 0-2 standby / take-off preparation, 13 upgrading, 14 not connected; the other codes are flight states.
// Code 0 is also what an aircraft with RTK switched off reports, so it is shown as information, not as an alarm.
// Background (05.11.2026): SeeRutsche photos were all RTK float with correction age up to 25 min, Kapelle1 single point -
// noticed only afterwards. This line makes it visible before take-off and during the flight.
(function(root){
  const GROUND=new Set([0,1,2,13,14]);
  // → null (nothing to show) or {level:'ok'|'info'|'warn'|'alarm', text}
  function rtkStatus(d,{freshness=null}={}){
    if(!d||d.deviceCategory!=='aircraft')return null;
    const t=d.telemetry||{},code=t.rtkFixState;
    if(!Number.isInteger(code)||code<0||code>3)return null;
    const kind=freshness&&freshness.kind;
    if(kind&&kind!=='current'&&kind!=='unverified')return {level:'info',text:'RTK: Zustand nicht aktuell ('+(freshness.text||kind)+')'};
    const sats=Number.isInteger(t.rtkSatellites)&&t.rtkSatellites>0?' · '+t.rtkSatellites+' RTK-Satelliten':'';
    const mode=Number.isInteger(d.modeCode)?d.modeCode:null;
    const flying=mode!==null&&!GROUND.has(mode);
    if(code===2)return {level:'ok',text:'RTK: FIX'+sats};
    if(code===0)return {level:'info',text:'RTK nicht aktiv (Code 0) – Positionen und Fotos ohne RTK-Genauigkeit'};
    const what=code===1?'RTK sucht noch einen Fix':'RTK-Fix fehlgeschlagen – Korrekturdaten (NTRIP, Internet an der RC) prüfen';
    if(flying)return {level:'alarm',text:what+' – im Flug: Fotos nur mit Float-/Einzelpunkt-Genauigkeit'+sats};
    return {level:'warn',text:what+' – vor dem Start auf FIX warten'+sats};
  }
  const api={rtkStatus};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.SkyHubRtkStatus=api;
})(typeof self!=='undefined'?self:this);
