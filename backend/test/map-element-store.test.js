'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMapElementStore}=require('../map-element-store');

const WORKSPACE='e3dea0f5-37f2-4d79-ae58-490af3228069';

test('map element store reads one workspace and returns only normalized DJI fields',async()=>{
  let call;
  const store=createMapElementStore({query:async(...args)=>{
    call=args;
    return {rows:[{
      group_id:'shared',group_name:'App Shared',group_type:2,is_locked:false,
      group_create_time:'1637158501230',element_id:'point',element_name:'Meldepunkt',
      resource_type:0,geometry:{type:'Point',coordinates:[8.4,49.1]},color:'#0091FF',
      clamp_to_ground:false,is_3d:false,element_create_time:'1637158501231',
      update_time:null,secret:'must not escape'
    }]};
  }});
  const response=await store.readResponse(WORKSPACE);
  assert.match(call[0],/WHERE g\.workspace_id=\$1/);
  assert.deepEqual(call[1],[WORKSPACE,null,true]);
  assert.deepEqual(response,{code:0,message:'success',data:[{
    id:'shared',name:'App Shared',type:2,is_lock:false,create_time:1637158501230,
    elements:[{id:'point',name:'Meldepunkt',create_time:1637158501231,
      resource:{type:0,user_name:'Pilot 2',content:{type:'Feature',properties:{
        color:'#0091FF',clampToGround:false,is3d:false
      },geometry:{type:'Point',coordinates:[8.4,49.1]}}}}]
  }]});
  assert.doesNotMatch(JSON.stringify(response),/must not escape|secret/);
  assert.doesNotMatch(JSON.stringify(response),/isLocked|createTime|resourceType|updateTime/);
  assert.doesNotMatch(call[0],/\b(INSERT|UPDATE|DELETE)\b/i);
});

test('empty groups remain in the response for Pilot App Shared synchronization',async()=>{
  const store=createMapElementStore({query:async()=>({rows:[{
    group_id:'shared',group_name:'App Shared',group_type:2,is_locked:false,
    group_create_time:null,element_id:null
  }]})});
  const result=await store.readResponse(WORKSPACE);
  assert.deepEqual(result.data,[{
    id:'shared',name:'App Shared',type:2,is_lock:false,elements:[]
  }]);
});

test('group and distribution filters are parameterized',async()=>{
  let call;
  const store=createMapElementStore({query:async(...args)=>{call=args;return {rows:[]};}});
  const hostileId="shared' OR true --";
  await store.readResponse(WORKSPACE,{groupId:hostileId,isDistributed:false});
  assert.deepEqual(call[1],[WORKSPACE,hostileId,false]);
  assert.match(call[0],/g\.group_id=\$2/);
  assert.match(call[0],/g\.is_distributed=\$3/);
  assert.doesNotMatch(call[0],/shared.*OR true/);
  await assert.rejects(store.readResponse(WORKSPACE,{groupId:['shared']}),
    /Invalid DJI map group ID/);
});

test('invalid workspace IDs fail before querying the database',async()=>{
  let reads=0;
  const store=createMapElementStore({query:async()=>{reads++;return {rows:[]};}});
  await assert.rejects(store.readResponse('../workspace'),/Invalid DJI map workspace ID/);
  assert.equal(reads,0);
});

test('invalid persisted geometry is omitted rather than returned',async()=>{
  const store=createMapElementStore({query:async()=>({rows:[{
    group_id:'shared',group_name:'App Shared',group_type:2,is_locked:false,
    element_id:'bad',element_name:'Bad point',resource_type:0,
    geometry:{type:'Point',coordinates:[8.4,95]}
  }]})});
  const result=await store.readResponse(WORKSPACE);
  assert.equal(result.data.length,1);
  assert.equal(result.data[0].elements.length,0);
});
