'use strict';
const {timingSafeEqual}=require('node:crypto');
const {serial}=require('./dji');
const {numericValues}=require('./fh-observer');
function createFhMsdkObserve({observer,registry,enabled=false,token='',clock=Date.now}){
 const configured=enabled&&typeof token==='string'&&token.length>=32&&!token.startsWith('REPLACE_');
 function authorized(header){
  if(typeof header!=='string'||!header.startsWith('Bearer '))return false;
  const candidate=Buffer.from(header.slice(7)),expected=Buffer.from(token);
  return candidate.length===expected.length&&timingSafeEqual(candidate,expected);
 }
 return function(req,res){
  if(!configured)return res.status(503).json({error:'msdk_observer_disabled'});
  if(!req.secure&&!req.socket?.encrypted)return res.status(403).json({error:'https_required'});
  if(!authorized(req.get('authorization')))return res.status(401).json({error:'unauthorized'});
  const b=req.body;
  if(!b||typeof b!=='object'||Array.isArray(b)||
   Object.keys(b).some(k=>!['aircraftSn','gatewaySn','sampledAt','values'].includes(k)))
   return res.status(400).json({error:'invalid_snapshot'});
  const aircraftSn=serial(b.aircraftSn),gatewaySn=serial(b.gatewaySn);
  const device=aircraftSn&&registry.get(aircraftSn,clock());
  const values=numericValues(b.values);
  if(!aircraftSn||!gatewaySn||!device||device.role==='gateway'||
   device.gatewaySn!==gatewaySn||device.aircraftConnected===false||
   !values||Object.keys(values).length===0)
   return res.status(409).json({error:'topology_or_values_not_verified'});
  if(!observer.observeMsdk({aircraftSn,gatewaySn,values,sampledAt:b.sampledAt},clock()))
   return res.status(409).json({error:'snapshot_stale_or_unbound'});
  return res.status(202).json({accepted:true,controlEnabled:false});
 };
}
module.exports={createFhMsdkObserve};
