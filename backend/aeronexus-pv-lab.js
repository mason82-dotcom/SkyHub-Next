'use strict';
// P2: independent pure thermal/PV lab adapted conceptually from AeroNexusAdvanced.
// NOT installed in the thermal service and NOT a certified IEC TS 62446-3 inspection.
const MAX_PIXELS=1280*1024,MAX_REGIONS=128;
function ensure(v,msg){if(!v)throw new TypeError(msg);}
function pvInspect({width,height,temperatures,region,detectKelvin=5,minPixels=2,source={}}){
  ensure(Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&
    width*height<=MAX_PIXELS,'Invalid thermal dimensions');
  ensure(temperatures&&typeof temperatures.length==='number'&&temperatures.length===width*height,
    'Expected full temperature raster');
  ensure(region&&Object.keys(region).sort().join(',')==='h,w,x,y','Invalid region object');
  const {x,y,w,h}=region;
  ensure([x,y,w,h].every(Number.isInteger)&&x>=0&&y>=0&&w>0&&h>0&&
    x+w<=width&&y+h<=height,'Invalid ROI');
  ensure(Number.isFinite(detectKelvin)&&detectKelvin>=0.5&&detectKelvin<=50&&
    Number.isInteger(minPixels)&&minPixels>=1&&minPixels<=4096,'Invalid thresholds');
  ensure(source&&typeof source==='object'&&/^[0-9a-f]{64}$/.test(source.sha256||'')&&
    ['dji-tsdk','synthetic'].includes(source.kind),'Missing bounded source provenance');
  // A caller's label does not prove calibration; the output is strictly a candidate.
  const values=[];for(let row=y;row<y+h;row++)
    for(let col=x;col<x+w;col++){
      const t=temperatures[row*width+col];
      if(Number.isFinite(t)&&t>=-100&&t<=2000)values.push(t);
    }
  ensure(values.length>=Math.max(4,Math.ceil(w*h*0.9)),
    'Too many invalid thermal pixels');
  values.sort((a,b)=>a-b);
  const median=(values[Math.floor((values.length-1)/2)]+values[Math.floor(values.length/2)])/2;
  const seen=new Uint8Array(w*h),hotspots=[],index=(col,row)=>row*w+col;
  for(let row=0;row<h;row++)for(let col=0;col<w;col++){
    const i=index(col,row);
    if(seen[i])continue;
    seen[i]=1;
    const temperature=temperatures[(y+row)*width+x+col];
    if(!Number.isFinite(temperature)||temperature-median<detectKelvin)continue;
    const queue=[i];let first=0,count=0,max=-Infinity,sum=0,minX=col,maxX=col,minY=row,maxY=row;
    while(first<queue.length){
      const n=queue[first++],cx=n%w,cy=Math.floor(n/w);
      const t=temperatures[(y+cy)*width+x+cx];
      count++;max=Math.max(max,t);sum+=t;
      minX=Math.min(minX,cx);maxX=Math.max(maxX,cx);
      minY=Math.min(minY,cy);maxY=Math.max(maxY,cy);
      for(const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]){
        const nx=cx+dx,ny=cy+dy;
        if(nx<0||nx>=w||ny<0||ny>=h)continue;
        const j=index(nx,ny);if(seen[j])continue;
        seen[j]=1;
        const v=temperatures[(y+ny)*width+x+nx];
        if(Number.isFinite(v)&&v>=-100&&v<=2000&&v-median>=detectKelvin)queue.push(j);
      }
    }
    if(count>=minPixels){
      ensure(hotspots.length<MAX_REGIONS,'Too many candidate anomalies');
      hotspots.push({pixels:count,deltaKelvin:max-median,peakCelsius:max,
        averageCelsius:sum/count,bounds:{x:x+minX,y:y+minY,w:maxX-minX+1,h:maxY-minY+1}});
    }
  }
  return {schema:'skyhub-aeronexus-pv-lab-v1',classification:'candidate-anomalies-only',
    measuredTemperaturesVerified:false,iecInspectionVerified:false,pvDefectVerified:false,
    source:{kind:source.kind,sha256:source.sha256},region,referenceMedianCelsius:median,
    detectKelvin,hotspots:hotspots.sort((a,b)=>b.deltaKelvin-a.deltaKelvin),
    limitation:'Temperature threshold and connected pixels do not identify PV defects.'};
}
module.exports={pvInspect};
