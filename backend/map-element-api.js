'use strict';

const {mapAccess}=require('./map-element-permissions');
const {fail}=require('./dji-http');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createMapElementHandler({store,workspaceId,authorize}){
  if(typeof authorize!=='function')throw new TypeError('Authorization function required');
  return async function getElementGroups(req,res){
    if(!req.secure)return fail(res,403,'HTTPS required');
    const token=req.headers?.['x-auth-token'];
    let principal=null;
    try{principal=await authorize(token);}catch(_err){
      return fail(res,503,'Authorization unavailable');
    }
    if(!principal)return fail(res,401,'Unauthorized');
    if(typeof workspaceId!=='string'||!UUID.test(workspaceId)||req.params?.workspaceId!==workspaceId)
      return fail(res,404,'Workspace not found');

    const rawGroupId=req.query?.group_id;
    const groupId=rawGroupId===undefined?null:rawGroupId;
    if(groupId!==null&&(typeof groupId!=='string'||!groupId.length||groupId.length>128))
      return fail(res,400,'Invalid group_id');
    const rawDistribution=req.query?.is_distributed;
    const isDistributed=rawDistribution===undefined?true:
      rawDistribution==='true'?true:rawDistribution==='false'?false:null;
    if(isDistributed===null)return fail(res,400,'Invalid is_distributed');
    // A valid token is not a blanket grant. Pilot RCs can only read published
    // groups in their own workspace; private groups never reach SQL for them.
    if(!mapAccess(principal,{workspaceId,action:'read',isDistributed}))
      return fail(res,403,'Forbidden');
    if(!store)return fail(res,503,'Map element storage unavailable');
    try{
      return res.json(await store.readResponse(workspaceId,{groupId,isDistributed}));
    }catch(_err){
      return fail(res,503,'Map element storage unavailable');
    }
  };
}

module.exports={createMapElementHandler};
