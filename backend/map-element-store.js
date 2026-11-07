'use strict';

const {parseMapElementGroups}=require('./map-element-contract');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const READ_GROUPS_SQL=`
  SELECT g.group_id,g.name AS group_name,g.group_type,g.is_locked,g.is_distributed,
         g.create_time AS group_create_time,
         e.element_id,e.name AS element_name,e.resource_type,e.geometry,e.color,
         e.clamp_to_ground,e.is_3d,e.create_time AS element_create_time,e.update_time
    FROM dji_map_element_groups g
    LEFT JOIN dji_map_elements e
      ON e.workspace_id=g.workspace_id AND e.group_id=g.group_id
   WHERE g.workspace_id=$1 AND ($2::varchar IS NULL OR g.group_id=$2)
     AND g.is_distributed=$3
   ORDER BY g.group_id,e.element_id`;

function epoch(value){
  if(typeof value==='string'&&/^\d+$/.test(value)){
    const number=Number(value);
    return Number.isSafeInteger(number)?number:null;
  }
  return Number.isSafeInteger(value)&&value>=0?value:null;
}

function optional(target,key,value){
  if(value!==null&&value!==undefined)target[key]=value;
}

function wireElement(element,userName){
  const properties={};
  optional(properties,'color',element.color);
  optional(properties,'clampToGround',element.clampToGround);
  optional(properties,'is3d',element.is3d);
  const content={type:'Feature',geometry:element.geometry};
  if(Object.keys(properties).length)content.properties=properties;
  const resource={content};
  optional(resource,'type',element.resourceType);
  optional(resource,'user_name',userName);
  const result={id:element.id,name:element.name,resource};
  optional(result,'create_time',element.createTime);
  optional(result,'update_time',element.updateTime);
  return result;
}

function wireGroup(group){
  // https/map-elements/obtain: resource.user_name (creator). Not stored per element: Pilot 2 for the Pilot share layer, else SkyHub.
  const result={id:group.id,name:group.name,elements:group.elements.map(e=>wireElement(e,group.type===2?'Pilot 2':'SkyHub'))};
  optional(result,'type',group.type);
  optional(result,'is_lock',group.isLocked);
  optional(result,'create_time',group.createTime);
  return result;
}

function createMapElementStore(pool){
  if(!pool||typeof pool.query!=='function')throw new TypeError('Database pool required');
  return {
    async readResponse(workspaceId,{groupId=null,isDistributed=true}={}){
      if(typeof workspaceId!=='string'||!UUID.test(workspaceId))
        throw new TypeError('Invalid DJI map workspace ID');
      if(groupId!==null&&(typeof groupId!=='string'||!groupId.length||groupId.length>128))
        throw new TypeError('Invalid DJI map group ID');
      if(typeof isDistributed!=='boolean')throw new TypeError('Invalid DJI distribution filter');
      const {rows}=await pool.query(READ_GROUPS_SQL,[workspaceId,groupId,isDistributed]);
      if(!Array.isArray(rows))throw new TypeError('Invalid DJI map storage result');
      const groups=new Map();
      for(const row of rows){
        if(!groups.has(row.group_id))groups.set(row.group_id,{
          id:row.group_id,name:row.group_name,type:row.group_type,
          is_lock:row.is_locked,create_time:epoch(row.group_create_time),elements:[]
        });
        if(row.element_id===null)continue;
        groups.get(row.group_id).elements.push({
          id:row.element_id,name:row.element_name,
          create_time:epoch(row.element_create_time),update_time:epoch(row.update_time),
          resource:{type:row.resource_type,content:{type:'Feature',
            properties:{color:row.color,clampToGround:row.clamp_to_ground,is3d:row.is_3d},
            geometry:row.geometry}}
        });
      }
      const normalized=parseMapElementGroups({code:0,data:[...groups.values()]});
      return {code:0,data:normalized.groups.map(wireGroup),message:'success'};
    }
  };
}

module.exports={createMapElementStore};
