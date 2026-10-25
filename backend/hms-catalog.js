'use strict';

// German/English HMS texts derived from DJI's hms.json (see data/HMS-LICENSE.txt).
const texts=require('./data/hms-texts.json');

// DJI aircraft mode_code values that mean "in the air": manual/automatic flight,
// wayline, panorama, tracking, ADS-B avoidance, RTH, landing, APAS, virtual stick,
// live flight controls. 0-2 (standby/prep), 13 (upgrading), 14 (disconnected) are ground.
const IN_THE_SKY=new Set([3,4,5,6,7,8,9,10,11,12,15,16,17]);

// Copy rules from DJI's HMS feature pages (aircraft and dock). Indexes are counted
// from 1 for the operator; left/right/front/back are chosen from sensor_index.
const SIDES={en:['left','right'],de:['links','rechts']};
const RODS={en:['front','back','left','right'],de:['vorne','hinten','links','rechts']};
const UNRESOLVED=/%(?:\d+\$)?(?:\.\d+)?[sdf]|%[a-z]+_index/g;

function number(value){return Number.isInteger(value)&&value>=0;}
function fillText(text,alert,lang){
  if(!text)return null;
  const sensor=alert.sensorIndex,component=alert.componentIndex;
  const side=number(sensor)?SIDES[lang][sensor===0?0:1]:'?';
  const rod=number(sensor)&&sensor<RODS[lang].length?RODS[lang][sensor]:'?';
  return text
    .replace(/%alarmid/g,alert.code)
    .replace(/%component_index/g,number(component)?String(component+1):'?')
    .replace(/%battery_index|%dock_cover_index/g,side)
    .replace(/%charging_rod_index/g,rod)
    .replace(/%index/g,number(sensor)?String(sensor+1):'?')
    // printf-style or undocumented placeholders have no published rule: never show raw templates.
    .replace(UNRESOLVED,'?');
}

function describeHms(alert,{domain=null,modeCode=null}={}){
  if(!alert || typeof alert.code!=='string')return null;
  const base=(domain==='3'?'dock_tip_':'fpv_tip_')+alert.code;
  const sky=IN_THE_SKY.has(modeCode) && texts[base+'_in_the_sky'];
  const entry=sky || texts[base];
  if(!entry)return null;
  return {de:fillText(entry.de,alert,'de'),en:fillText(entry.en,alert,'en')};
}
module.exports={describeHms,IN_THE_SKY};
