'use strict';

const express=require('express');
const {
  inventoryM3MFromS3
}=require('./m3m-s3-inventory');

function createMediaRouter(storage){
  const router=express.Router();

  router.get('/status',async(req,res)=>{
    try{
      const buckets=await storage.buckets();
      res.json({status:'online',readOnly:true,bucketCount:buckets.length});
    }catch(_err){
      res.status(503).json({status:'unavailable',readOnly:true});
    }
  });

  router.get('/buckets',async(req,res)=>{
    try{
      res.json({buckets:await storage.buckets()});
    }catch(_err){
      res.status(503).json({error:'Storage unavailable'});
    }
  });

  router.get('/objects',async(req,res)=>{
    const {bucket,prefix='',limit='100',cursor}=req.query;
    if(typeof bucket!=='string' ||
       typeof prefix!=='string' ||
       typeof limit!=='string' ||
       !/^[1-9]\d{0,2}$/.test(limit) ||
       (cursor!==undefined && typeof cursor!=='string')){
      return res.status(400).json({error:'Invalid query'});
    }

    try{
      res.json(await storage.objects(bucket,{
        prefix,limit:Number(limit),cursor
      }));
    }catch(err){
      res.status(err.status===400?400:503).json({
        error:err.status===400?'Invalid query':'Storage unavailable'
      });
    }
  });

  router.get('/m3m/inventory',async(req,res)=>{
    const {prefix}=req.query;

    if(typeof prefix!=='string'){
      return res.status(400).json({
        error:'Invalid inventory prefix'
      });
    }

    try{
      const report=await inventoryM3MFromS3(
        storage,prefix
      );
      res.json(report);
    }catch(err){
      const status=err.status===400?400:
        err.status===413?413:503;

      res.status(status).json({
        error:status===400?'Invalid inventory prefix':
          status===413?'Inventory limit exceeded':
          'Storage unavailable'
      });
    }
  });

  return router;
}

module.exports={createMediaRouter};
