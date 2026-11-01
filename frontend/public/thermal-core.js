// SkyHub thermal module: pure computation (no DOM, no network) for browser and node --test.
// Temperatures are an ESTIMATE from DJI R-JPEG raw values (raw/64 - 273.15), not the DJI Thermal SDK.
(function(root){
'use strict';
const KELVIN=273.15;
const ESTIMATE='Schätzung aus Rohdaten (raw/64-273,15), keine DJI-Kalibrierung';
const CALCULATION='skyhub-thermal-estimate-v2';

function rawToCelsius(raw){return raw/64-KELVIN;}

// Emissivity / reflected temperature correction (total-radiation approximation).
// The camera value is taken as measured with the file emissivity epsFile and the same reflected
// temperature; with eps === epsFile the value is unchanged.
function correct(tC,{epsFile=0.95,eps=epsFile,reflected=20}={}){
  if(!Number.isFinite(tC)||tC<-KELVIN||!Number.isFinite(eps)||eps<0.1||eps>1||
     !Number.isFinite(epsFile)||epsFile<0.1||epsFile>1||
     !Number.isFinite(reflected)||reflected<-KELVIN)throw new RangeError('Ungültige Korrekturparameter');
  if(Math.abs(eps-epsFile)<1e-9)return tC;
  const t4=(tC+KELVIN)**4,r4=(reflected+KELVIN)**4;
  const v=(epsFile*t4+(eps-epsFile)*r4)/eps;
  if(!(v>=0))throw new RangeError('Korrektur ergibt keine physikalisch mögliche Temperatur');
  return v**0.25-KELVIN;
}
function temperatures(raw,params={}){
  const out=new Float32Array(raw.length);
  for(let i=0;i<raw.length;i++)out[i]=correct(rawToCelsius(raw[i]),params);
  return out;
}

// Statistics for the whole frame or a rectangle {x0,y0,x1,y1} (inclusive pixel bounds).
function regionStats(temps,width,height,rect){
  const x0=Math.max(0,Math.min(width-1,Math.round(rect?Math.min(rect.x0,rect.x1):0)));
  const x1=Math.max(0,Math.min(width-1,Math.round(rect?Math.max(rect.x0,rect.x1):width-1)));
  const y0=Math.max(0,Math.min(height-1,Math.round(rect?Math.min(rect.y0,rect.y1):0)));
  const y1=Math.max(0,Math.min(height-1,Math.round(rect?Math.max(rect.y0,rect.y1):height-1)));
  const values=[];let sum=0,min=Infinity,max=-Infinity,hot=null,cold=null;
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const t=temps[y*width+x];
    if(!Number.isFinite(t))continue;
    values.push(t);sum+=t;
    if(t>max){max=t;hot={x,y};}
    if(t<min){min=t;cold={x,y};}
  }
  if(!values.length)return null;
  values.sort((a,b)=>a-b);
  const q=p=>values[Math.min(values.length-1,Math.floor(p*values.length))];
  return {x0,y0,x1,y1,pixels:values.length,min,max,mean:sum/values.length,median:q(0.5),
    p1:q(0.01),p99:q(0.99),hot,cold};
}
function histogram(temps,min,max,bins=48){
  const out=new Array(bins).fill(0),span=max-min||1;
  for(const t of temps){
    if(!Number.isFinite(t))continue;
    out[Math.max(0,Math.min(bins-1,Math.floor((t-min)/span*bins)))]++;
  }
  return out;
}

// Palettes as colour stops (0..1), expanded to 256-entry lookup tables.
const STOPS=Object.freeze({
  iron:[[0,[0,0,10]],[0.15,[32,0,96]],[0.35,[140,0,150]],[0.55,[220,50,40]],[0.75,[250,150,0]],[0.9,[255,220,60]],[1,[255,255,230]]],
  rainbow:[[0,[0,0,130]],[0.2,[0,60,255]],[0.4,[0,220,220]],[0.55,[40,220,40]],[0.7,[250,240,0]],[0.85,[255,120,0]],[1,[220,0,0]]],
  whitehot:[[0,[0,0,0]],[1,[255,255,255]]],
  blackhot:[[0,[255,255,255]],[1,[0,0,0]]],
  lava:[[0,[10,10,40]],[0.3,[40,40,160]],[0.5,[160,40,160]],[0.7,[240,80,40]],[0.85,[255,190,40]],[1,[255,255,200]]],
  arctic:[[0,[0,0,60]],[0.3,[0,90,200]],[0.5,[130,200,255]],[0.65,[240,240,240]],[0.8,[255,170,60]],[1,[200,30,0]]]
});
const PALETTE_LABELS=Object.freeze({iron:'Eisen (Iron)',rainbow:'Regenbogen',whitehot:'Weiß heiß',
  blackhot:'Schwarz heiß',lava:'Lava',arctic:'Arktis'});
const luts=new Map();
function lut(name){
  if(luts.has(name))return luts.get(name);
  const stops=STOPS[name]||STOPS.iron,table=new Uint8ClampedArray(256*3);
  for(let i=0;i<256;i++){
    const v=i/255;
    let k=0;while(k<stops.length-2&&v>stops[k+1][0])k++;
    const [a,ca]=stops[k],[b,cb]=stops[k+1],f=(v-a)/((b-a)||1);
    for(let c=0;c<3;c++)table[i*3+c]=ca[c]+(cb[c]-ca[c])*f;
  }
  luts.set(name,table);
  return table;
}
// RGBA pixels; isotherm {mode:'above'|'below'|'between', t1, t2} paints matches in signal green.
function render(temps,{min,max,palette='iron',isotherm=null}){
  const table=lut(palette),out=new Uint8ClampedArray(temps.length*4),span=max-min||1;
  for(let i=0;i<temps.length;i++){
    const t=temps[i];
    let r,g,b;
    const iso=isotherm&&Number.isFinite(t)&&(
      isotherm.mode==='above'?t>=isotherm.t1:isotherm.mode==='below'?t<=isotherm.t1:
      isotherm.mode==='between'?t>=Math.min(isotherm.t1,isotherm.t2)&&t<=Math.max(isotherm.t1,isotherm.t2):false);
    if(iso){r=0;g=255;b=120;}
    else{
      const idx=Number.isFinite(t)?Math.max(0,Math.min(255,Math.round((t-min)/span*255))):0;
      r=table[idx*3];g=table[idx*3+1];b=table[idx*3+2];
    }
    out[i*4]=r;out[i*4+1]=g;out[i*4+2]=b;out[i*4+3]=255;
  }
  return out;
}
function csvValue(v){
  if(typeof v==='number')return Number.isFinite(v)?v.toFixed(2).replace('.',','):'';
  let s=String(v??'');
  if(/^[=+@\-\t\r]/.test(s))s="'"+s;
  return /[;"\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
// German Excel CSV: semicolon separator, decimal comma.
function csv(rows){return '﻿'+rows.map(r=>r.map(csvValue).join(';')).join('\r\n')+'\r\n';}
function matrixCsv(temps,width,height,metadata=[]){
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||
     temps.length!==width*height)throw new RangeError('Temperaturmatrix hat eine ungültige Größe');
  const rows=metadata.length?[...metadata,[],['Temperaturmatrix °C; Zeile=y, Spalte=x; Ursprung links oben']]:[];
  for(let y=0;y<height;y++)rows.push(Array.from(temps.subarray(y*width,(y+1)*width)));
  return csv(rows);
}
function format(t,digits=1){
  return Number.isFinite(t)?t.toLocaleString('de-DE',{minimumFractionDigits:digits,maximumFractionDigits:digits})+' °C':'—';
}

const api=Object.freeze({KELVIN,ESTIMATE,CALCULATION,rawToCelsius,correct,temperatures,regionStats,histogram,lut,render,
  PALETTE_LABELS,PALETTES:Object.keys(STOPS),csv,matrixCsv,format});
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.SkyhubThermal=api;
})(typeof window==='object'?window:null);
